const form = document.querySelector('#launch-form');
const versionSelect = document.querySelector('#version');
const versionNote = document.querySelector('#version-note');
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
const fullscreenButton = document.querySelector('#fullscreen-game');
const playTab = document.querySelector('#play-tab');
const serversTab = document.querySelector('#servers-tab');
const playView = document.querySelector('#play-view');
const serversView = document.querySelector('#serverlist-view');
const serverListElement = document.querySelector('#serverlist');
const serverListUpdated = document.querySelector('#serverlist-updated');
const serverCopyStatus = document.querySelector('#server-copy-status');
const MAX_CLIENT_BYTES = 150 * 1024 * 1024;
let versionCatalog = [];
let serverCatalog = [];
let serverListPollTimer = null;
let serverListRequestInFlight = false;

function formatMB(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function showError(message) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
function clearError() { errorBox.textContent = ''; errorBox.classList.add('hidden'); }
function formatTime(value = new Date()) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function getProxyAddress(serverId) {
  const address = new URL('/socket', window.location.origin);
  address.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  address.searchParams.set('server', serverId);
  return address.href;
}

async function writeClipboard(value) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch { /* Use the browser fallback below. */ }
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard access was denied. Copy the WSS address shown on the card.');
}

async function copyServerAddress(serverId, button) {
  const item = serverCatalog.find(server => server.id === serverId);
  if (!item) {
    serverCopyStatus.textContent = 'That server is no longer available in the list.';
    return;
  }
  try {
    await writeClipboard(getProxyAddress(item.id));
    serverCopyStatus.textContent = `Copied the Render WSS address for ${item.name}.`;
    if (button) button.textContent = 'Copied';
  } catch (error) {
    serverCopyStatus.textContent = error.message || 'Could not copy the WSS address.';
  }
}

async function initialize() {
  try {
    const [versionsResponse, healthResponse, serversResponse] = await Promise.all([
      fetch('/api/versions'), fetch('/api/health'), fetch('/api/servers', { cache: 'no-store' })
    ]);
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
    if (!serversResponse.ok) throw new Error('Could not load the server list.');
    const serverData = await serversResponse.json();
    serverCatalog = Array.isArray(serverData.servers) ? serverData.servers : [];
    updateVersionNote();
    renderServerList(serverCatalog);
    versionSelect.addEventListener('change', updateVersionNote);
    playTab.addEventListener('click', () => switchTab('play'));
    serversTab.addEventListener('click', () => switchTab('servers'));
    serverListElement.addEventListener('click', event => {
      const button = event.target.closest('[data-copy-server]');
      if (button) void copyServerAddress(button.dataset.copyServer, button);
    });
    try {
      const health = await healthResponse.json();
      statusBox.textContent = health.proxyReady
        ? `Render proxy ready for ${health.serverCount} listed servers.`
        : 'No servers are configured in the local catalog.';
    } catch { /* Health status is optional. */ }
  } catch (error) {
    showError(error.message || 'Initialization failed.');
  }
}

function switchTab(name) {
  const showServers = name === 'servers';
  playTab.setAttribute('aria-selected', String(!showServers));
  serversTab.setAttribute('aria-selected', String(showServers));
  playView.classList.toggle('hidden', showServers);
  serversView.classList.toggle('hidden', !showServers);
  if (showServers) startServerListPolling();
  else stopServerListPolling();
}

