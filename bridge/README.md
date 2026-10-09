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
- A `pairRequest` stays open for 30 seconds by the relay's clock, held for a Mac that reconnects within that window.
  The relay alone decides whether the Mac's `pairAccept` was in time: it pairs, forwards, and sends the Mac `paired` in one step, or sends `pairExpired`.
  Verdicts for an offline device are held for 2 minutes ([OBJ-33](../objectives/OBJ-33-pairing-response-timeout-contract.md), `protocol/docs/pairing.md` "The answer window").
- The relay refuses a device on another protocol version with its own version, after checking the device's signature.
  It keeps the device's registration and pairings, and answers a command for a device that is behind with `targetNeedsUpdate` instead of `targetOffline` ([OBJ-34](../objectives/OBJ-34-protocol-version-upgrade-recovery.md), `protocol/docs/pairing.md` "Another protocol version").
- Unpair revokes the pairing and held traffic immediately. The signed frame remains in SQLite and is replayed on reconnect; acknowledgement deletion awaits the frame identifier contract in [OBJ-31](../objectives/OBJ-31-unpair-delivery-ack-contract.md).

## Deployment

- **Address:** `wss://yumibridge.studiokova.co`, IPv4 only (`62.146.237.15`). DNS is an `A` record on Cloudflare, set to "DNS only" (not proxied). There is no `AAAA` record, because the VPS's nginx sites serve HTTPS on IPv4 only.
- **Server:** Brent's VPS (Ubuntu 24.04). Brent prepares it and gives Jepoy SSH access.
- **Reverse proxy:** the existing nginx, with a certificate from certbot (`certbot --nginx`). The site forwards to the bridge on a local port with WebSocket upgrade headers and `proxy_read_timeout 1h`, since nginx's default 60 seconds would cut idle phone connections.
- **Runtime:** a Docker container on a current Node.js LTS image, bound to `127.0.0.1` only. The VPS's system Node is v18 (past end of life) and other apps may rely on it, so the bridge does not use it.
- **Port:** `8787` on `127.0.0.1`. The nginx site already forwards to it. Publish it as `"127.0.0.1:8787:8787"`, never `"8787:8787"`: Docker's published ports bypass ufw, so a bare port would expose the bridge to the internet.
- **Docker:** the VPS has Snap's Docker (`/snap/bin/docker`). Snap confinement means two things:
  - The project must live under root's home, not `/opt`, or Compose cannot read it. The VPS's other projects follow the same rule.
  - Containers cannot use `no-new-privileges`, or no program starts in them. The relay still runs as the unprivileged `node` user, with every capability dropped and a read-only filesystem.
- **Folder:** `/root/dev/brent/yumi-bridge` on the VPS. It holds only `bridge/` and `protocol/` from a pushed commit, plus a `REVISION` file naming that commit. The VPS has no access to the GitHub repository.
- **Prepare (once):** `install -d -o 1000 -g 1000 -m 0700 /root/dev/brent/yumi-bridge/bridge/data`.
- **Deploy:** from your clone, after pushing, run:

  ```sh
  C=$(git rev-parse --short origin/main)
  git archive --format=tar origin/main bridge protocol | ssh contabovps "cd /root/dev/brent/yumi-bridge && tar -x && echo $C > REVISION"
  ssh contabovps 'cd /root/dev/brent/yumi-bridge && BRIDGE_REVISION=$(cat REVISION) docker compose -f bridge/docker-compose.yml up -d --build'
  ```

  `bridge/data` is not in the archive, so the database is kept.
  `/health` then answers `{"status":"ok","protocolVersion":4,"revision":"<commit>"}`, which is how a check knows which build it ran against.
- **Check:** `docker compose -f bridge/docker-compose.yml ps` and `docker compose -f bridge/docker-compose.yml logs --tail=100 bridge` in that folder. The local health endpoint is `http://127.0.0.1:8787/health`; the public one is `https://yumibridge.studiokova.co/health`, and devices connect to `wss://yumibridge.studiokova.co`.
- **Data and logs:** SQLite is in `/root/dev/brent/yumi-bridge/bridge/data/bridge.sqlite`; logs are structured JSON and contain routing identifiers, connection events, and error codes only. Never copy the database or logs into a ticket without checking for private metadata.
- **Access:** Brent runs deployments unless he explicitly hands Jepoy VPS access.
- **Protocol version bumps:** the relay accepts only its own protocol version, so redeploy it whenever `ProtocolVersion` changes. On 2026-10-09 the Mac was refused with `unsupportedVersion` for about 2 hours after the bump to version 4, until the relay was redeployed.
- **Status:** deployed and verified on 2026-10-09; see [wiki/bridge-deployment.md](../wiki/bridge-deployment.md).

## Implementation

- TypeScript on Node.js (current LTS), sharing types and the reference crypto code from [protocol](../protocol/README.md).
- WebSocket server behind the VPS's nginx, which handles TLS.
- SQLite for the device registry and the short-lived holding of results and events.
- Logs contain routing fields and errors only, never payloads.

## Local development

- Run `npm ci` and then `npm run dev` from `bridge/`.
- Set `BRIDGE_DATABASE_PATH=./data/bridge.sqlite` and `BRIDGE_HOST=127.0.0.1` for local development.
- Run `npm run verify` for typecheck and relay tests, or `npm run build` for the deployable bundle.
- Run `npm run live-check` to check a deployed relay against SPEC-08 with stand-in devices (default `wss://yumibridge.studiokova.co`; `--url` for another, `--skip-slow` to leave out the 30-second pairing window). See [wiki/bridge-acceptance.md](../wiki/bridge-acceptance.md).
- Run `docker compose -f docker-compose.yml config --quiet` from `bridge/` to validate the Compose service.

## Specs

- [SPEC-08 Device bridge](../specs/08-device-bridge.md)

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-13](../objectives/OBJ-13-bridge-relay-server.md) | Bridge relay server | Jepoy | done |
| [OBJ-30](../objectives/OBJ-30-live-cross-device-bridge-acceptance.md) | Live cross-device bridge acceptance | Jepoy | blocked |
| [OBJ-32](../objectives/OBJ-32-production-bridge-deployment.md) | Deploy the bridge relay to the VPS | Brent | done |
<!-- generated:product-objectives:end -->
