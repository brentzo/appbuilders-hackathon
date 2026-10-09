---
type: design
status: draft
created: 2026-10-09
tags: [idea, desktop-companion, harness, design, mobile, bridge]
---

# Device Bridge

Part of [Desktop Companion](desktop-companion.md).
Extends the [Lane Router](lane-router.md) with a device dimension.

The Mac and the phone control each other in both directions through a VPS bridge.
The user can speak on either device, and the task runs on whichever device can do it.

## Priority

1. **Android first.** It can run a model, stay connected in the background, and control other apps.
2. **iPhone second.** Limited to its own app's tools, mostly while the app is open.

## Devices are tool providers

Each device advertises its tools over the bridge.
The brain sees one combined tool list and picks the device the same way the lane router picks a lane.

| Device | Brain | Example tools |
|---|---|---|
| Mac (16 GB) | Qwen3.5-9B, main brain | `gui_act`, `bash`, `read`, `write`, `open_app`, `look` |
| Android (18 GB demo phone, 8 GB dev phone) | Qwen3.5-4B, 2B on the 8 GB phone if needed | `phone_gui_act`, `set_alarm`, `get_location`, `read_recent_photos`, `open_app` |
| iPhone (later) | none at first | Tools exposed by our own app, plus Shortcuts |

## Who decides

- **Voice on the Mac:** the Mac brain routes, and calls phone tools over the bridge when needed.
- **Voice on Android:** the phone model first decides "phone or laptop".
  Phone tasks run locally.
  Laptop tasks are sent to the Mac brain as a goal.
- **Mac asleep or offline:** the phone says the laptop is offline and queues the task until it reconnects.

## Android control

Two Android phones are available.

- **18 GB phone (teammate's), main demo device.** ~12 GB free after Android. Qwen3.5-4B (~2.7 GB) runs with plenty of room for screenshots and context, so the app is unlikely to be killed for memory. Qwen3.5-9B (~6 GB) also fits, but test its speed and heat before using it in the demo.
- **8 GB phone (Brent's), development device.** Android and other apps use ~3-4 GB, so 4B is tight. Try 4B, and fall back to 2B (~1.3 GB) if the app is killed for memory, steps are too slow, or the phone overheats.

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
  id: string            // unique message id
  from: DeviceId
  to: DeviceId
  type: "command" | "result" | "event"
  replyTo?: string      // matches a result to its command
  expiresAt: string     // stale commands are dropped, never executed late
  signature: string     // signed with the sender's paired device key
  payload: string       // encrypted body
}
```

3. **Store and forward.** The VPS holds encrypted messages for offline devices until they reconnect. For iPhone it also sends a push to wake the app.
4. **Confirm on the device that acts.** Risky actions (bash, sending messages, deleting, buying) ask for confirmation on the device where they run.
5. **Reply where the user spoke.** The result is spoken on the device the user talked to, even if the work happened on the other.
6. **Show the work.** A phone request that runs on the Mac spawns the visible cursor on the Mac.

## Open questions

- MNN or llama.cpp on Android, after benchmarking.
- Should the phone model also route Mac-originated tasks when the Mac is busy, or only its own?
