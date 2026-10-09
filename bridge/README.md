# Yumi Bridge

The relay server on our VPS that connects the Mac and the phone in both directions.
It only routes and stores encrypted messages.
It can never read them.

Owner: Jepoy.

Status: empty scaffold, nothing built yet.

## Responsibilities

- Accept WebSocket connections from paired devices, authenticated by their device keys.
- Route each message to the device named in its `to` field.
- Tell the sender at once when a command's target is offline. Never queue commands.
- Hold results and events through a short reconnect, until they expire.
- Drop expired messages, and tell the sender a message expired.
- Keep a registry of paired devices and their public keys, for authentication only.
- Revoke a device immediately when it is unpaired.
- Later: send push notifications to wake the iPhone app.

## Not responsible for

- Reading, decrypting, or executing anything. The bridge only sees routing fields (`id`, `from`, `to`, `expiresAt`) and ciphertext.
- Running any AI.

## Decisions

- The bridge is the only path between devices for the hackathon. Security comes from end-to-end encryption, device signatures, and pairing, not from a private network.
- NetBird stays on the VPS for the team's private access to the server, logs, and dev machines. Yumi's device traffic does not use it.
- Every command expires after 2 minutes. Commands are never queued; goals waiting for an offline device are held on the origin device ([SPEC-09](../specs/09-cross-device-routing.md)).

## Initial technical plan

- TypeScript on Node.js (current LTS), sharing types and the reference crypto code from [protocol](../protocol/README.md).
- WebSocket server behind a reverse proxy that handles TLS (for example Caddy).
- SQLite for the device registry and the short-lived holding of results and events.
- Logs contain routing fields and errors only, never payloads.

## Specs

- [SPEC-08 Device bridge](../specs/08-device-bridge.md)

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-13](../objectives/OBJ-13-bridge-relay-server.md) | Bridge relay server | Jepoy | todo |
<!-- generated:product-objectives:end -->
