# Android background survival

Date: 2026-10-09.
Objective: [OBJ-22](../objectives/OBJ-22-android-app-shell.md).
Spec: [SPEC-10](../specs/10-android-companion.md), Part A.

## Summary

Yumi's foreground service stayed alive in every run, on the development phone and the demo phone, including a forced deep sleep and real use on battery.
A clean 30 minutes with the screen locked was never run end to end.
Brent decided on 2026-10-09 that it is not worth blocking OBJ-22 on: in the demo the phone is in someone's hand, not locked in a pocket for half an hour.
This report replaces that expectation.

## Why it matters

The phone's bridge connection and the "Hey Yumi" wake word both live in the foreground service.
If Android or the phone maker's battery saver stops the service, the phone silently stops listening and drops off the bridge.

## Device

- Samsung Galaxy A56 (SM-A566B), Android 16, 8 GB RAM, Brent's development phone.
- Yumi 0.1.0 debug build, installed 2026-10-09 at 6:31 pm, last updated at 6:42 pm.
- Yumi is on Android's battery optimization allowlist (`dumpsys deviceidle whitelist` lists `ai.yumi.android`), set through Yumi's first-run setup.
- Its app standby bucket is 5 (exempt), so Android does not restrict its background work.

## What was observed

| Run | Conditions | Result |
|---|---|---|
| Forced deep sleep | App in the background, deep Doze forced with `dumpsys deviceidle force-idle`, charger simulated as unplugged, 30 minutes. Screen off and locked for the first 15 to 20 minutes, then unlocked. | Same process the whole time, still a foreground service, notification still shown. |
| Real use | About 1.5 hours (from about 6:45 pm to 8:15 pm) of normal use with Yumi in the background. On battery from at least 7:51 pm to 8:14 pm, and the USB cable was unplugged and plugged back in. | Same process (alive 1 hour 33 minutes at 8:17 pm), `isForeground=true`, the "Yumi is running" notification still shown. |

## Demo phone

- Xiaomi, model 25069PTEBG, HyperOS 2, Android 15, 12 GB RAM, the teammate's demo phone.
- Yumi installed and set up on 2026-10-09 at about 8:45 pm. Android's battery optimization allowlist includes Yumi after setup.
- From 8:56 pm to 9:06 pm the phone was in use with Yumi in the background: Yumi was never on screen (checked every 30 seconds), and at 9:06 pm it was the same process (alive 35 minutes), still a foreground service.
- HyperOS has its own Autostart and battery restrictions on top of Android's. They did not stop Yumi in this run. If they do later, set Yumi's battery saver to "No restrictions" in its app settings.

## Not verified

- A clean 30 minutes with the screen locked and the phone untouched.
- Android 12 and 13, which the app supports but which were never run.

## How to check again

1. Install Yumi and finish its setup, including "Stop optimising battery usage".
2. Leave the app with Home, lock the phone, unplug it, and wait.
3. Plug it in and run `adb shell dumpsys activity services ai.yumi.android | grep isForeground`. It must say `isForeground=true`.
4. Run `adb shell ps -o PID,ETIME -p $(adb shell pidof ai.yumi.android)`. An elapsed time longer than the wait means the process was never restarted.

If Yumi stops on a phone, open Yumi's app settings from Yumi's Settings screen and set battery use to Unrestricted, as `android/README.md` describes.
