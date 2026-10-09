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
- Results, events, notices, and pairing verdicts held for a device that dropped off, until they expire.
- Each open pairing request, for its 30-second answer window.
- Which devices it last refused for an older protocol version, until they connect on its version.

It never sees a pairing secret, an X25519 key, or a payload in plain text.
It logs routing fields, connection events, and errors only (OBJ-13 task 8).

## Connecting

Every connection starts the same way, for every device, every time.

1. The device opens a WebSocket to the bridge URL, always `wss://`.
2. The relay sends `challenge` with 32 new random bytes.
3. The device sends `authenticate`: its device id, its Ed25519 public key, its protocol version, and an Ed25519 signature over the canonical fields `yumi-relay-auth-v1`, the challenge bytes, and the device id.
4. The relay checks, in order:
   - The frame matches the schema, or it refuses with `invalidFrame`.
   - The device id is derived from the public key (see [crypto.md](crypto.md)), or `deviceIdMismatch`.
   - The signature verifies, or `badSignature`.
   - The protocol version is the one it speaks, or `unsupportedVersion`, as in "Another protocol version" below.
     The schema accepts any positive version (`PeerProtocolVersion`), so a device on another version reaches this check instead of failing as `invalidFrame`.
5. A device id the relay has not seen is registered on the spot.
   Because the id is derived from the key, nobody can take over another device's id.
   A registered device that has no pairings can reach nobody, so the relay needs no list of allowed devices.
6. If every check passes, the relay sends `ready`, then every held message and notice for the device, oldest first.
   Otherwise it sends `refused` with the reason and closes the connection.

A device that is refused for any other reason shows the "Bridge down" copy from [SPEC-11](../../specs/11-user-facing-errors.md), never the reason.
A device that loses its connection reconnects with backoff, and shows connected, reconnecting, or offline (SPEC-08 r10).

### Another protocol version

The relay speaks exactly one protocol version, and devices are updated at different times, so a device can be behind the relay or ahead of it.
The relay checks the version only after the signature, so it knows which device it refuses, and nobody can mark another device as out of date.

From protocol version 4 on, `challenge`, `authenticate`, and `refused` only ever gain optional properties, and the signed `yumi-relay-auth-v1` text never changes.
So a device on any later version can always connect far enough to learn why it was refused.

The relay:

- Sends `refused` with `unsupportedVersion` and its own `protocolVersion`, then closes the connection.
- Never registers an unknown device on another version, and never removes a pairing or anything it holds because of a version.
- Remembers a registered device that is behind it, and forgets that once the device connects on its version, or comes back ahead of it.
- Answers a command for a device it remembers as behind with `targetNeedsUpdate` instead of `targetOffline`.
  It learns that a device is behind only when the device tries to connect, so right after the relay is updated, a device that has not tried yet still gets `targetOffline`.
  Like `targetOffline`, the command is dropped, never queued (SPEC-08 r7).
  Results and events for that device are held as usual, and expire after 2 minutes.

The refused device:

- Compares the relay's `protocolVersion` with its own.
  Behind the relay, Yumi on this device needs an update.
  Ahead of it, the relay has not been updated yet, and the user cannot fix that.
  A `refused` frame without a version comes from a relay older than this rule, so the device treats it as ahead.
- Shows the connection state as offline, with the matching error kind rather than `bridgeDown`, so the user can tell it from a network outage.
- Keeps its keys, its pairings, and every unpair it still has to send.
  A refusal never unpairs anything, since the relay is not trusted to unpair two devices.
- Stops reconnecting with backoff, and tries again every `UnsupportedVersionRetrySeconds` (5 minutes) and when the app starts.
  Updating the app restarts it, so an updated device connects at once.

Once it connects on the relay's version, it gets `ready` and everything held for it, as on any reconnect.
Its pairings are unchanged, so no new QR code is needed.

