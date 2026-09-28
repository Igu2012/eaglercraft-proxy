const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const PORT = 3137;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProcess;

before(async () => {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), DISABLE_SERVER_PINGS: 'true' },
    stdio: 'ignore'
  });
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch { /* wait for listen */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
});

test('serves launcher and reports catalog-backed relay readiness without upstream environment variables', async () => {
  const [page, healthResponse] = await Promise.all([fetch(BASE), fetch(`${BASE}/api/health`)]);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Eaglercraft Proxy/);
  assert.match(html, /Choose your version/);
  assert.match(html, /Full screen/);
  assert.match(html, /allowfullscreen/);
  assert.match(html, /id="fullscreen-return"/);
  assert.match(html, /Tap to return/);
  assert.doesNotMatch(html, /Jogar|Servidores|Aguardando/);
  assert.doesNotMatch(html, /server-address/);
  assert.deepEqual(await healthResponse.json(), { ok: true, proxyReady: true, serverCount: 10 });
});

test('copies only catalog-backed Render relay addresses and blocks external WebSockets', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(client, /copyServerAddress\(button\.dataset\.copyServer, button\)/);
  assert.match(client, /copy\.textContent = 'Copy WSS'/);
  assert.match(client, /function getProxyAddress\(serverId\)/);
  assert.match(client, /function proxyHook\(servers\)/);
  assert.match(client, /Only WSS addresses from the Serverlist are allowed/);
  assert.match(client, /function networkPolicyTag\(\)/);
  assert.match(client, /connect-src 'self' \$\{socketOrigin\}/);
  assert.match(client, /root\.requestFullscreen\(\{ navigationUI: 'hide' \}\)/);
  assert.match(client, /function requestPageFullscreen\(\)/);
  assert.match(client, /screen\.orientation\.lock\('landscape'\)/);
  assert.match(client, /window\.addEventListener\('orientationchange', maintainLandscape\)/);
  assert.match(client, /pendingReturnPrompt = true/);
  assert.match(client, /returnToFullscreenButton\.addEventListener\('click'/);
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(styles, /body\.client-active #game-frame/);
  assert.match(styles, /height:100dvh/);
  const launchFlow = client.slice(client.indexOf('async function launchClient'), client.indexOf("form.addEventListener('submit'"));
  assert.ok(launchFlow.indexOf('requestPageFullscreen()') < launchFlow.indexOf('await fetch('), 'mobile fullscreen must be requested during the original user gesture');
  assert.doesNotMatch(client, /searchParams\.set\('target'/);
  assert.doesNotMatch(client, /Jogar|Servidores|Aguardando|Escolha|Medição|Conectando/);
});

test('serves the curated server list and cached ping fields through the local API', async () => {
  const response = await fetch(`${BASE}/api/servers`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { refreshSeconds, servers } = await response.json();
  assert.equal(refreshSeconds, 1);
  assert.equal(servers.length, 10);
  assert.equal(servers[0].id, 'archmc');
  assert.equal(servers[0].address, 'wss://arch.mc');
  assert.equal(servers[0].online, null);
  assert.equal(servers[0].pingMs, null);
  assert.equal(servers[0].checking, false);
});

test('publishes only the three bundled client versions', async () => {
  const response = await fetch(`${BASE}/api/versions`);
  assert.equal(response.status, 200);
  const { versions } = await response.json();
  assert.deepEqual(versions.map(version => version.id), ['1.5.2', '1.8.8', '1.12.2']);
  assert.ok(versions.every(version => version.available));
});

test('explains when a client file is not installed', async () => {
  const response = await fetch(`${BASE}/api/client/1.16.5`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /No client is installed/);
});

test('serves bundled flat HTML clients with byte length and their shared asset base', async () => {
  for (const version of ['1.5.2', '1.8.8', '1.12.2']) {
    const clientPath = path.join(__dirname, '..', 'versions', `${version}.html`);
    const response = await fetch(`${BASE}/api/client/${version}`);
    assert.equal(response.status, 200, `version ${version}`);
    assert.equal(Number(response.headers.get('content-length')), fs.statSync(clientPath).size);
    assert.equal(response.headers.get('x-client-base'), '/versions/');
    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    assert.match(Buffer.from(firstChunk.value).toString('utf8'), /<html\b/i);
    await reader.cancel();
  }
});

test('serves an installed legacy directory client with a byte length for download progress', async () => {
  const clientPath = path.join(__dirname, '..', 'versions', '1.16.5', 'client.html');
  const fixture = '<!doctype html><title>test client</title>';
  fs.writeFileSync(clientPath, fixture);
  try {
    const response = await fetch(`${BASE}/api/client/1.16.5`);
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(fixture));
    assert.equal(response.headers.get('x-client-base'), '/versions/1.16.5/');
    assert.equal(await response.text(), fixture);
  } finally {
    fs.rmSync(clientPath, { force: true });
  }
});

test('rejects unknown server IDs before opening an upstream, ignoring arbitrary target URLs', async () => {
  const url = `ws://127.0.0.1:${PORT}/socket?server=not-in-catalog&target=${encodeURIComponent('wss://127.0.0.1')}`;
  const statusCode = await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
    socket.on('open', () => reject(new Error('Unknown server ID unexpectedly connected.')));
    socket.on('error', error => {
      if (error.message.includes('Unexpected server response')) return;
      reject(error);
    });
  });
  assert.equal(statusCode, 403);
});
