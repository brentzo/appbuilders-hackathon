# Pairing and the relay connection

How a device connects to the relay, how the phone and Mac pair, how messages are delivered, and how a device is unpaired ([SPEC-08](../../specs/08-device-bridge.md)).
The crypto behind every step is in [crypto.md](crypto.md).
Every frame is a `BridgeFrame` in [`schemas/bridge.json`](../schemas/bridge.json), sent as one WebSocket text message of JSON.

Who builds what:

- The relay: [OBJ-13](../../objectives/OBJ-13-bridge-relay-server.md).
- The Mac client: [OBJ-21](../../objectives/OBJ-21-mac-bridge-client-and-pairing.md).
- The Android client: [OBJ-23](../../objectives/OBJ-23-android-bridge-client.md).

## What the relay knows

- Each device's id and Ed25519 public key.
- Which devices are paired with each other.
- Results, events, and notices held for a device that dropped off, until they expire.

It never sees a pairing secret, an X25519 key, or a payload in plain text.
It logs routing fields, connection events, and errors only (OBJ-13 task 8).

## Connecting

Every connection starts the same way, for every device, every time.

1. The device opens a WebSocket to the bridge URL, always `wss://`.
2. The relay sends `challenge` with 32 new random bytes.
3. The device sends `authenticate`: its device id, its Ed25519 public key, its protocol version, and an Ed25519 signature over the canonical fields `yumi-relay-auth-v1`, the challenge bytes, and the device id.
4. The relay checks, in order:
   - The frame matches the schema, or it refuses with `invalidFrame`.
   - The protocol version is one it speaks, or `unsupportedVersion`.
     The schema accepts any positive version (`PeerProtocolVersion`), so a device on another version reaches this check instead of failing as `invalidFrame`.
   - The device id is derived from the public key (see [crypto.md](crypto.md)), or `deviceIdMismatch`.
   - The signature verifies, or `badSignature`.
5. A device id the relay has not seen is registered on the spot.
   Because the id is derived from the key, nobody can take over another device's id.
   A registered device that has no pairings can reach nobody, so the relay needs no list of allowed devices.
6. If every check passes, the relay sends `ready`, then every held message and notice for the device, oldest first.
   Otherwise it sends `refused` with the reason and closes the connection.

A device that is refused shows the "Bridge down" copy from [SPEC-11](../../specs/11-user-facing-errors.md), never the reason.
A device that loses its connection reconnects with backoff, and shows connected, reconnecting, or offline (SPEC-08 r10).

## Pairing

Pairing happens once, in person, with the phone scanning a QR code on the Mac (SPEC-08 r1).
Both devices must be connected to the relay.

1. The Mac creates a `PairingOffer` and shows it as a QR code holding the offer's JSON text:
   - Its device id, name, platform, and both public keys.
   - A one-time pairing secret: 32 random bytes.
   - The bridge URL.
   - An expiry 5 minutes ahead.
2. The phone scans it and checks that the protocol version matches and the offer has not expired.
   The QR code's `protocolVersion` is a `PeerProtocolVersion`, so an offer from another version still validates and the phone shows the "Pairing versions differ" error from SPEC-11 rather than "Not a pairing code".
