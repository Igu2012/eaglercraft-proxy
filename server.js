const dns = require('node:dns/promises');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const ipaddr = require('ipaddr.js');
const WebSocket = require('ws');
const { performance } = require('node:perf_hooks');

const app = express();
const server = require('node:http').createServer(app);
const ROOT = __dirname;
const CLIENT_LIMIT_BYTES = Number(process.env.CLIENT_LIMIT_MB || 150) * 1024 * 1024;
const MAX_WS_PAYLOAD = 16 * 1024 * 1024;
const MAX_CONNECTIONS_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_IP || 5);
const MAX_TOTAL_CONNECTIONS = Number(process.env.MAX_TOTAL_CONNECTIONS || 100);
const SERVER_CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'servers', 'catalog.json'), 'utf8')).servers;
const SERVER_BY_ID = new Map(SERVER_CATALOG.map(item => [item.id, item]));
const SERVER_PING_INTERVAL_MS = 1000;
const SERVER_PING_TIMEOUT_MS = 5000;
const MAX_SERVER_PROBES_IN_FLIGHT = 5;
const DISABLE_SERVER_PINGS = process.env.DISABLE_SERVER_PINGS === 'true';
const pingResults = new Map(SERVER_CATALOG.map(item => [item.id, {
  online: null, pingMs: null, checkedAt: null, inFlight: 0, lastStartedAt: 0,
  sequence: 0, lastCompletedSequence: 0
}]));
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
  res.json({ ok: true, proxyReady: SERVER_CATALOG.length > 0, serverCount: SERVER_CATALOG.length });
});

app.get('/api/versions', (_req, res) => {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions', 'catalog.json'), 'utf8'));
    res.json(catalog);
  } catch {
    res.status(500).json({ error: 'Version catalog is unavailable.' });
  }
});

app.get('/api/servers', (req, res) => {
  if (!DISABLE_SERVER_PINGS && req.query.probe === '1') SERVER_CATALOG.forEach(scheduleServerProbe);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    refreshSeconds: SERVER_PING_INTERVAL_MS / 1000,
    servers: SERVER_CATALOG.map(item => {
      const { inFlight, lastStartedAt, sequence, lastCompletedSequence, ...status } = pingResults.get(item.id);
      return { ...item, ...status, checking: inFlight > 0 };
    })
  });
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
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Invalid server address.');
  const target = new URL(raw);
  if (target.protocol !== 'wss:') throw new Error('Only secure wss:// upstream connections are allowed.');
  if (target.username || target.password || target.hash) throw new Error('Credentials and URL fragments are not allowed in the server address.');
  const hostname = target.hostname.toLowerCase().replace(/\.$/, '');
  const port = Number(target.port || 443);
  if (!hostname) throw new Error('The server address is missing a hostname.');
  if (port !== 443) throw new Error('Only the secure WebSocket port 443 is supported for listed servers.');
  if (ipaddr.isValid(hostname)) throw new Error('Listed servers must use a DNS hostname, not a raw IP address.');
  return { target, hostname, port };
}

async function resolvePublic(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('The destination resolved to a non-public network address and was blocked.');
  }
  return addresses;
}

function scheduleServerProbe(item) {
  const state = pingResults.get(item.id);
  const now = Date.now();
  if (!state || state.inFlight >= MAX_SERVER_PROBES_IN_FLIGHT || now - state.lastStartedAt < SERVER_PING_INTERVAL_MS) return;
  state.inFlight += 1;
  state.lastStartedAt = now;
  const sequence = ++state.sequence;

  void (async () => {
    let probe;
    let settled = false;
    const finish = online => {
      if (settled) return;
      settled = true;
      state.inFlight = Math.max(0, state.inFlight - 1);
      if (sequence > state.lastCompletedSequence) {
        state.lastCompletedSequence = sequence;
        state.online = online;
        state.pingMs = online ? Math.max(0, Math.round(performance.now() - startedAt)) : null;
        state.checkedAt = new Date().toISOString();
      }
      if (probe?.readyState === WebSocket.OPEN) probe.close(1000, 'Ping complete');
      else if (probe?.readyState === WebSocket.CONNECTING) probe.terminate();
    };

    let startedAt = performance.now();
    try {
      const parsed = parseTarget(item.address);
      const addresses = await resolvePublic(parsed.hostname);
      const pinned = addresses[0];
      startedAt = performance.now();
      probe = new WebSocket(parsed.target, undefined, {
        maxPayload: 1024,
        handshakeTimeout: SERVER_PING_TIMEOUT_MS,
        perMessageDeflate: false,
        lookup: (_hostname, options, callback) => {
          if (options && options.all) return callback(null, addresses.map(address => ({ address: address.address, family: address.family })));
          callback(null, pinned.address, pinned.family);
        }
      });
      probe.once('open', () => finish(true));
      probe.once('error', () => finish(false));
      probe.once('close', () => finish(false));
    } catch {
      finish(false);
    }
  })();
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
    const serverId = requestUrl.searchParams.get('server');
    const selectedServer = SERVER_BY_ID.get(serverId);
    if (!selectedServer) throw new Error('Choose a server from the server list.');
    parsed = parseTarget(selectedServer.address);
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
server.listen(port, '0.0.0.0', () => console.log(`Eaglercraft Proxy listening on ${port}; listed servers: ${SERVER_CATALOG.length}`));

process.on('SIGTERM', () => server.close(() => process.exit(0)));
