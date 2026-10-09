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
3. The VPS sees only routing fields (`id`, `from`, `to`, `expiresAt`) and ciphertext.
4. Every message uses the envelope in the design doc: `id`, `from`, `to`, `type`, `replyTo`, `expiresAt`, `signature`, `payload`.
5. Messages with a bad signature or from an unpaired device are dropped and logged on the receiving device.
6. Expired commands are never executed.
7. The VPS stores messages for an offline device and delivers them when it reconnects.
8. Each message is executed at most once, even if delivered twice.
9. The user can unpair a device from either side, which revokes its keys immediately.
10. Both apps show a clear connection state: connected, reconnecting, or offline.

## Scenarios

```gherkin
@p0 @bridge @mac @android
Feature: Pairing

  Scenario: Pair the phone with the Mac
    Given the Mac shows a pairing QR code
    When the user scans it with the companion app on the phone
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

  Scenario: Offline device receives queued messages
    Given the phone is offline
    When the Mac sends a command to the phone that expires in 10 minutes
    And the phone reconnects 2 minutes later
    Then the phone receives and runs the command

  Scenario: Expired command is not run
    Given a command to the phone expired while the phone was offline
    When the phone reconnects
    Then the command is not run
    And the sender is told it expired

  Scenario: Duplicate delivery runs once
    Given the phone received command "abc" and ran it
    When command "abc" is delivered again
    Then it is not run a second time
    And the original result is sent back again
```

## Open questions

- Default expiry per command type? Suggest 2 minutes for UI actions, 1 hour for data requests.
- Do we use NetBird for a direct device-to-device path, with the VPS as fallback relay?