3. The phone connects to the bridge URL from the offer and sends `pairRequest` to the Mac.
   The frame holds a `PairRequest` (the phone's name, platform, and public keys) sealed with the pairing secret ([crypto.md](crypto.md), "Pairing request").
   The relay can neither read the phone's name nor swap in its own keys, because it never sees the secret (SPEC-08 r3).
4. The relay checks that `from` is the authenticated sender, remembers the request for 5 minutes, and forwards the frame unchanged.
5. The Mac checks the request, and silently drops it if any check fails:
   - It has an unused, unexpired offer.
   - The request opens with that offer's secret, for this `from` and `to`.
   - `from` is derived from the request's Ed25519 public key.
6. The Mac marks the secret as used, stores the phone's id, name, and public keys, and sends `pairAccept`.
   It holds an Ed25519 signature over the canonical fields `yumi-pair-accept-v1`, `from` (the Mac), `to` (the phone), the phone's Ed25519 public key, and the phone's X25519 public key.
7. The relay sees an accept from the Mac that matches a pending request from the phone, records the two as paired, and forwards the frame.
8. The phone verifies the signature with the Mac's key from the QR code and stores the Mac's id, name, and public keys.
9. Both show "Paired with <device name>" (SPEC-08 scenario "Pair the phone with the Mac").

The relay pairs two devices only when both took part: the phone's request and the Mac's accept.
A device can be paired with more than one device, for example a Mac with an Android phone and later an iPhone.
Each pairing is between two devices.

## Sending a message

1. The sender seals an `Envelope` for the paired device ([crypto.md](crypto.md)) and sends it in an `envelope` frame.
2. The relay checks the frame, and that `from` is the authenticated sender.
   A frame that fails is dropped and logged.
3. The relay drops the envelope and tells the sender, in this order:
   - `notPaired` if the two devices are not paired.
   - `expired` if `expiresAt` has passed.
4. A command is never stored (SPEC-08 r7):
   - If the target is online, the relay forwards it and acks it to the sender.
   - If the target is offline, the relay drops it at once and the sender gets `targetOffline`.
5. A result or event is stored until the receiver acks it or it expires, so a connection that drops mid-delivery loses nothing (SPEC-08 r7).
   The relay acks it to the sender once stored, and forwards it at once if the target is online.
6. The receiver acks every envelope it gets, and the relay then deletes it.
7. On reconnect, the relay delivers every held, unexpired message again, oldest first.
   A message that expires while held is deleted, and the sender gets `expired`.

A command that reaches the receiver after its expiry is never run (SPEC-08 r6).
If its id already ran, the receiver resends the stored result; otherwise it tells the sender the command expired.
That reply is a payload kind, defined in [OBJ-25](../../objectives/OBJ-25-cross-device-messages.md).

Every notice the relay sends (`ack`, `targetOffline`, `expired`, `notPaired`) names the message id.
A notice for a sender that is offline is held for 2 minutes, like an event.

The sender resends an envelope the relay has not acked, with the same id, after it reconnects, as long as the envelope has not expired.
So a message can arrive twice, and the receiver runs each id at most once and resends the stored result for a repeat (SPEC-08 r8).

The relay's notices map to [SPEC-11](../../specs/11-user-facing-errors.md) error kinds:

| Notice | `ErrorKind` |
|---|---|
| `targetOffline` | `otherDeviceOffline` |
| `expired` | `commandExpired` |
| `notPaired` | `unpairedDevice` |
| `refused`, or no connection | `bridgeDown` |

A `notPaired` notice only fails the message that caused it.
The device never deletes keys because of it, since the relay is not trusted to unpair two devices.

## Unpairing

Either device can unpair the other (SPEC-08 r9).

1. The device deletes the other's keys and creates `unpair` with a UUID `id`, the current time, and an Ed25519 signature over the canonical fields `yumi-unpair-v1`, `id`, `from`, `to`, and that time.
2. The sender retries the exact same signed frame until the relay acknowledges its `id`.
3. The relay checks that `from` is the authenticated sender, removes the pairing at once, deletes every message it holds between the two, durably records the frame, and acknowledges the `id` to the sender.
4. The relay forwards the frame and holds it until the other device acknowledges the same `id`, however long that takes.
5. The other device verifies the signature with the sender's key and checks that the time is later than when the two paired, so an old frame cannot be replayed after pairing again.
6. The other device atomically records the `id`, deletes the sender's keys, and acknowledges it.
7. A duplicate unpair with the same id has no additional effect and is acknowledged again. The relay retains the receipt until the devices pair again, then clears it; an ACK from a different device or for another id cannot clear the queued frame.
8. Both show "Not paired" (SPEC-08 scenario "Unpair a device").

From then on, the relay answers any envelope between the two with `notPaired`, and each device drops envelopes from a device it has no keys for (SPEC-08 r5).
Pairing again needs a new QR code.

Protocol version 4 adds the required unpair id and includes it in the signed bytes.
Devices that speak another protocol version are refused during relay authentication.

## Lost device or key

The keys of a lost or compromised device are revoked by unpairing it from the device the user still has.
The relay removes the pairing at once, so the lost device can no longer reach the other, whatever keys it holds.
The lost device's registration stays at the relay, but with no pairings it can reach nobody.

Keys are never rotated in place.
A device that needs new keys creates them, which gives it a new device id, and pairs again with a new QR code.

## Limits

- Envelope payloads are at most 1 MiB of base64 text.
  Larger files wait for the direct path in SPEC-08 "Later (p1)".
- A pairing offer and a pending pairing request last 5 minutes.
