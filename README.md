# Eaglercraft Proxy

A lightweight launcher for standalone Eaglercraft HTML clients, with a secure WebSocket relay through the Node service. This repository includes three client files, a Render Blueprint, and a byte-progress loader.

[Deploy this Blueprint on Render](https://render.com/deploy?repo=https://github.com/Igu2012/eaglercraft-proxy)

> This is an independent community project. It is not affiliated with, endorsed by, or sponsored by Mojang or Microsoft. Minecraft and Eaglercraft names belong to their respective owners. The three client HTML files were copied from [gamehubjogosfiles/gamefiles03, `Minecraft/`](https://github.com/gamehubjogosfiles/gamefiles03/tree/main/Minecraft). The repository maintainer confirmed authorization to host and redistribute these copies; their provenance and rights were not independently audited here.

## Features

- Version selector for Eaglercraft 1.5.2, 1.8.8, and 1.12.2.
- Real download progress (`loaded MB / total MB`) for the bundled standalone HTML clients.
- WebSocket traffic is relayed by the Node server to the selected Eaglercraft-compatible `wss://` relay, including the relay settings embedded in the clients.
- Destination hostnames and ports must be explicitly allowlisted; private, loopback, link-local, and other non-public DNS addresses are rejected.
- Render Blueprint (`render.yaml`) with a health check and automatic deployment on commits.
- Original 32×32 grass-block-style SVG favicon (not the official Minecraft logo).

## Included clients

| Version | Client file | Source file | Source Git blob SHA |
| --- | --- | --- | --- |
| `1.5.2` | `versions/1.5.2.html` | [`Minecraft/1.5.2.html`](https://github.com/gamehubjogosfiles/gamefiles03/blob/main/Minecraft/1.5.2.html) | `8f5b9ebf41467e7c852d5e48e5b0d4d24f94c42c` |
| `1.8.8` | `versions/1.8.8.html` | [`Minecraft/1.8.8.html`](https://github.com/gamehubjogosfiles/gamefiles03/blob/main/Minecraft/1.8.8.html) | `e9913620ecf541c07c5d05f3818a4e7933dbfa2c` |
| `1.12.2` | `versions/1.12.2.html` | [`Minecraft/1.12.2.html`](https://github.com/gamehubjogosfiles/gamefiles03/blob/main/Minecraft/1.12.2.html) | `3f00cee1352163570e43e3f1dceb5aaf0091fb2e` |

The three downloaded files were checked against their source Git blob hashes. That verifies file identity, not licensing. The maintainer has confirmed permission for this hosting and redistribution; this confirmation is not a general license for other users to mirror the files. Version-specific research and caveats remain in the `versions/<version>/README.md` files.

The remaining catalog slots (`1.16.5`, `1.26.2`, and `26.2`) are placeholders and are unavailable until an authorized client file is added.

## Deploy to Render

1. Push this repository to GitHub and connect it in Render.
2. In Render, create a **Blueprint** from the repository. The included `render.yaml` defines the web service.
3. Set `ALLOWED_UPSTREAM_HOSTS` to comma-separated DNS hostnames for Eaglercraft-compatible WebSocket relays you control or are authorized to use, for example `relay.example.net,another-relay.example.org`. Do not use a wildcard. Only those hosts can be reached.
4. Keep `ALLOWED_UPSTREAM_PORTS` to the exact required ports (default `443`; e.g. `443,8443` if genuinely needed).
5. After deployment, choose one of the bundled clients and enter an allowlisted `wss://` relay address. The launcher routes the client's relay connections through this deployment.

The service intentionally has **no open proxy mode**: a host not in the allowlist is rejected, and raw IP addresses / non-public DNS resolutions are blocked. It accepts secure `wss://` upstreams only. The default configuration is not ready to relay until you set an allowlist.

## Run locally

Requires Node.js 20 or newer.

```bash
npm ci
ALLOWED_UPSTREAM_HOSTS=relay.example.net ALLOWED_UPSTREAM_PORTS=443 npm start
```

Open `http://localhost:3000`. For a non-default local port, set `PORT`.

## Add another authorized client

Place a standalone HTML file at `versions/<version>.html` (for example, `versions/1.16.5.html`) and set that version's `available` field to `true` in `versions/catalog.json`. The server also supports the legacy `versions/<version>/client.html` layout. Verify the source, license, build, and your right to host and redistribute the client before adding it. Clients are limited to 150 MB by default (`CLIENT_LIMIT_MB`).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket server port (Render supplies this automatically). |
| `ALLOWED_UPSTREAM_HOSTS` | empty | Comma-separated exact DNS hostnames permitted as relay destinations. |
| `ALLOWED_UPSTREAM_PORTS` | `443` | Comma-separated permitted destination ports. |
| `CLIENT_LIMIT_MB` | `150` | Maximum client HTML download size. |
| `MAX_CONNECTIONS_PER_IP` | `5` | Concurrent relay connections allowed per source IP. |
| `MAX_TOTAL_CONNECTIONS` | `100` | Concurrent relay connection cap per service instance. |

Do not place credentials in the destination URL. Relay traffic is forwarded without application-level authentication; only enable hosts that should be reachable by every visitor to this launcher.

## Tests

```bash
npm test
```

## Network behavior

The launcher hosts its own UI and local client files. It routes WebSocket connections created by the clients (including their configured relay lists) through this service to the selected upstream relay. Other network requests a client might make are not transparently proxied; these bundled HTML files contain their core assets inline. The page itself does not load third-party fonts or scripts.
