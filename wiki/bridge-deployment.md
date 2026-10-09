# Bridge deployment

Date: 2026-10-09.
Objective: [OBJ-32](../objectives/OBJ-32-production-bridge-deployment.md).
Spec: [SPEC-08](../specs/08-device-bridge.md).

## Summary

The bridge relay runs on Brent's VPS behind nginx and TLS at `wss://yumibridge.studiokova.co`.
It was deployed from commit `5f00ac9` and passed every check below.

## Where it runs

- Ubuntu 24.04 VPS (`ssh contabovps`), IPv4 `62.146.237.15`.
- Folder `/root/dev/brent/yumi-bridge`, holding `bridge/`, `protocol/`, and a `REVISION` file with the commit.
- Docker Compose service `bridge-bridge-1`, image `yumi-bridge:local`, restart unless stopped.
- Published only on `127.0.0.1:8787`; nginx terminates TLS and forwards WebSocket upgrades with a 1 hour read timeout.
- SQLite in `bridge/data/bridge.sqlite`, owned by uid 1000, mode 0700 folder.

## Snap Docker

The VPS's Docker is the Snap package, which needed two changes:

- `/opt` is outside what Snap's Docker may read, so Compose failed with "no such file or directory". The project moved under `/root/dev/brent/`, next to the VPS's other Compose projects.
- With `security_opt: no-new-privileges`, every program start in the container failed with "operation not permitted". Testing one option at a time showed `no-new-privileges` is the only cause; `init`, `cap_drop: ALL`, and `read_only` all work. The option was removed from `bridge/docker-compose.yml`.

## Checks

| Check | Result |
|---|---|
| Container health | `Up (healthy)`; `http://127.0.0.1:8787/health` returns `{"status":"ok"}` |
| Public endpoint | `https://yumibridge.studiokova.co/health` returns `{"status":"ok"}` (was 502 before) |
| Port exposure | Port 8787 refuses connections from the internet; it listens on `127.0.0.1` only |
| Valid device | A fresh device key authenticates and gets `ready`; Brent's Mac harness authenticated with protocol version 3 |
| Signed by another key | Refused, `badSignature` |
| Signature over a different nonce | Refused, `badSignature` |
| Old protocol version (2) | Refused, `unsupportedVersion` (reachable since protocol version 3) |
| A frame other than authenticate | Refused, `invalidFrame` |
| Restart | After `docker compose restart`, both registered devices were still in the database, and the Mac reconnected by itself |
| Storage | Tables hold device ids, public signing keys, pairings, and sealed frames; no payload columns in plain text |
| Logs | Routing fields, connection events, and refusal reasons only |

## Not verified

- Real message traffic, since no phone is paired yet. [OBJ-30](../objectives/OBJ-30-live-cross-device-bridge-acceptance.md) covers it.
- OBJ-13's open items (unpair acknowledgement in OBJ-31, pairing timeout in OBJ-33) are not in this build; redeploy when they land.

## Redeploy

See "Deployment" in [bridge/README.md](../bridge/README.md).
