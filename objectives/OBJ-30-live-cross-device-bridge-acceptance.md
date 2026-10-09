---
id: OBJ-30
title: Live cross-device bridge acceptance
product: bridge
assignee: Jepoy
touches: []
specs: [SPEC-08]
status: blocked
priority: p0
depends-on: [OBJ-13, OBJ-21, OBJ-23, OBJ-27, OBJ-41, OBJ-42, OBJ-43, OBJ-49]
integrates-with: [OBJ-48]
tags: [objective, p0, bridge, mac, android, e2e]
---

# OBJ-30 Live cross-device bridge acceptance

**Product:** [Yumi Bridge](../bridge/README.md) · **Specs:** [SPEC-08](../specs/08-device-bridge.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

OBJ-21 validates the client against local stand-ins so development does not wait on deployment or hardware.
This follow-up runs the real Mac and Android clients against the deployed relay and closes the SPEC-08 device scenarios that local stand-ins cannot prove.

## Read first

- [SPEC-08](../specs/08-device-bridge.md), all requirements and scenarios.
- [protocol/docs/pairing.md](../protocol/docs/pairing.md) and [protocol/docs/crypto.md](../protocol/docs/crypto.md).
- Outcomes of [OBJ-13](OBJ-13-bridge-relay-server.md), [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md), [OBJ-23](OBJ-23-android-bridge-client.md), and [OBJ-27](OBJ-27-mac-native-services.md).

## Tasks

- [x] **OBJ-30.1** Run the relay side of every SPEC-08 scenario against the deployed relay with stand-in devices: `npm run live-check` in `bridge/`, which the bridge tests also run against a local relay.
- [x] **OBJ-30.2** Write the runbook and the report for the device run in [wiki/bridge-acceptance.md](../wiki/bridge-acceptance.md), with the live check's results.
- [ ] **OBJ-30.3** Connect the real Mac harness client and Android client to the deployed bridge using the same protocol version.
- [ ] **OBJ-30.4** Pair the phone by scanning the QR code shown by the Mac app, then verify each side lists the paired device.
  Also scan an expired code, and scan a fresh code with the Mac app quit until the 30-second answer window passes, then verify neither side is paired.
- [ ] **OBJ-30.5** Exchange encrypted commands, results, and events in both directions (`ping` from [OBJ-49](OBJ-49-mac-bridge-test-support.md) and OBJ-23 task 10), and confirm the relay logs and storage contain no plaintext payload.
- [ ] **OBJ-30.6** Exercise unknown-device rejection, command expiry, duplicate delivery, short reconnect delivery, offline command rejection, and unpair from either device, using the OBJ-49 and OBJ-23 test hooks for the first three.
  Also connect the phone on a build with an older protocol version, send it a command from the Mac, then update it, and verify the SPEC-08 "Protocol versions" scenarios, with the pairing kept.
- [ ] **OBJ-30.7** Record device models, OS versions, relay version, protocol version, exact steps, and results for every scenario in the bridge integration report.
  The relay names its commit on `/health` once Brent redeploys it with the `BRIDGE_REVISION` step in `bridge/README.md`.

## Expectations

- [ ] SPEC-08 scenarios pass on the real Mac, Android phone, and deployed relay: "Pair the phone with the Mac", "Unpair a device", "Pairing code expired", "Mac does not answer pairing", "Mac answers pairing too late", "VPS cannot read messages", "Message from an unknown device is dropped", "Command to an offline device fails at once", "Result survives a short reconnect", "Expired command is not run", "Duplicate delivery runs once", "Device needs an update", "Command to a device that needs an update", and "Devices reconnect after an update".
- [ ] Both apps show connected, reconnecting, and offline as the connection changes (SPEC-08 requirement 10).
- [ ] No secret appears in relay logs, relay storage, Mac files, or Android files, and no plaintext payload appears in relay logs or storage (SPEC-08 requirement 3).
  The Mac and phone keep their own results in plain text for at-most-once delivery (SPEC-08 requirement 8), which stays on the device.
- [x] The report identifies any scenario not run and the exact blocker.
## Expected outcomes

- A reproducible real-device bridge acceptance report with logs scrubbed of secrets and plaintext.

## Out of scope

- Changes to Mac client behavior: [OBJ-21](OBJ-21-mac-bridge-client-and-pairing.md).
- Changes to Android client behavior: [OBJ-23](OBJ-23-android-bridge-client.md).
- Relay implementation and deployment: [OBJ-13](OBJ-13-bridge-relay-server.md).

## Outcome

Blocked: the device run (OBJ-30.3 to OBJ-30.7) needs the Android bridge client ([OBJ-23](OBJ-23-android-bridge-client.md)), the Mac waiting for the pairing verdict ([OBJ-41](OBJ-41-mac-pairing-verdict.md)), the version mismatch copy and refusal handling ([OBJ-42](OBJ-42-version-mismatch-copy.md), [OBJ-43](OBJ-43-mac-bridge-client-version-refusal.md)), and `ping` and test hooks on the Mac ([OBJ-49](OBJ-49-mac-bridge-test-support.md)) and the phone (OBJ-23 task 10).
Brent can unblock all of them; a teammate with the Mac and phone then runs [wiki/bridge-acceptance.md](../wiki/bridge-acceptance.md) "Device run".

Done so far:
- `npm run live-check` in `bridge/` runs the relay side of every SPEC-08 scenario against the deployed relay with stand-in devices; 12 of 12 passed on 2026-10-10. The bridge tests run the same scenarios against a local relay.
- `/health` names the relay's protocol version and deployed commit, once the relay is redeployed with `BRIDGE_REVISION`.
- The live check found that an unpair depends on device clocks; [OBJ-48](OBJ-48-unpair-without-device-clocks.md) tracks the fix.
- The runbook, relay-side results, and device scenarios marked not run with their blockers are in [wiki/bridge-acceptance.md](../wiki/bridge-acceptance.md).
- Live-check cleanup failures now fail the scenario instead of being silently ignored; `npm test -- test/live-check.test.ts` covers an unpair cleanup failure.
- This objective now lists the objectives it waits for, adds SPEC-08 requirement 10 to its expectations, and limits "no plaintext" to the relay, as SPEC-08 requirement 3 does.
