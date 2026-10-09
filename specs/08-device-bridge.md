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
4. Every message uses the envelope in the design doc: `id`, `from`, `to`, `type`, `replyTo`, `expiresAt`, `protocolVersion`, `signature`, `payload`.
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

- **Transport:** the plain VPS bridge is the only path between devices for the hackathon. Security comes from end-to-end encryption, device signatures, and pairing, not from a private network. Decided 2026-10-09.
- **NetBird is not used by Yumi.** It cannot replace the bridge, because offline notices, short-reconnect delivery, and phone wake-ups still need the VPS. Running it on the phone would take Android's only VPN slot and make Yumi depend on another app staying connected. NetBird stays on the VPS for the team's private access to the server, logs, and dev machines. Decided 2026-10-09.
- **Command expiry:** every command expires after 2 minutes. Decided 2026-10-09, replacing the earlier "2 minutes for UI actions, 1 hour for data requests".
- **No command queue on the VPS.** Commands to an offline device fail at once. Queued goals live on the origin device ([SPEC-09](09-cross-device-routing.md)). The VPS only holds results and events through short reconnects, until they expire. This follows SPEC-09 where the two specs disagreed: it is simpler, and an old command never runs late and surprises the user. Decided 2026-10-09.

## Open questions

- Should the VPS be able to read `replyTo`?
  Requirement 3 lists the fields the VPS sees without `replyTo`, but requirement 4 puts `replyTo` in the envelope, outside the encrypted payload.
  Readable, it lets the VPS link each result to its command; the VPS can already guess this from timing.
  Options: (a) keep it readable and add it to requirement 3, or (b) move it inside the encrypted payload.
  Recommendation: (b), because the VPS never needs it and it costs nothing before any client is built.
  `protocol/` keeps it readable until this is decided (OBJ-02).
- What does the phone say when pairing fails, for example because the QR code expired or the Mac did not answer?
  [SPEC-11](11-user-facing-errors.md) has no copy for it yet.

## Later (p1)

- Direct device-to-device path for large files (photos, PDFs) when both devices are on the same network, using a WebRTC connection set up through the bridge, falling back to the bridge. No separate VPN app needed.
