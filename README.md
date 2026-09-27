# Eaglercraft Proxy

A minimal English-language launcher for **client files you are authorized to host**, with a secure WebSocket relay through the Node service. The repository includes a Render Blueprint and a byte-progress loader.

> This is an independent community project. It is not affiliated with, endorsed by, or sponsored by Mojang or Microsoft. Minecraft and Eaglercraft names belong to their respective owners. No compiled game/client files are included.

## Features

- Version selector and simple responsive launcher.
- Real download progress (`loaded MB / total MB`) for installed standalone HTML clients.
- WebSocket traffic is relayed by the Node server to an approved `wss://` destination.
- Destination hostnames and ports must be explicitly allowlisted; private, loopback, link-local, and other non-public DNS addresses are rejected.
- Render Blueprint (`render.yaml`) with a health check and automatic deployment on commits.
- Original 32×32 grass-block-style SVG favicon (not the official Minecraft logo).

## Deploy to Render

1. Push this repository to GitHub and connect that repository in Render.
2. In Render, create a **Blueprint** from the repository. The included `render.yaml` defines the web service.
3. Set `ALLOWED_UPSTREAM_HOSTS` to comma-separated DNS hostnames that you control or are authorized to relay to, for example `vanilla.mc,game.example.net`. Do not use a wildcard. Only those hosts can be reached.
4. Keep `ALLOWED_UPSTREAM_PORTS` to the exact required ports (default `443`; e.g. `443,8443` if genuinely needed).
5. After deploy, add client files you are authorized to host (see below). Render redeploys on subsequent commits.

The service intentionally has **no open proxy mode**: a host not in the allowlist is rejected, and raw IP addresses / non-public DNS resolutions are blocked. It accepts secure `wss://` upstreams only. The default configuration is not ready to relay until you set an allowlist.

## Run locally

Requires Node.js 20 or newer.

```bash
npm ci
ALLOWED_UPSTREAM_HOSTS=your-server.example ALLOWED_UPSTREAM_PORTS=443 npm start
```

Open `http://localhost:3000`. For a non-default local port, set `PORT`.

## Install a client you are authorized to use

This repository deliberately does not download or redistribute Eaglercraft/Minecraft client bundles. Verify the source, license, and your right to host a client before adding it.

1. Put the standalone HTML client at `versions/<version>/client.html` (for example, `versions/1.8.8/client.html`). This filename is ignored by Git by default to prevent accidental redistribution; after confirming hosting rights, use `git add -f versions/<version>/client.html` or adjust `.gitignore` yourself.
2. Set `available: true` for that version in `versions/catalog.json`.
3. Commit and push the change. Clients are limited to 150 MB by default (`CLIENT_LIMIT_MB`).

Directories in `versions/` are placeholders only. Version labels must be verified against primary project sources before treating them as an available build.

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

The launcher hosts its own UI and local client files, and rewrites the client's **WebSocket connections** to this service before relaying them to the configured upstream. Other network requests a client might make (for example, remote HTTP assets or APIs) are not transparently proxied by this WebSocket relay; use a self-contained client bundle if you need the game session to avoid direct external resource requests. The page itself does not load third-party fonts or scripts.