function renderServerList(servers) {
  if (!servers.length) {
    const empty = document.createElement('p');
    empty.className = 'server-list-empty';
    empty.textContent = 'No servers are available right now.';
    serverListElement.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of servers) {
    const card = document.createElement('article');
    card.className = 'server-card';
    const details = document.createElement('div');
    details.className = 'server-card-details';
    const name = document.createElement('h3');
    name.textContent = item.name;
    const address = document.createElement('p');
    address.className = 'server-address';
    address.textContent = `Server: ${item.address} · ${(item.categories || []).join(' · ')}`;
    const relay = document.createElement('p');
    relay.className = 'server-proxy-address';
    relay.textContent = `Render proxy: ${getProxyAddress(item.id)}`;
    const checked = document.createElement('p');
    checked.className = 'server-checked';
    checked.textContent = item.checkedAt ? `Checked at ${formatTime(item.checkedAt)}` : 'Waiting for first check';
    details.append(name, address, relay, checked);

    const metrics = document.createElement('div');
    metrics.className = 'server-card-metrics';
    const state = document.createElement('span');
    state.className = `server-state ${item.online === true ? 'online' : item.online === false ? 'offline' : 'checking'}`;
    state.textContent = item.online === true ? 'Online' : item.online === false ? 'Offline' : 'Checking';
    const ping = document.createElement('strong');
    ping.className = 'server-ping';
    ping.textContent = item.online === true ? `${item.pingMs} ms` : item.online === false ? '— ms' : '… ms';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-server-button';
    copy.dataset.copyServer = item.id;
    copy.setAttribute('aria-label', `Copy Render WSS address for ${item.name}`);
    copy.textContent = 'Copy WSS';
    metrics.append(state, ping, copy);
    card.append(details, metrics);
    fragment.append(card);
  }
  serverListElement.replaceChildren(fragment);
}

