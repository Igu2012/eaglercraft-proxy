const form = document.querySelector('#launch-form');
const versionSelect = document.querySelector('#version');
const versionNote = document.querySelector('#version-note');
const serverInput = document.querySelector('#server-address');
const launchButton = document.querySelector('#launch-button');
const loader = document.querySelector('#loader');
const loaderTitle = document.querySelector('#loader-title');
const loaderSize = document.querySelector('#loader-size');
const loaderDetail = document.querySelector('#loader-detail');
const progressBar = document.querySelector('#progress-bar');
const errorBox = document.querySelector('#error');
const statusBox = document.querySelector('#status');
const gameWrap = document.querySelector('#game-wrap');
const gameFrame = document.querySelector('#game-frame');
const gameLabel = document.querySelector('#game-label');
const MAX_CLIENT_BYTES = 150 * 1024 * 1024;
let versionCatalog = [];

function formatMB(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function showError(message) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
function clearError() { errorBox.textContent = ''; errorBox.classList.add('hidden'); }

async function initialize() {
  try {
    const [versionsResponse, healthResponse] = await Promise.all([fetch('/api/versions'), fetch('/api/health')]);
    if (!versionsResponse.ok) throw new Error('Could not load the version list.');
    const catalog = await versionsResponse.json();
    versionCatalog = Array.isArray(catalog.versions) ? catalog.versions : [];
    versionSelect.replaceChildren(...versionCatalog.map(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      option.dataset.available = item.available ? 'true' : 'false';
      return option;
    }));
    updateVersionNote();
    versionSelect.addEventListener('change', updateVersionNote);
    try {
      const health = await healthResponse.json();
      statusBox.textContent = health.proxyReady ? 'Relay is ready for its configured destination hosts.' : 'Relay is not configured yet. The operator must set ALLOWED_UPSTREAM_HOSTS in the deployment settings.';
    } catch { /* health text is optional */ }
    const saved = localStorage.getItem('eagler-proxy-server');
    if (saved) serverInput.value = saved;
  } catch (error) {
    showError(error.message || 'Initialization failed.');
  }
}

function updateVersionNote() {
  const selected = versionCatalog.find(item => item.id === versionSelect.value);
  versionNote.textContent = selected?.available
    ? 'Client file found in this deployment.'
    : `Client file not installed. Add an authorized client at versions/${versionSelect.value}/client.html.`;
}

function proxyHook(target) {
  const safeTarget = JSON.stringify(target);
  return `<script>(function(){'use strict';var Native=window.WebSocket;var target=${safeTarget};function RelayedWebSocket(url,protocols){var relay=new URL('/socket',window.location.origin);relay.protocol=window.location.protocol==='https:'?'wss:':'ws:';relay.searchParams.set('target',target);return protocols===undefined?new Native(relay.href):new Native(relay.href,protocols);}RelayedWebSocket.prototype=Native.prototype;Object.setPrototypeOf(RelayedWebSocket,Native);['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){RelayedWebSocket[k]=Native[k];});window.WebSocket=RelayedWebSocket;})();</script>`;
}

async function readWithProgress(response) {
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > MAX_CLIENT_BYTES) throw new Error('Client exceeds the 150 MB download limit.');
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  loader.classList.remove('hidden');
  loaderTitle.textContent = 'Downloading client…';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received > MAX_CLIENT_BYTES) {
      await reader.cancel();
      throw new Error('Client exceeds the 150 MB download limit.');
    }
    loaderSize.textContent = `${formatMB(received)}${total ? ` / ${formatMB(total)}` : ' downloaded'}`;
    loaderDetail.textContent = total ? `${Math.min(100, Math.round(received / total * 100))}% downloaded` : 'Download size is being measured';
    progressBar.style.width = total ? `${Math.min(100, received / total * 100)}%` : '35%';
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearError();
  gameWrap.classList.add('hidden');
  gameFrame.srcdoc = '';
  statusBox.textContent = '';
  const version = versionSelect.value;
  let target;
  try {
    target = serverInput.value.trim();
    if (!target.includes('://')) target = `wss://${target}`;
    const parsed = new URL(target);
    if (parsed.protocol !== 'wss:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
      throw new Error('Enter a secure server address like wss://vanilla.mc. Credentials and fragments are not allowed.');
    }
    target = parsed.href;
  } catch (error) {
    showError(error.message || 'Enter a valid wss:// server address.');
    return;
  }

  localStorage.setItem('eagler-proxy-server', serverInput.value.trim());
  loader.classList.remove('hidden');
  launchButton.disabled = true;
  progressBar.style.width = '0%';
  loaderSize.textContent = '0.00 MB';
  loaderDetail.textContent = 'Connecting to this deployment…';
  loaderTitle.textContent = 'Preparing client…';

  try {
    const response = await fetch(`/api/client/${encodeURIComponent(version)}`, { cache: 'no-store' });
    if (!response.ok) {
      let message = `Client request failed (${response.status}).`;
      try { message = (await response.json()).error || message; } catch { /* keep fallback */ }
      throw new Error(message);
    }
    const bytes = await readWithProgress(response);
    loaderTitle.textContent = 'Preparing game window…';
    loaderDetail.textContent = `${formatMB(bytes.byteLength)} downloaded; starting client`;
    progressBar.style.width = '100%';
    loaderSize.textContent = `${formatMB(bytes.byteLength)} / ${formatMB(bytes.byteLength)}`;

    let html = new TextDecoder('utf-8').decode(bytes);
    const baseUrl = `${window.location.origin}/versions/${encodeURIComponent(version)}/`;
    const baseTag = `<base href="${baseUrl}">`;
    if (/<base\b[^>]*>/i.test(html)) html = html.replace(/<base\b[^>]*>/i, baseTag);
    else if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${baseTag}`);
    else html = `${baseTag}${html}`;
    const hook = proxyHook(target);
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${hook}`);
    else html = `${hook}${html}`;
    gameFrame.srcdoc = html;
    gameLabel.textContent = `Eaglercraft ${version} · relayed via this deployment`;
    gameWrap.classList.remove('hidden');
    gameWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    loader.classList.add('hidden');
  } catch (error) {
    loader.classList.add('hidden');
    showError(error.message || 'Could not load the client.');
  } finally {
    launchButton.disabled = false;
  }
});

document.querySelector('#close-game').addEventListener('click', () => {
  gameFrame.srcdoc = '';
  gameWrap.classList.add('hidden');
});

initialize();
