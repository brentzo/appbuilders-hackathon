# Bridge acceptance

Objective: [OBJ-30](../objectives/OBJ-30-live-cross-device-bridge-acceptance.md).
Spec: [SPEC-08](../specs/08-device-bridge.md).

This page has two parts.
The live check is the relay side of SPEC-08, run with stand-in devices against the deployed relay; its results are below.
The device run is the same scenarios on the real Mac and Android phone, with a runbook and an empty report for whoever runs it.

## Live check

`npm run live-check` in `bridge/` runs the relay side of each SPEC-08 scenario against a relay, with fresh throwaway devices that speak the protocol through `protocol/`'s reference crypto.
It prints a Markdown report and exits non-zero if a scenario fails.

```sh
cd bridge
npm install
npm run live-check                         # the deployed relay, about 1 minute
npm run live-check -- --skip-slow          # without the 30-second pairing window
npm run live-check -- --url wss://other.example
```

It registers a few throwaway device ids on the relay, which can reach nobody, and unpairs every pairing it makes.
The bridge tests run the same scenarios against a local relay (`bridge/test/live-check.test.ts`), so the check itself is tested.

### Results, 2026-10-10

Run from Jepoy's Windows PC against `wss://yumibridge.studiokova.co` on 2026-10-09 at 16:50 UTC (2026-10-10 local time).
The client protocol version was 4.
The relay answered `/health` with `{"status":"ok"}`; it did not report its protocol version or commit, so its exact build is not recorded.
The relay's `unsupportedVersion` handshake reported protocol version 4.

