# Yumi Bridge

The relay server on our VPS that connects the Mac and the phone in both directions.
It only routes and stores encrypted messages.
It can never read them.

Owner: Jepoy.

Status: relay implementation in progress (OBJ-13). Live VPS rollout is tracked by OBJ-32.

## Responsibilities

- Accept WebSocket connections from paired devices, authenticated by their device keys.
- Route each message to the device named in its `to` field.
- Tell the sender at once when a command's target is offline. Never queue commands.
- Hold results and events through a short reconnect, until they expire.
- Drop expired messages, and tell the sender a message expired.
- Keep a registry of paired devices and their public keys, for authentication only.
- Revoke a device immediately when it is unpaired.
- Answer `/health` for the container health check. It reveals no device or database details.
- Later: send push notifications to wake the iPhone app.

## Not responsible for

- Reading, decrypting, or executing anything. The bridge only sees routing fields (`id`, `from`, `to`, `expiresAt`) and ciphertext.
- Running any AI.

## Decisions

- The bridge is the only path between devices for the hackathon. Security comes from end-to-end encryption, device signatures, and pairing, not from a private network.
- NetBird stays on the VPS for the team's private access to the server, logs, and dev machines. Yumi's device traffic does not use it.
- Every command expires after 2 minutes. Commands are never queued; goals waiting for an offline device are held on the origin device ([SPEC-09](../specs/09-cross-device-routing.md)).
- Pending `pairRequest` frames live for 5 minutes as specified by the protocol. The mismatch with SPEC-08's 30-second "Mac does not answer" scenario is tracked by [OBJ-33](../objectives/OBJ-33-pairing-response-timeout-contract.md).
- Unpair revokes the pairing and held traffic immediately. The signed frame remains in SQLite and is replayed on reconnect; acknowledgement deletion awaits the frame identifier contract in [OBJ-31](../objectives/OBJ-31-unpair-delivery-ack-contract.md).

## Deployment

- **Address:** `wss://yumibridge.studiokova.co`, IPv4 only (`62.146.237.15`). DNS is an `A` record on Cloudflare, set to "DNS only" (not proxied). There is no `AAAA` record, because the VPS's nginx sites serve HTTPS on IPv4 only.
- **Server:** Brent's VPS (Ubuntu 24.04). Brent prepares it and gives Jepoy SSH access.
- **Reverse proxy:** the existing nginx, with a certificate from certbot (`certbot --nginx`). The site forwards to the bridge on a local port with WebSocket upgrade headers and `proxy_read_timeout 1h`, since nginx's default 60 seconds would cut idle phone connections.
- **Runtime:** a Docker container on a current Node.js LTS image, bound to `127.0.0.1` only. The VPS's system Node is v18 (past end of life) and other apps may rely on it, so the bridge does not use it.
- **Port:** `8787` on `127.0.0.1`. The nginx site already forwards to it. Publish it as `"127.0.0.1:8787:8787"`, never `"8787:8787"`: Docker's published ports bypass ufw, so a bare port would expose the bridge to the internet.
- **Folder:** `/opt/yumi-bridge` on the VPS, with SQLite data in `/opt/yumi-bridge/data` mounted into the container.
- **Prepare:** `install -d -o 1000 -g 1000 -m 0700 /opt/yumi-bridge/bridge/data`.
- **Deploy:** `git pull && docker compose -f bridge/docker-compose.yml up -d --build` from the repository root in `/opt/yumi-bridge`.
- **Check:** `docker compose -f bridge/docker-compose.yml ps` and `docker compose -f bridge/docker-compose.yml logs --tail=100 bridge`. The local health endpoint is `http://127.0.0.1:8787/health`; the public endpoint is `wss://yumibridge.studiokova.co`.
- **Data and logs:** SQLite is in `/opt/yumi-bridge/bridge/data/bridge.sqlite`; logs are structured JSON and contain routing identifiers, connection events, and error codes only. Never copy the database or logs into a ticket without checking for private metadata.
- **Access:** Brent runs deployments unless he explicitly hands Jepoy VPS access. The actual rollout and public endpoint check are tracked in [OBJ-32](../objectives/OBJ-32-production-bridge-deployment.md).
- **Status:** DNS, TLS, and the nginx site were verified on 2026-10-09. The live relay deployment has not been verified.

## Implementation

- TypeScript on Node.js (current LTS), sharing types and the reference crypto code from [protocol](../protocol/README.md).
- WebSocket server behind the VPS's nginx, which handles TLS.
- SQLite for the device registry and the short-lived holding of results and events.
- Logs contain routing fields and errors only, never payloads.

## Local development

- Run `npm ci` and then `npm run dev` from `bridge/`.
- Set `BRIDGE_DATABASE_PATH=./data/bridge.sqlite` and `BRIDGE_HOST=127.0.0.1` for local development.
- Run `npm run verify` for typecheck and relay tests, or `npm run build` for the deployable bundle.
- Run `docker compose -f docker-compose.yml config --quiet` from `bridge/` to validate the Compose service.

## Specs

- [SPEC-08 Device bridge](../specs/08-device-bridge.md)

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-13](../objectives/OBJ-13-bridge-relay-server.md) | Bridge relay server | Jepoy | in-progress |
| [OBJ-30](../objectives/OBJ-30-live-cross-device-bridge-acceptance.md) | Live cross-device bridge acceptance | Jepoy | todo |
| [OBJ-32](../objectives/OBJ-32-production-bridge-deployment.md) | Deploy the bridge relay to the VPS | Jepoy | todo |
<!-- generated:product-objectives:end -->
