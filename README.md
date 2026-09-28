# Eaglercraft Proxy

A lightweight launcher for standalone Eaglercraft HTML clients, with a secure WebSocket relay through the Node service. This repository includes three client files, a Render Blueprint, and a byte-progress loader.

[Deploy this Blueprint on Render](https://render.com/deploy?repo=https://github.com/Igu2012/eaglercraft-proxy)

> This is an independent community project. It is not affiliated with, endorsed by, or sponsored by Mojang or Microsoft. Minecraft and Eaglercraft names belong to their respective owners. The three client HTML files were copied from [gamehubjogosfiles/gamefiles03, `Minecraft/`](https://github.com/gamehubjogosfiles/gamefiles03/tree/main/Minecraft). The repository maintainer confirmed authorization to host and redistribute these copies; their provenance and rights were not independently audited here.

## Features

- Version selector for Eaglercraft 1.5.2, 1.8.8, and 1.12.2.
- The `Play` tab lets the user choose a client version and load it for single-player or multiplayer.
- Real download progress (`loaded MB / total MB`) for the bundled standalone HTML clients.
- Each server card copies its Render-proxy WSS address; the game client can connect only to relays from the curated list.
- After loading, the game fills the browser viewport. On touch devices, the `Load client` tap requests native browser fullscreen and a landscape orientation lock where supported.
- If the user leaves native fullscreen on a touch device, a `Tap to return` screen asks for another tap to re-enter; browsers without these APIs fall back to filling the page viewport.
- A `Serverlist` tab shows a curated selection of Eaglercraft servers with online state and WebSocket-handshake ping measured by this Render service.
- The server list asks the Render API for fresh shared ping results every second while open; each listed server is probed at most once per second per service instance.
- WebSocket game traffic is relayed by the Node server to a selected server ID from the local catalog, including relay settings embedded in the clients.
- Upstream DNS must resolve exclusively to public IP addresses; DNS is pinned for each connection, only `wss://` and port `443` are accepted, and arbitrary destination URLs are rejected.
- Render Blueprint (`render.yaml`) with a health check and automatic deployment on commits.
- Original 32×32 grass-block-style SVG favicon (not the official Minecraft logo).

## Included clients

| Version | Client file | Source file | Source Git blob SHA |
| --- | --- | --- | --- |
| `1.5.2` | `versions/1.5.2.html` | [`Minecraft/1.5.2.html`](https://github.com/gamehubjogosfiles/gamefiles03/blob/main/Minecraft/1.5.2.html) | `8f5b9ebf41467e7c852d5e48e5b0d4d24f94c42c` |
| `1.8.8` | `versions/1.8.8.html` | [`Minecraft/1.8.8.html`](https://github.com/gamehubjogosfiles/gamefiles03/blob/main/Minecraft/1.8.8.html) | `e9913620ecf541c07c5d05f3818a4e7933dbfa2c` |
| `1.12.2` | `versions/1.12.2.html` | [`Minecraft/1.12.2.html`](https://github.com/gamehubjogosfiles/gamefiles03/blob/main/Minecraft/1.12.2.html) | `3f00cee1352163570e43e3f1dceb5aaf0091fb2e` |

The three downloaded files were checked against their source Git blob hashes. That verifies file identity, not licensing. The maintainer has confirmed permission for this hosting and redistribution; this confirmation is not a general license for other users to mirror the files. Version-specific research and caveats remain in the `versions/<version>/README.md` files.

The initial server directory is a manually curated snapshot of entries shown on [Eagler Server List](https://servers.eaglercraft.com/). It is not scraped or synchronized automatically. Review each server's current address and terms before adding or changing an entry in `servers/catalog.json`.

## Deploy to Render

1. Push this repository to GitHub and connect it in Render.
2. In Render, create a **Blueprint** from the repository. The included `render.yaml` defines the web service.
3. Deploy without setting `ALLOWED_UPSTREAM_HOSTS` or `ALLOWED_UPSTREAM_PORTS`; the service is ready from its bundled catalog.
4. In `Play`, choose one of the three installed client versions and load it. To use multiplayer, copy a WSS address from a `Serverlist` card and select or enter that Render relay in the game client.

The service intentionally has **no open proxy mode**: `/socket` accepts a server ID only, and maps it to an entry in `servers/catalog.json`. A browser cannot provide an arbitrary host. The embedded client rewrites relay settings to the Render proxy and rejects WebSocket URLs that are not this Render host or do not contain a listed server ID. Raw IPs and non-public DNS answers are blocked; upstreams must use secure `wss://` on port `443`.

## Run locally

Requires Node.js 20 or newer.

```bash
npm ci
npm start
```

Open `http://localhost:3000`. For a non-default local port, set `PORT`.

## Add another authorized client

Place a standalone HTML file at `versions/<version>.html` (for example, `versions/1.16.5.html`) and set that version's `available` field to `true` in `versions/catalog.json`. The server also supports the legacy `versions/<version>/client.html` layout. Verify the source, license, build, and your right to host and redistribute the client before adding it. Clients are limited to 150 MB by default (`CLIENT_LIMIT_MB`).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket server port (Render supplies this automatically). |
| `CLIENT_LIMIT_MB` | `150` | Maximum client HTML download size. |
| `MAX_CONNECTIONS_PER_IP` | `5` | Concurrent relay connections allowed per source IP. |
| `MAX_TOTAL_CONNECTIONS` | `100` | Concurrent relay connection cap per service instance. |

The fixed ping cadence is one handshake attempt per listed server per second, triggered by `/api/servers?probe=1` and shared per service instance. The browser polls that Render endpoint once per second while the Serverlist tab is open; merely opening the launcher does not start ongoing probes.

Do not place credentials in the destination URL. Relay traffic is forwarded without application-level authentication; only enable hosts that should be reachable by every visitor to this launcher.

## Tests

```bash
npm test
```

## Network behavior

The launcher hosts its own UI and local client files. Browser requests for serverlist/ping data stay on this Render origin; actual WSS ping handshakes originate at the Render service. The game iframe has a Content Security Policy that blocks connections and assets from external origins. Its only permitted WebSocket origin is this Render host, and the `/socket` route accepts only a curated server ID. The page itself does not load third-party fonts or scripts.
