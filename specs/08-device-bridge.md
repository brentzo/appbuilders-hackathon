---
id: SPEC-08
title: Device bridge
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, bridge, safety, mac, android]
---

# SPEC-08 Device bridge

## Summary

The Mac and the phone send commands, results, and events to each other through our VPS.
The VPS only relays and stores encrypted messages; it can never read them.
Design: [device-bridge](../docs/device-bridge.md).

## Requirements

1. Devices pair once, in person, by scanning a QR code shown on the Mac with the phone.
2. Pairing creates a key pair per device. Messages are encrypted end to end and signed by the sender.
3. The VPS sees only routing fields (`id`, `from`, `to`, `type`, `expiresAt`, `protocolVersion`) and ciphertext. It needs `type` to tell commands, which it never holds, from results and events, which it holds through a short reconnect (requirement 7).
4. Every message uses the envelope in the design doc: `id`, `from`, `to`, `type`, `expiresAt`, `protocolVersion`, `signature`, `payload`. A result's `replyTo` is inside the encrypted payload.
5. Messages with a bad signature or from an unpaired device are dropped and logged on the receiving device.
6. Expired commands are never executed. Every single command (one tool call) expires after 2 minutes, as in [SPEC-09](09-cross-device-routing.md) requirement 16.
7. The VPS never queues commands. If the target device is offline, the VPS at once tells the sender, and the sender's brain tells the user. Whole goals waiting for an offline device are held on the origin device, not on the VPS ([SPEC-09](09-cross-device-routing.md) requirement 15). Results and events for a device that drops off briefly are held on the VPS until they expire (2 minutes), so a short reconnect does not lose a result.
8. Each message is executed at most once, even if delivered twice.
9. The user can unpair a device from either side, which revokes its keys immediately.
10. Both apps show a clear connection state: connected, reconnecting, or offline.

## Scenarios

```gherkin
@p0 @bridge @mac @android
Feature: Pairing

  Scenario: Pair the phone with the Mac
    Given the Mac shows a pairing QR code
    When the user scans it with the Yumi app on the phone
    Then both devices show "Paired with <device name>"
    And each device stores the other's public key

  Scenario: Unpair a device
    Given the Mac and phone are paired
    When the user taps "Unpair" on the phone
    Then the Mac rejects any further message from the phone
    And both devices show "Not paired"
    And the sender retries the same signed unpair id until the relay acknowledges durable storage
    And the relay retains the unpair until the receiving device acknowledges that id
    And duplicate delivery does not repeat unpair side effects and receives the same acknowledgement

## Decisions

- Unpair delivery uses a UUID signed by the sender.
  The relay acknowledges durable receipt to the sender, and the recipient acknowledges delivery using the same id.
  Retries reuse the original signed frame.
  A new pairing clears the old unpair receipt, and stale acknowledgements cannot remove a different unpair.
  See [protocol/docs/pairing.md](../protocol/docs/pairing.md).
- The required id and signed-byte change are a breaking protocol change, so the shared protocol version is 4.

  Scenario: Pairing code expired
    Given the Mac showed a pairing QR code more than 5 minutes ago
    When the user scans it with the Yumi app on the phone
    Then the phone shows the "Pairing code expired" copy from SPEC-11
    And nothing is sent to the Mac

  Scenario: Mac does not answer pairing
    Given the user scanned a valid pairing QR code
    When the Mac does not answer within 30 seconds
    Then the phone shows the "Mac didn't answer pairing" copy from SPEC-11
    And the phone is not paired
```

```gherkin
@p0 @bridge @mac @android
Feature: Message delivery

  Scenario: VPS cannot read messages
    Given the phone sends "set an alarm for 6:30 am" to the Mac
    When the message passes through the VPS
    Then the VPS stores only routing fields and ciphertext

  Scenario: Message from an unknown device is dropped
    Given a message arrives signed by a device that is not paired
    Then it is not executed
    And it is recorded in the receiving device's log

  Scenario: Command to an offline device fails at once
    Given the phone is offline
    When the Mac sends the command "set_alarm" to the phone
    Then the VPS does not queue it
    And the Mac is told at once that the phone is offline

  Scenario: Result survives a short reconnect
    Given the phone ran a command from the Mac
    And the Mac dropped off the bridge before the result arrived
    When the Mac reconnects within 2 minutes
    Then the Mac receives the result

  Scenario: Expired command is not run
    Given a command reaches the phone after its expiry time, for example after a slow reconnect
    Then the command is not run
    And the sender is told it expired

  Scenario: Duplicate delivery runs once
    Given the phone received command "abc" and ran it
    When command "abc" is delivered again
    Then it is not run a second time
    And the original result is sent back again
```

## Decisions

- **`replyTo` is encrypted.** It moves inside the encrypted payload, so the VPS cannot link a result to its command. The VPS never needs it, and changing it costs nothing before any client is built. Requirement 3 stays as written. The protocol matches it (`bridge.json` and the signed routing fields in `crypto.md`). Decided 2026-10-09.
- **Pairing failures** show the phone copy added to SPEC-11 for an expired code, a code that is not Yumi's, different versions, and no answer from the Mac within 30 seconds. Decided 2026-10-09.
- **Transport:** the plain VPS bridge is the only path between devices for the hackathon. Security comes from end-to-end encryption, device signatures, and pairing, not from a private network. Decided 2026-10-09.
- **NetBird is not used by Yumi.** It cannot replace the bridge, because offline notices, short-reconnect delivery, and phone wake-ups still need the VPS. Running it on the phone would take Android's only VPN slot and make Yumi depend on another app staying connected. NetBird stays on the VPS for the team's private access to the server, logs, and dev machines. Decided 2026-10-09.
- **Command expiry:** every command expires after 2 minutes. Decided 2026-10-09, replacing the earlier "2 minutes for UI actions, 1 hour for data requests".
- **No command queue on the VPS.** Commands to an offline device fail at once. Queued goals live on the origin device ([SPEC-09](09-cross-device-routing.md)). The VPS only holds results and events through short reconnects, until they expire. This follows SPEC-09 where the two specs disagreed: it is simpler, and an old command never runs late and surprises the user. Decided 2026-10-09.

## Open questions

None.

## Later (p1)

- Direct device-to-device path for large files (photos, PDFs) when both devices are on the same network, using a WebRTC connection set up through the bridge, falling back to the bridge. No separate VPN app needed.
