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
    env: { ...process.env, PORT: String(PORT), ALLOWED_UPSTREAM_HOSTS: '', ALLOWED_UPSTREAM_PORTS: '443' },
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

test('serves launcher and reports health with relay disabled by default', async () => {
  const [page, healthResponse] = await Promise.all([fetch(BASE), fetch(`${BASE}/api/health`)]);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Eaglercraft Proxy/);
  assert.deepEqual(await healthResponse.json(), { ok: true, proxyReady: false });
});

test('publishes the requested version slots', async () => {
  const response = await fetch(`${BASE}/api/versions`);
  assert.equal(response.status, 200);
  const { versions } = await response.json();
  assert.deepEqual(versions.map(version => version.id), ['1.5.2', '1.8.8', '1.12.2', '1.16.5', '1.26.2', '26.2']);
});

test('explains that client files are not bundled', async () => {
  const response = await fetch(`${BASE}/api/client/1.8.8`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /No client is installed/);
});

test('serves an installed client with a byte length for download progress', async () => {
  const clientPath = path.join(__dirname, '..', 'versions', '1.8.8', 'client.html');
  const fixture = '<!doctype html><title>test client</title>';
  fs.writeFileSync(clientPath, fixture);
  try {
    const response = await fetch(`${BASE}/api/client/1.8.8`);
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(fixture));
    assert.equal(await response.text(), fixture);
  } finally {
    fs.rmSync(clientPath, { force: true });
  }
});

test('rejects an unapproved WebSocket destination before opening an upstream', async () => {
  const url = `ws://127.0.0.1:${PORT}/socket?target=${encodeURIComponent('wss://127.0.0.1')}`;
  const statusCode = await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
    socket.on('open', () => reject(new Error('Unapproved proxy destination unexpectedly connected.')));
    socket.on('error', error => {
      if (error.message.includes('Unexpected server response')) return;
      reject(error);
    });
  });
  assert.equal(statusCode, 403);
});