The sender of a command that gets `targetNeedsUpdate` tells the user that Yumi on the other device needs an update, instead of that it is offline.
It can keep the goal waiting for that device, as for an offline device ([SPEC-09](../../specs/09-cross-device-routing.md) requirement 15).

The SPEC-11 copy for these cases is added by [OBJ-42](../../objectives/OBJ-42-version-mismatch-copy.md).
Until then, a refused device shows "Bridge down", and a sender maps `targetNeedsUpdate` to `otherDeviceOffline`.

## Pairing

Pairing happens once, in person, with the phone scanning a QR code on the Mac (SPEC-08 r1).
Both devices must be connected to the relay.

1. The Mac creates a `PairingOffer` and shows it as a QR code holding the offer's JSON text:
   - Its device id, name, platform, and both public keys.
   - A one-time pairing secret: 32 random bytes.
   - The bridge URL.
   - An expiry `PairingOfferSeconds` (5 minutes) ahead.
2. The phone scans it and checks that the protocol version matches and the offer has not expired.
   The QR code's `protocolVersion` is a `PeerProtocolVersion`, so an offer from another version still validates and the phone shows the "Pairing versions differ" error from SPEC-11 rather than "Not a pairing code".
   An expired offer shows "Pairing code expired", and nothing is sent to the Mac (SPEC-08 scenario "Pairing code expired").