async function refreshServerList() {
  if (serverListRequestInFlight) return;
  serverListRequestInFlight = true;
  try {
    const response = await fetch('/api/servers?probe=1', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Server list refresh failed (${response.status}).`);
    const data = await response.json();
    serverCatalog = Array.isArray(data.servers) ? data.servers : [];
    renderServerList(serverCatalog);
    serverListUpdated.textContent = `Updated by Render at ${formatTime()} · refresh every 1 second`;
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'server-list-empty';
    message.textContent = error.message || 'Could not refresh the server list.';
    serverListElement.replaceChildren(message);
  } finally {
    serverListRequestInFlight = false;
  }
}

function startServerListPolling() {
  if (serverListPollTimer !== null) return;
  refreshServerList();
  serverListPollTimer = setInterval(refreshServerList, 1000);
}

function stopServerListPolling() {
  if (serverListPollTimer === null) return;
  clearInterval(serverListPollTimer);
  serverListPollTimer = null;
}

function updateVersionNote() {
  const selected = versionCatalog.find(item => item.id === versionSelect.value);
  versionNote.textContent = selected?.available
    ? 'This client is available in the current deployment.'
    : 'This client is not installed in the current deployment.';
}

function proxyHook(servers) {
  const safeServers = JSON.stringify(servers.map(({ id, name }) => ({ id, name }))).replace(/</g, '\\u003c');
  return `<script>(function(){'use strict';var Native=window.WebSocket;var servers=${safeServers};var serverNames=new Map(servers.map(function(item){return [item.id,item.name];}));var socketProtocol=window.location.protocol==='https:'?'wss:':'ws:';function relayFor(id){var relay=new URL('/socket',window.location.origin);relay.protocol=socketProtocol;relay.searchParams.set('server',id);return relay.href;}var relays=servers.map(function(item,index){return {addr:relayFor(item.id),name:item.name,comment:'Relayed through this Render deployment',primary:index===0};});function validateRelay(url){var parsed;try{parsed=new URL(url,window.location.href);}catch(_e){throw new DOMException('Use a WSS address copied from the Serverlist.','SecurityError');}var id=parsed.searchParams.get('server');if(parsed.protocol!==socketProtocol||parsed.host!==window.location.host||parsed.pathname!=='/socket'||!serverNames.has(id)||parsed.username||parsed.password||parsed.hash)throw new DOMException('Only WSS addresses from the Serverlist are allowed.','SecurityError');return relayFor(id);}function patchOptions(value){if(!value||typeof value!=='object')return value;if(Array.isArray(value.relays))value.relays=relays;if(Object.prototype.hasOwnProperty.call(value,'checkRelaysForUpdates'))value.checkRelaysForUpdates=false;return value;}['eaglercraftOpts','eaglercraftXOpts','eaglercraftXOptsHints'].forEach(function(name){var descriptor=Object.getOwnPropertyDescriptor(window,name);if(descriptor&&!descriptor.configurable){try{window[name]=patchOptions(window[name]);}catch(_e){}return;}var value=patchOptions(window[name]);try{Object.defineProperty(window,name,{configurable:true,enumerable:true,get:function(){return value;},set:function(next){value=patchOptions(next);}});}catch(_e){window[name]=value;}});function RenderOnlyWebSocket(url,protocols){var relay=validateRelay(url);return protocols===undefined?new Native(relay):new Native(relay,protocols);}RenderOnlyWebSocket.prototype=Native.prototype;Object.setPrototypeOf(RenderOnlyWebSocket,Native);['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(key){RenderOnlyWebSocket[key]=Native[key];});window.WebSocket=RenderOnlyWebSocket;})();</script>`;
}

function networkPolicyTag() {
  const socketOrigin = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  const policy = `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' ${socketOrigin}; worker-src 'self' blob:; media-src 'self' data: blob:; frame-src 'self' blob: data:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`;
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
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

async function launchClient() {
  clearError();
  gameWrap.classList.add('hidden');
  gameFrame.srcdoc = '';
  statusBox.textContent = '';
  const version = versionSelect.value;
  loader.classList.remove('hidden');
  launchButton.disabled = true;
  progressBar.style.width = '0%';
  loaderSize.textContent = '0.00 MB';
  loaderDetail.textContent = `Loading Eaglercraft ${version}…`;
  loaderTitle.textContent = 'Preparing client…';

  try {
    const response = await fetch(`/api/client/${encodeURIComponent(version)}`, { cache: 'no-store' });
    if (!response.ok) {
      let message = `Client request failed (${response.status}).`;
      try { message = (await response.json()).error || message; } catch { /* Keep the fallback. */ }
      throw new Error(message);
    }
    const bytes = await readWithProgress(response);
    loaderTitle.textContent = 'Preparing game window…';
    loaderDetail.textContent = `${formatMB(bytes.byteLength)} downloaded; starting client`;
    progressBar.style.width = '100%';
    loaderSize.textContent = `${formatMB(bytes.byteLength)} / ${formatMB(bytes.byteLength)}`;

    let html = new TextDecoder('utf-8').decode(bytes);
    const baseUrl = new URL(response.headers.get('x-client-base') || `/versions/${encodeURIComponent(version)}/`, window.location.origin).href;
    const baseTag = `<base href="${baseUrl}">`;
    if (/<base\b[^>]*>/i.test(html)) html = html.replace(/<base\b[^>]*>/i, baseTag);
    else if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${baseTag}`);
    else html = `${baseTag}${html}`;
    const policy = networkPolicyTag();
    const hook = proxyHook(serverCatalog);
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${policy}${hook}`);
    else html = `${policy}${hook}${html}`;
    gameFrame.srcdoc = html;
    gameLabel.textContent = `Eaglercraft ${version} · Render proxy enabled`;
    statusBox.textContent = 'Single-player is available. Multiplayer can use only WSS addresses from the Serverlist, routed through Render.';
    gameWrap.classList.remove('hidden');
    gameWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    loader.classList.add('hidden');
  } catch (error) {
    loader.classList.add('hidden');
    showError(error.message || 'Could not load the client.');
  } finally {
    launchButton.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void launchClient();
});

fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement === gameFrame) await document.exitFullscreen();
    else if (gameFrame.requestFullscreen) await gameFrame.requestFullscreen();
    else throw new Error('Full screen is not supported by this browser.');
  } catch (error) {
    statusBox.textContent = error.message || 'Could not switch to full screen.';
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement === gameFrame ? 'Exit full screen' : 'Full screen';
});

document.querySelector('#close-game').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  gameFrame.srcdoc = '';
  gameWrap.classList.add('hidden');
});

initialize();
