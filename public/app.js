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
const playTab = document.querySelector('#play-tab');
const serversTab = document.querySelector('#servers-tab');
const playView = document.querySelector('#play-view');
const serversView = document.querySelector('#serverlist-view');
const serverListElement = document.querySelector('#serverlist');
const serverListUpdated = document.querySelector('#serverlist-updated');
const MAX_CLIENT_BYTES = 150 * 1024 * 1024;
let versionCatalog = [];
let serverCatalog = [];
let serverListPollTimer = null;
let serverListRequestInFlight = false;

function formatMB(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function showError(message) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
function clearError() { errorBox.textContent = ''; errorBox.classList.add('hidden'); }

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
      const button = event.target.closest('[data-join-server]');
      if (!button) return;
      switchTab('play');
      void launchClient(button.dataset.joinServer);
    });
    try {
      const health = await healthResponse.json();
      statusBox.textContent = health.proxyReady ? `Render proxy ready for ${health.serverCount} listed servers.` : 'No servers are configured in the local catalog.';
    } catch { /* health text is optional */ }
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
    empty.textContent = 'Nenhum servidor disponível no momento.';
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
    address.textContent = `${item.address} · ${(item.categories || []).join(' · ')}`;
    const checked = document.createElement('p');
    checked.className = 'server-checked';
    checked.textContent = item.checkedAt ? `Medição às ${new Date(item.checkedAt).toLocaleTimeString()}` : 'Aguardando primeira medição';
    details.append(name, address, checked);
    const metrics = document.createElement('div');
    metrics.className = 'server-card-metrics';
    const state = document.createElement('span');
    state.className = `server-state ${item.online === true ? 'online' : item.online === false ? 'offline' : 'checking'}`;
    state.textContent = item.online === true ? 'Online' : item.online === false ? 'Offline' : 'Medindo';
    const ping = document.createElement('strong');
    ping.className = 'server-ping';
    ping.textContent = item.online === true ? `${item.pingMs} ms` : item.online === false ? '— ms' : '… ms';
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'join-server-button';
    join.dataset.joinServer = item.id;
    join.textContent = 'Jogar';
    metrics.append(state, ping, join);
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
    if (!response.ok) throw new Error(`Falha ao atualizar a lista (${response.status}).`);
    const data = await response.json();
    serverCatalog = Array.isArray(data.servers) ? data.servers : [];
    renderServerList(serverCatalog);
    serverListUpdated.textContent = `Atualizado no Render às ${new Date().toLocaleTimeString()} · intervalo de 1 s`;
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'server-list-empty';
    message.textContent = error.message || 'Não foi possível atualizar a lista de servidores.';
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
    ? 'Client file found in this deployment.'
    : `Client file not installed. Add an authorized client at versions/${versionSelect.value}.html.`;
}

function proxyHook(serverId) {
  const safeServerId = JSON.stringify(serverId);
  return `<script>(function(){'use strict';var Native=window.WebSocket;var serverId=${safeServerId};var relay=new URL('/socket',window.location.origin);relay.protocol=window.location.protocol==='https:'?'wss:':'ws:';relay.searchParams.set('server',serverId);var relayAddress=relay.href;function patchOptions(value){if(!value||typeof value!=='object')return value;if(Array.isArray(value.relays))value.relays=[{addr:relayAddress,name:'Selected server via Render proxy',comment:'Selected server via Render proxy',primary:true}];if(Object.prototype.hasOwnProperty.call(value,'checkRelaysForUpdates'))value.checkRelaysForUpdates=false;return value;}['eaglercraftOpts','eaglercraftXOpts','eaglercraftXOptsHints'].forEach(function(name){var descriptor=Object.getOwnPropertyDescriptor(window,name);if(descriptor&&!descriptor.configurable){try{window[name]=patchOptions(window[name]);}catch(_e){}return;}var value=patchOptions(window[name]);try{Object.defineProperty(window,name,{configurable:true,enumerable:true,get:function(){return value;},set:function(next){value=patchOptions(next);}});}catch(_e){window[name]=value;}});function RelayedWebSocket(url,protocols){return protocols===undefined?new Native(relayAddress):new Native(relayAddress,protocols);}RelayedWebSocket.prototype=Native.prototype;Object.setPrototypeOf(RelayedWebSocket,Native);['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){RelayedWebSocket[k]=Native[k];});window.WebSocket=RelayedWebSocket;})();</script>`;
}

function singleplayerHook() {
  return `<script>(function(){'use strict';var Native=window.WebSocket;function BlockedWebSocket(){throw new DOMException('Multiplayer is only available from the Serverlist tab.','SecurityError');}BlockedWebSocket.prototype=Native.prototype;Object.setPrototypeOf(BlockedWebSocket,Native);['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){BlockedWebSocket[k]=Native[k];});window.WebSocket=BlockedWebSocket;})();</script>`;
}

function networkPolicyTag(allowRenderWebSocket) {
  const socketOrigin = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  const connectSources = allowRenderWebSocket ? `'self' ${socketOrigin}` : `'self'`;
  const policy = `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src ${connectSources}; worker-src 'self' blob:; media-src 'self' data: blob:; frame-src 'self' blob: data:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`;
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

async function launchClient(serverId = null) {
  clearError();
  gameWrap.classList.add('hidden');
  gameFrame.srcdoc = '';
  statusBox.textContent = '';
  const version = versionSelect.value;
  const selectedServer = serverId ? serverCatalog.find(item => item.id === serverId) : null;
  if (serverId && !selectedServer) {
    showError('Escolha um servidor da aba Serverlist.');
    return;
  }
  loader.classList.remove('hidden');
  launchButton.disabled = true;
  progressBar.style.width = '0%';
  loaderSize.textContent = '0.00 MB';
  loaderDetail.textContent = selectedServer ? `Conectando a ${selectedServer.name} pelo Render…` : 'Iniciando o cliente single-player…';
  loaderTitle.textContent = 'Preparando cliente…';

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
    const baseUrl = new URL(response.headers.get('x-client-base') || `/versions/${encodeURIComponent(version)}/`, window.location.origin).href;
    const baseTag = `<base href="${baseUrl}">`;
    if (/<base\b[^>]*>/i.test(html)) html = html.replace(/<base\b[^>]*>/i, baseTag);
    else if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${baseTag}`);
    else html = `${baseTag}${html}`;
    const hook = selectedServer ? proxyHook(selectedServer.id) : singleplayerHook();
    const policy = networkPolicyTag(Boolean(selectedServer));
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${policy}${hook}`);
    else html = `${policy}${hook}${html}`;
    gameFrame.srcdoc = html;
    gameLabel.textContent = selectedServer
      ? `Eaglercraft ${version} · ${selectedServer.name} · multiplayer via Render`
      : `Eaglercraft ${version} · single-player (multiplayer bloqueado)`;
    statusBox.textContent = selectedServer
      ? `Multiplayer carregado via Render: ${selectedServer.name}.`
      : 'Single-player: conexões multiplayer bloqueadas. Escolha um servidor na Serverlist para jogar online.';
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

document.querySelector('#close-game').addEventListener('click', () => {
  gameFrame.srcdoc = '';
  gameWrap.classList.add('hidden');
});

initialize();