| Scenario | Checks | Result | Time |
|---|---|---|---|
| Devices authenticate | pairing.md "Connecting" | Passed | 0.4 s |
| Refusals name their reason | pairing.md "Connecting", "Another protocol version" | Passed | 0.5 s |
| Pair the phone with the Mac | SPEC-08 "Pair the phone with the Mac" | Passed | 0.8 s |
| Messages pass through unchanged | SPEC-08 "VPS cannot read messages" (the relay forwards ciphertext as is) | Passed | 0.8 s |
| Command to an offline device fails at once | SPEC-08 "Command to an offline device fails at once" | Passed | 1.1 s |
| Result survives a short reconnect | SPEC-08 "Result survives a short reconnect" | Passed | 2.4 s |
| Expired command is not delivered | SPEC-08 "Expired command is not run" (the relay's part) | Passed | 1.2 s |
| Message from an unknown device is dropped | SPEC-08 "Message from an unknown device is dropped" (the relay's part) | Passed | 1.3 s |
| Unpair a device | SPEC-08 "Unpair a device" | Passed | 3.8 s |
| Phone cancels pairing | pairing.md "The answer window", Cancelled | Passed | 1.0 s |
| Mac does not answer pairing, then answers too late | SPEC-08 "Mac does not answer pairing", "Mac answers pairing too late" | Passed | 32.0 s |
| A device that needs an update keeps its pairing | SPEC-08 "Device needs an update", "Command to a device that needs an update", "Devices reconnect after an update" | Passed | 2.1 s |

12 of 12 passed.
The check also confirmed that its temporary pairings could be removed during cleanup.

### Found: unpair depends on device clocks

The first run failed "Unpair a device": the relay never acknowledged an unpair sent as soon as pairing finished.
The relay refuses an unpair whose `at`, from the sending device's clock, is not later than the pairing time on its own clock, and this PC's clock was a fraction of a second behind the VPS.
The same unpair with `at` 5 seconds later was acknowledged at once.
A device whose clock runs behind cannot unpair until the clocks catch up, and its retries are never acknowledged, which breaks SPEC-08 requirement 9.
The receiving device has the same check with its own clock.
The follow-up run above passed because the live check waited 3 seconds before sending this unpair; that workaround does not cover larger clock skew.

[OBJ-48](../objectives/OBJ-48-unpair-without-device-clocks.md) tracks the fix: bind an unpair to the pairing instead of to a time.
Until then, the live check unpairs 3 seconds after pairing, as a person would, and the device run should too.

## Device run

### Before you start

The device run needs these done first; each one is in OBJ-30's `depends-on`:

- The Android bridge client: [OBJ-23](../objectives/OBJ-23-android-bridge-client.md).
- The Mac waiting for the relay's pairing verdict: [OBJ-41](../objectives/OBJ-41-mac-pairing-verdict.md).
- The version mismatch copy and the Mac's refusal handling: [OBJ-42](../objectives/OBJ-42-version-mismatch-copy.md), [OBJ-43](../objectives/OBJ-43-mac-bridge-client-version-refusal.md).
- `ping` on the Mac and the test hooks: [OBJ-49](../objectives/OBJ-49-mac-bridge-test-support.md), and the phone's in OBJ-23 task 10.

Then:

1. Ask Brent to redeploy the relay from `main` with the `BRIDGE_REVISION` step in [bridge/README.md](../bridge/README.md), so `curl https://yumibridge.studiokova.co/health` names its commit.
2. Run `npm run live-check` in `bridge/`; every scenario should pass before you touch the devices.
3. Build the Mac app from `main` as in [Setup for judges](judges-setup.md), path 2, without the mock harness, and the Android app from the same commit.
4. Fill in the table below.

| | Mac | Phone | Relay |
|---|---|---|---|
| Model | | | VPS |
| OS version | | | |
| Yumi commit | | | from `/health` |
| Protocol version | | | from `/health` |
| Date and time | | | |

### Logs

- Mac: `/usr/bin/log stream --level info --predicate 'subsystem == "ph.appbuilders.yumi"'`, and the harness log in `~/Library/Application Support/Yumi/harness.log`.
- Phone: `adb logcat -s YumiService YumiError Yumi`.
- Relay (Brent, on the VPS): `docker compose -f bridge/docker-compose.yml logs --tail=200 bridge` in `/root/dev/brent/yumi-bridge`.

Never paste a log into a ticket without reading it first for private data.

### Scenarios

Run them in this order.
"Mac" and "phone" are the real devices.
Mark each one Passed, Failed (with what you saw), or Not run (with why).

| # | SPEC-08 scenario | Steps | Passes when | Result |
|---|---|---|---|---|
| 1 | Pair the phone with the Mac | On the Mac, choose "Pair your phone…". Scan the code with the phone. | Both show "Paired with <device name>", and each lists the other. | Not run |
| 2 | Pairing code expired | Show a code, wait more than 5 minutes, scan it. | The phone shows "Pairing code expired", and the Mac shows nothing new. | Not run |
| 3 | Mac does not answer pairing | Show a code, quit Yumi on the Mac, scan it, wait 30 seconds. | The phone shows "Mac didn't answer pairing", and is not paired. | Not run |
| 4 | Mac answers pairing too late | Repeat 3, then open Yumi on the Mac within the 5-minute code life. | Neither device shows "Paired with <device name>", and neither lists the other. | Not run |
| 5 | Connection state (requirement 10) | Turn Wi-Fi off and on, on each device in turn. | Each app shows reconnecting, then connected; offline while off. | Not run |
| 6 | VPS cannot read messages | Send a `ping` each way. Then Brent checks the relay database and logs. | Each `ping` gets a `pingResult`. The relay's storage and logs hold only ids, routing fields, and ciphertext. | Not run |
| 7 | Command to an offline device fails at once | Turn the phone's Wi-Fi off, wait for the relay to notice, send a `ping` from the Mac. | The Mac reports the phone offline at once, with the "Other device offline" copy where a user would see it. | Not run |
| 8 | Result survives a short reconnect | Send a `ping` from the phone, and turn the Mac's Wi-Fi off before the result arrives (the Mac's hook can hold its handling). Turn it on within 2 minutes. | The phone gets the `pingResult` after the Mac reconnects. | Not run |
| 9 | Expired command is not run | With the hook, make the phone hold the next command for 3 minutes, then send a `ping` from the Mac. Repeat the other way. | The command is not run, and the sender is told it expired. | Not run |
| 10 | Duplicate delivery runs once | With the hook, send the same command twice. Repeat the other way. | It runs once, and the second delivery gets the original result. | Not run |
| 11 | Message from an unknown device is dropped | With the hook, send one envelope signed by a throwaway key. Repeat the other way. | It is not run, and the receiver's log records it. | Not run |
| 12 | Unpair a device | Wait a few seconds after pairing, then unpair from the phone. Pair again, then unpair from the Mac, once with the other device offline. | Both show "Not paired"; the offline device follows when it reconnects; the Mac refuses messages from the phone. | Not run |
| 13 | Device needs an update | Install a phone build with an older protocol version, then open it. | The phone says Yumi on it needs an update, not that the connection is down, and stays paired. | Not run |
| 14 | Command to a device that needs an update | With the phone from 13, send a `ping` from the Mac. | The Mac is told at once that Yumi on the phone needs an update. | Not run |
| 15 | Devices reconnect after an update | Install the current phone build. | The phone shows connected and is still paired, without a new code. | Not run |
| 16 | No secrets in files | On each device, search Yumi's data folders and logs for the device keys and the pairing secret. | No key or pairing secret appears; keys are only in the Keychain on the Mac and the Android Keystore on the phone. | Not run |

### Not run

Scenarios 1-16 were not run with the real apps because this environment has no Mac/Xcode or Android phone.
The Android client and the Mac pairing-verdict, version-refusal, mismatch-copy, and test-hook work are also incomplete ([OBJ-23](../objectives/OBJ-23-android-bridge-client.md), [OBJ-41](../objectives/OBJ-41-mac-pairing-verdict.md), [OBJ-42](../objectives/OBJ-42-version-mismatch-copy.md), [OBJ-43](../objectives/OBJ-43-mac-bridge-client-version-refusal.md), and [OBJ-49](../objectives/OBJ-49-mac-bridge-test-support.md)).
The OBJ-48 unpair clock fix is also pending, so scenario 12 remains subject to the documented clock-skew issue.
