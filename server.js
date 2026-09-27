const dns = require('node:dns/promises');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const ipaddr = require('ipaddr.js');
const WebSocket = require('ws');

const app = express();
const server = require('node:http').createServer(app);
const ROOT = __dirname;
const CLIENT_LIMIT_BYTES = Number(process.env.CLIENT_LIMIT_MB || 150) * 1024 * 1024;
const MAX_WS_PAYLOAD = 16 * 1024 * 1024;
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP || 5);
const MAX_TOTAL_CONNECTIONS = Number(process.env.MAX_TOTAL_CONNECTIONS || 100);
const allowedHosts = new Set((process.env.ALLOWED_UPSTREAM_HOSTS || '')
  .split(',').map(value => value.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
const allowedPorts = new Set((process.env.ALLOWED_UPSTREAM_PORTS || '443')
  .split(',').map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0 && value <= 65535));
const activeByIp = new Map();
let totalConnections = 0;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.use('/versions', express.static(path.join(ROOT, 'versions'), { index: false, dotfiles: 'deny' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, proxyReady: allowedHosts.size > 0 && allowedPorts.size > 0 });
});

app.get('/api/versions', (_req, res) => {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions', 'catalog.json'), 'utf8'));
    res.json(catalog);
  } catch {
    res.status(500).json({ error: 'Version catalog is unavailable.' });
  }
});

app.get('/api/client/:version', (req, res) => {
  const version = String(req.params.version || '');
  if (!/^[a-zA-Z0-9.-]{1,24}$/.test(version)) return res.status(400).json({ error: 'Invalid version.' });
  const versionsRoot = path.join(ROOT, 'versions');
  const flatFile = path.join(versionsRoot, `${version}.html`);
  const nestedFile = path.join(versionsRoot, version, 'client.html');
  const file = fs.existsSync(flatFile) ? flatFile : nestedFile;
  if (!file.startsWith(versionsRoot + path.sep)) return res.status(400).json({ error: 'Invalid version.' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return res.status(404).json({ error: `No client is installed for ${version}. Add an authorized client as versions/${version}.html.` });
  }
  const size = fs.statSync(file).size;
  if (size > CLIENT_LIMIT_BYTES) return res.status(413).json({ error: `Client is larger than the ${Math.floor(CLIENT_LIMIT_BYTES / 1024 / 1024)} MB limit.` });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', size);
  res.setHeader('X-Client-Base', file === flatFile ? '/versions/' : `/versions/${encodeURIComponent(version)}/`);
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(file);
});

app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

function isPublicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function parseTarget(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Enter a valid secure WebSocket URL (wss://...).');
  const target = new URL(raw.includes('://') ? raw : `wss://${raw}`);
  if (target.protocol !== 'wss:') throw new Error('Only secure wss:// upstream connections are allowed.');
  if (target.username || target.password || target.hash) throw new Error('Credentials and URL fragments are not allowed in the server address.');
  const hostname = target.hostname.toLowerCase().replace(/\.$/, '');
  const port = Number(target.port || 443);
  if (!hostname || !allowedHosts.has(hostname)) throw new Error('That host is not on this deployment’s ALLOWED_UPSTREAM_HOSTS list.');
  if (!allowedPorts.has(port)) throw new Error(`Port ${port} is not allowed. Configure ALLOWED_UPSTREAM_PORTS on Render.`);
  if (ipaddr.isValid(hostname)) throw new Error('Use an approved DNS hostname rather than a raw IP address.');
  return { target, hostname, port };
}

async function resolvePublic(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('The destination resolved to a non-public network address and was blocked.');
  }
  return addresses;
}

function decrementConnection(ip) {
  totalConnections = Math.max(0, totalConnections - 1);
  const next = (activeByIp.get(ip) || 1) - 1;
  if (next <= 0) activeByIp.delete(ip); else activeByIp.set(ip, next);
}

function safeCloseCode(code) {
  const standard = code === 1000 || (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code));
  return standard || (code >= 3000 && code <= 4999) ? code : 1011;
}

function safeCloseReason(reason) {
  let value = reason.toString('utf8');
  while (Buffer.byteLength(value, 'utf8') > 120) value = value.slice(0, -1);
  return value;
}

const wss = new WebSocket.WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false });

server.on('upgrade', async (req, socket, head) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname !== '/socket') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const origin = req.headers.origin;
  const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== requestHost) throw new Error('Origin mismatch');
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  let parsed;
  let addresses;
  try {
    parsed = parseTarget(requestUrl.searchParams.get('target'));
    addresses = await resolvePublic(parsed.hostname);
  } catch (error) {
    const message = error.message.replace(/[\r\n]/g, ' ');
    socket.write(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}`);
    socket.destroy();
    return;
  }

  const ip = clientIp(req);
  if (totalConnections >= MAX_TOTAL_CONNECTIONS || (activeByIp.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  totalConnections += 1;
  activeByIp.set(ip, (activeByIp.get(ip) || 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    decrementConnection(ip);
  };
  socket.on('close', release);

  wss.handleUpgrade(req, socket, head, client => {
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(v => v.trim()).filter(Boolean);
    const pinned = addresses[0];
    const upstream = new WebSocket(parsed.target, protocols.length ? protocols : undefined, {
      maxPayload: MAX_WS_PAYLOAD,
      handshakeTimeout: 12_000,
      perMessageDeflate: false,
      lookup: (_hostname, options, callback) => {
        if (options && options.all) return callback(null, addresses.map(item => ({ address: item.address, family: item.family })));
        callback(null, pinned.address, pinned.family);
      }
    });

    const queued = [];
    let queuedBytes = 0;
    client.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) {
        queuedBytes += data.length;
        if (queued.length >= 64 || queuedBytes > MAX_WS_PAYLOAD) {
          client.close(1009, 'Too much queued data');
          upstream.terminate();
          return;
        }
        queued.push([data, isBinary]);
      }
    });
    upstream.on('open', () => {
      for (const [data, isBinary] of queued) upstream.send(data, { binary: isBinary });
      queued.length = 0;
      queuedBytes = 0;
    });
    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on('close', (code, reason) => {
      if (client.readyState === WebSocket.OPEN) client.close(safeCloseCode(code), safeCloseReason(reason));
      release();
    });
    upstream.on('error', () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, 'Upstream connection failed');
      release();
    });
    client.on('close', () => {
      if (upstream.readyState === WebSocket.OPEN) upstream.close(); else upstream.terminate();
      release();
    });
    client.on('error', () => {
      upstream.terminate();
      release();
    });
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Eaglercraft Proxy listening on ${port}; upstream hosts configured: ${allowedHosts.size}`));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
