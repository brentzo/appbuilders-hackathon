---
type: design
status: draft
created: 2026-10-09
tags: [idea, yumi, harness, design, mobile, bridge]
---

# Device Bridge

Part of [Yumi](yumi.md).
Extends the [Lane Router](lane-router.md) with a device dimension.

The Mac and the phone control each other in both directions through a VPS bridge.
The user can speak on either device, and the task runs on whichever device can do it.

## Priority

1. **Android first.** It can stay connected in the background, and later (p1) run a model and control other apps.
2. **iPhone second.** Limited to its own app's tools, mostly while the app is open.

## Devices are tool providers

Each device advertises its tools over the bridge.
The brain sees one combined tool list and picks the device the same way the lane router picks a lane.

| Device | Brain | Example tools |
|---|---|---|
| Mac (16 GB) | Qwen3.5-9B, main brain | `gui_act` and typed tools only: `open_app`, `open_file`, `open_url`, `reveal_in_finder`, `read_file`, `list_dir`, `write_new_file`, `copy`, `move`, `move_to_trash`. No shell or AppleScript ([SPEC-07](../specs/07-safety.md)) |
| Android (12 GB demo phone, 8 GB dev phone) | p0: none, a fixed rule. p1: one fixed model on the demo phone | p0: `set_alarm`, `set_timer`, `open_app`. p1 adds `phone_gui_act`, `get_location`, `read_recent_photos` |
| iPhone (later) | none at first | Tools exposed by our own app, plus Shortcuts |

## Who decides

- **Voice on the Mac:** the Mac brain routes, and calls phone tools over the bridge when needed.
- **Voice on Android:** p0, a fixed rule decides "phone or laptop" (alarm, timer, and open app stay on the phone). p1, the phone model decides. See [SPEC-09](../specs/09-cross-device-routing.md), which is now the source of truth for routing.
  Phone tasks run locally.
  Laptop tasks are sent to the Mac brain as a goal.
- **Mac asleep or offline:** the phone says the laptop is offline and queues the task until it reconnects.

## Android control

Superseded in detail by [SPEC-10](../specs/10-android-companion.md): Part A (p0) has no model, Part B (p1) adds one.
The notes below describe Part B.

- **12 GB phone (teammate's), main demo device.** Advertised as "12 GB + 6 GB", but the extra 6 GB is extended RAM (storage used as slow swap), so only 12 GB is real memory. Android and other apps use ~4-5 GB, leaving ~7-8 GB. Qwen3.5-4B (~2.7 GB) fits with room for screenshots and context. Qwen3.5-9B (~6 GB) is too tight to run reliably.
- **8 GB phone (Brent's), development device.** Part A only.

- **Read the screen:** Accessibility Service element tree first, screenshot (Android 11+) only when the tree is not enough.
- **Act:** Accessibility Service taps, swipes, and text input.
- **Skip the GUI when possible:** standard intents for common jobs, such as `AlarmClock.ACTION_SET_ALARM`.
- **Stay connected:** a foreground service keeps the bridge connection alive.
- **Runtime:** MNN or llama.cpp. Benchmark both with image input on the real device.

Same model family on both devices means one prompt format, one tool-call format, and one action format.

## iPhone limits

- No control of other apps.
- Background commands only through push notifications, which are throttled.
- Alarms only through a Shortcut, or AlarmKit for our own app's alarms.

## Bridge rules

1. **End-to-end encryption.** Devices pair once and encrypt every message with keys only they hold. The VPS relays ciphertext and never sees content. This keeps the "local AI" claim honest.
2. **Message envelope.**

```ts
type Envelope = {
  id: string              // unique message id
  from: DeviceId
  to: DeviceId
  type: "command" | "result" | "event"
  expiresAt: string       // stale commands are dropped, never executed late
  protocolVersion: number
  signature: string       // signed with the sender's paired device key
  payload: string         // encrypted body
}
```

For results, `replyTo` is inside the encrypted payload and matches the command being answered.

The VPS can read `id`, `from`, `to`, `type`, `expiresAt`, and `protocolVersion`.
It needs `type` to reject commands for an offline device at once while holding results and events through a short reconnect ([SPEC-08](../specs/08-device-bridge.md) r7).
Everything that says what the message means stays inside the encrypted `payload`.

Message kinds inside the payload:

| Kind | Envelope type | Direction | Expires after |
|---|---|---|---|
| Tool call (`set_alarm`, `set_timer`, `open_app`) | command | brain to tool provider | 2 minutes |
| Tool result | result | back to the caller | 2 minutes |
| Delegated goal | command | origin device to Mac | 2 minutes, sent only while the Mac is online |
| Progress | event | executing device to origin device | 2 minutes |
| Approval request | command | executing device to origin device | 5 minutes |
| Approval response | result | origin device back | 2 minutes |
| Pause, cancel | command | either way | 2 minutes |
| Pause confirmed | result | back to the sender | 2 minutes |
| Tool list | event | on connect | 2 minutes |
| Busy (goal queued behind another task) | result | back to the origin device | 2 minutes |
| Target offline, expired, not paired | relay frame, not an envelope ([pairing](../protocol/docs/pairing.md)) | relay to the sender | held 2 minutes |
| Pairing request | relay frame, sealed with the QR code's secret | phone to Mac | open 30 seconds at the relay |
| Paired, pairing expired | relay frame, not an envelope ([pairing](../protocol/docs/pairing.md)) | relay to the phone or Mac | held 2 minutes |

Schemas: [OBJ-02](../objectives/OBJ-02-bridge-envelope-and-crypto.md) (envelope and crypto) and [OBJ-25](../objectives/OBJ-25-cross-device-messages.md) (message kinds).

3. **No command queue.** Commands to an offline device fail at once, and goals waiting for an offline device are held on the origin device ([SPEC-09](../specs/09-cross-device-routing.md)). The VPS only holds results and events through short reconnects, until they expire. For iPhone (later) it also sends a push to wake the app.
4. **Approve where the user is.** Risky actions (sending and deleting, [SPEC-07](../specs/07-safety.md)) ask for approval on the origin device. The executing device shows only a "Waiting for your OK" banner ([SPEC-09](../specs/09-cross-device-routing.md) r10).
5. **Reply where the user spoke.** The result is spoken on the device the user talked to, even if the work happened on the other.
6. **Show the work.** A phone request that runs on the Mac spawns the visible cursor on the Mac.

## Open questions

- MNN or llama.cpp on Android, after benchmarking.
- Should the phone model also route Mac-originated tasks when the Mac is busy, or only its own?
