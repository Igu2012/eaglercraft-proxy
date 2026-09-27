# Eaglercraft Proxy

A minimal English-language launcher for **client files you are authorized to host**, with a secure WebSocket relay through the Node service. The repository includes a Render Blueprint and a byte-progress loader.

[Deploy this Blueprint on Render](https://render.com/deploy?repo=https://github.com/Igu2012/eaglercraft-proxy)

> This is an independent community project. It is not affiliated with, endorsed by, or sponsored by Mojang or Microsoft. Minecraft and Eaglercraft names belong to their respective owners. No compiled game/client files are included.

## Features

- Version selector and simple responsive launcher.
- Real download progress (`loaded MB / total MB`) for installed standalone HTML clients.
- WebSocket traffic is relayed by the Node server to an approved `wss://` destination.
- Destination hostnames and ports must be explicitly allowlisted; private, loopback, link-local, and other non-public DNS addresses are rejected.
- Render Blueprint (`render.yaml`) with a health check and automatic deployment on commits.
- Original 32×32 grass-block-style SVG favicon (not the official Minecraft logo).

## Version research (checked 2026-09-27)

| Slot | Finding | Client file |
| --- | --- | --- |
| `1.5.2` | Eaglercraft 1.5.2 SP2 (`sp2.01`); the archive license/provenance does not by itself clear a compiled Minecraft-derived client for redistribution. | Not included. |
| `1.8.8` | EaglercraftX 1.8.8 (`u53`); the archived source says All Rights Reserved and is not a client redistribution license. | Not included. |
| `1.12.2` | Eaglercraft 1.12.2 (`u3`); the public project listing does not grant rights to redistribute the compiled client. | Not included. |
| `1.16.5` | Community build labeled `Eaglercraft 1.16 u3`; it is not verified as an original-project release and has no clear redistribution grant. | Not included. |
| `1.26.2` | No authoritative Eaglercraft build with this name was verified. | Placeholder only. |
| `26.2` | Mojang's 2026 Java release name; a third-party launcher lists `26.2 (u0) WASM`, but it is unverified community material. | Not included. |

Primary/version references: [Eaglercraft downloads](https://eaglercraft.com/p/downloads), [Eaglercraft legal page](https://eaglercraft.com/p/legal), [Minecraft EULA](https://www.minecraft.net/en-us/eula), [Minecraft 26.2 release](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-2), and the per-version READMEs under `versions/`. These links are research references, not endorsements or permission to copy files. This repository contains no compiled Eaglercraft or Minecraft client binaries.

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

The directories under `versions/` are source-documented slots; none contains a client file in this repository. Review each slot's README and verify a build and hosting rights before setting it available.

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