3. The phone connects to the bridge URL from the offer and sends `pairRequest` to the Mac.
   The frame holds a `PairRequest` (the phone's name, platform, and public keys) sealed with the pairing secret ([crypto.md](crypto.md), "Pairing request").
   The relay can neither read the phone's name nor swap in its own keys, because it never sees the secret (SPEC-08 r3).
4. The relay checks that `from` is the authenticated sender and opens the request for `PairingAnswerSeconds` (30 seconds), by its own clock.
   It forwards the frame unchanged, at once if the Mac is connected, or when the Mac reconnects within the window.
   A new request between the same two devices replaces the old one and starts a new window.
5. The Mac checks the request, and silently drops it if any check fails:
   - It has an unused, unexpired offer.
   - The request opens with that offer's secret, for this `from` and `to`.
   - `from` is derived from the request's Ed25519 public key.
6. The Mac reserves the offer for this phone, keeps the phone's id, name, and public keys as pending, and sends `pairAccept`.
   It holds an Ed25519 signature over the canonical fields `yumi-pair-accept-v1`, `from` (the Mac), `to` (the phone), the phone's Ed25519 public key, and the phone's X25519 public key.
7. The relay decides, as in "The answer window" below.
   If the accept counts, the relay records the two as paired, forwards `pairAccept` to the phone, and sends the Mac `paired`.
8. The phone verifies the signature with the Mac's key from the QR code and stores the Mac's id, name, and public keys.
9. On `paired`, the Mac marks the secret as used and stores the phone.
10. Both show "Paired with <device name>" (SPEC-08 scenario "Pair the phone with the Mac").

The relay pairs two devices only when both took part: the phone's request and the Mac's accept.

### The answer window

The QR code lasts 5 minutes, but the phone waits only 30 seconds for the Mac's answer (SPEC-08 scenario "Mac does not answer pairing").
The relay's clock is the only one that decides whether an answer was in time, so a pairing never completes after the phone was told it failed.

- **In time:** an accept counts only while its request is open and the phone is connected.
  The relay then pairs the two, forwards `pairAccept`, and sends the Mac `paired`, all in one step.
- **Too late:** an accept for a request that is closed, cancelled, or unknown is dropped, and the Mac gets `pairExpired`.
- **Phone offline:** an accept that finds the phone disconnected closes the request.
  The Mac gets `pairExpired`, and the phone gets it when it reconnects.
- **No answer:** when the window ends, the relay closes the request and sends `pairExpired` to both devices.
  That covers a Mac that is offline the whole time, and a Mac that silently dropped the request.
- **Cancelled:** the phone sends `pairCancel` when it stops waiting early, for example when the user leaves the pairing screen.
  The relay closes the request and sends the Mac `pairExpired`.
  A cancel for a request that is not open is ignored.
- **Unpaired:** an `unpair` between the two closes any request still open between them, and both get `pairExpired`.

The relay checks the window on every `pairAccept`, so a late answer never counts.
It sweeps closed windows once a second, so `pairExpired` for an unanswered request reaches the phone up to a second after the 30 seconds.

One case is left to the phone: the relay pairs as soon as it hands `pairAccept` to the phone's connection, and a connection that dies at that moment loses it.
The Mac then shows "Paired with <device name>" while the phone never hears back, gives up after 60 seconds, and sends the `unpair` below, which the Mac then follows to "Not paired".

`paired` and `pairExpired` name the other device in `device`.
A verdict for a device that is offline is held for 2 minutes, like a notice, and the newest verdict between two devices replaces the last.
A new request between the same two devices forgets the held verdicts, so an old `pairExpired` never closes a new attempt.
A held verdict can arrive more than once, so each device acts on one only while it waits for that device.

The phone:

- Shows "Paired with <device name>" on `pairAccept`, and "Mac didn't answer pairing" from SPEC-11 on `pairExpired`.
  While it is connected it never decides on its own clock, because the relay always answers within the window.
- Keeps waiting through a short reconnect, since the verdict is held for it.
- Gives up on its own only when it gets no verdict within 60 seconds of sending the request, for example while it cannot reach the relay.
  It then shows "Mac didn't answer pairing" and, on its next connection, sends `pairCancel` and a signed `unpair` for that Mac.
  The relay ignores both if nothing is open or paired, and otherwise they undo a pairing whose `pairAccept` the phone never received.
  A phone that was already paired with that Mac before this attempt sends only `pairCancel`.
- Answers a `pairAccept` for a request it cancelled or gave up on with a signed `unpair`, and never stores that Mac.

The Mac:

- Acts on a verdict only for the phone it has pending.
- On `pairExpired`, forgets the pending phone; the offer is usable again until it expires.
- Keeps the pending phone through a short reconnect, since the verdict is held for it.
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

Every notice the relay sends (`ack`, `targetOffline`, `targetNeedsUpdate`, `expired`, `notPaired`) names the message id.
A notice for a sender that is offline is held for 2 minutes, like an event.

The sender resends an envelope the relay has not acked, with the same id, after it reconnects, as long as the envelope has not expired.
So a message can arrive twice, and the receiver runs each id at most once and resends the stored result for a repeat (SPEC-08 r8).

The relay's notices map to [SPEC-11](../../specs/11-user-facing-errors.md) error kinds:

| Notice | `ErrorKind` |
|---|---|
| `targetOffline` | `otherDeviceOffline` |
| `targetNeedsUpdate` | `otherDeviceOffline`, until OBJ-42 adds its own kind |
| `expired` | `commandExpired` |
| `notPaired` | `unpairedDevice` |
| `refused`, or no connection | `bridgeDown`, except `unsupportedVersion` as above |

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
Devices that speak another protocol version are refused during relay authentication, as in "Another protocol version" above.
An unpair the relay holds has no expiry, so a version that changes `UnpairFrame` must say how the relay carries held unpairs over.

## Lost device or key

The keys of a lost or compromised device are revoked by unpairing it from the device the user still has.
The relay removes the pairing at once, so the lost device can no longer reach the other, whatever keys it holds.
The lost device's registration stays at the relay, but with no pairings it can reach nobody.

Keys are never rotated in place.
A device that needs new keys creates them, which gives it a new device id, and pairs again with a new QR code.

## Limits

- Envelope payloads are at most 1 MiB of base64 text.
  Larger files wait for the direct path in SPEC-08 "Later (p1)".
- A pairing offer lasts 5 minutes (`PairingOfferSeconds`).
- A pairing request stays open for 30 seconds at the relay (`PairingAnswerSeconds`).
  A held pairing verdict lasts 2 minutes.
