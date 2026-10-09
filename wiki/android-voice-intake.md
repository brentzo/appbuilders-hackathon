# Android voice intake and wake word

Date: 2026-10-09, 10:57 pm to 11:46 pm.
Objective: [OBJ-24](../objectives/OBJ-24-android-voice-intake.md).
Specs: [SPEC-01](../specs/01-voice-intake.md), [SPEC-10](../specs/10-android-companion.md) Part A.

## Summary

Push-to-talk and the wake word work on the demo phone, with Brent's own voice, with the app open and with the phone locked.
The wake word is reliable within about 2 arm's lengths of the phone and misses most of the time from across a room.
Idle listening costs about 2% of the battery an hour and about 9% of one CPU core.
No audio left the phone: the recognizer is Android System Intelligence, which has no internet permission, and neither it nor Yumi sent or received a byte during recognition.
These are short measurements: 10 minutes of idle listening, a 20-try miss test, and 10 minutes of speech for false triggers, as Brent asked.
They show the order of magnitude, not a precise rate.

The wake word is the "Hey Jarvis" stand-in from openWakeWord until OBJ-12's "Hey Yumi" model exists, so the wake word numbers must be measured again then.

## Device and build

- Xiaomi 25069PTEBG, HyperOS 2, Android 15, 12 GB RAM, battery 4,995 mAh, the demo phone.
- Yumi 0.1.0 debug builds from branch `obj-24-android-voice`, ONNX Runtime 1.28.0 for the final runs, 1.31.0 for the battery run (the same models and code path; 1.28 drops only the telemetry).
- On-device recognizer: `com.google.android.as/com.google.android.apps.miphone.aiai.app.AiAiSpeechRecognitionService` (Android System Intelligence), found with `dumpsys activity services` during a session.
- The phone was on USB the whole time.

## What was measured

### Battery and CPU while idle-listening

Method: wake word on, app in the background, screen off, charger simulated as unplugged (`dumpsys battery unplug`, reset afterwards), `dumpsys batterystats --reset` at the start, 10 minutes (601 seconds) from 11:21 pm.
The Mac read ordinary text aloud the whole time, for the false-trigger count below.
The process stayed the same (pid 29974) throughout.

| Measure | Result | Per hour, extrapolated |
|---|---|---|
| Android's power estimate for Yumi | 16.8 mAh: audio input 12.2, CPU 3.2, wake lock 1.5 | About 100 mAh, about 2% of the battery |
| Process CPU time (`/proc/<pid>/stat`, user plus system) | 54.3 s of 601 s, about 9% of one core | Same |
| CPU per 80 ms audio chunk | About 7 ms (54.3 s over about 7,500 chunks) | Same |

- The battery level stayed at 55% because USB kept powering the phone, so the mAh figure is Android's model-based estimate, not a measured drain.
- `batterystats` lists 2 min 21 s of CPU for Yumi's uid against 54.3 s from `/proc`. It counts time differently (per CPU cluster); the `/proc` figure is the process's own CPU time.
- Brent accepted about 2% an hour for the demo on 2026-10-09.

### False triggers

- 10 minutes of the project's own docs read aloud by the Mac (147 lines, 7 English voices: Samantha, Daniel, Karen, Moira, Aman, Rishi, Tessa), with the phone locked about 1 metre away.
- 0 wake-ups.
- Synthesized speech from a laptop speaker is not the everyday Taglish, TV, and music that SPEC-01's test asks for, so this does not answer its open question about false triggers.

### Misses, with Brent's voice

From 11:43 pm, Brent said "Hey Jarvis" 20 times, each followed by "open the camera":

| Distance | Tries | Detected |
|---|---|---|
| Arm's length | 10 | 10 |
| Across the room, about 3 metres | 10 | 2 |

Earlier in the same session, 6 wake word goals within about 2 arm's lengths were all transcribed, including the 3 rounds with the phone locked, and Brent reported no misses there.
Brent's conclusion: reliable within about 2 arm's lengths, and missing from across the room is acceptable.

With synthesized voices from the Mac speakers about 1 metre away, 18 of 21 tries were detected.

### Push-to-talk and transcripts, with Brent's voice

| What Brent said | Result |
|---|---|
| "set a timer for 10 minutes" | Transcribed |
| "export my Keynote deck as a PDF", 3 times | Wrongly shown "Language not supported on this phone" each time. Fixed, see below |
| Nothing for 10 seconds | "Didn't catch speech", with "Try again" and "Type instead" |
| "pakigising yung Mac ko" (Tagalog), 2 times | "Language not supported on this phone" |
| "Hey Jarvis", then a goal, 6 times, 3 of them locked | All 6 transcribed |

From the wake word to the recognizer's microphone opening takes about 0.7 seconds: the chime, then the recognizer starting.

### Traffic

- Yumi has no internet permission (checked in `dumpsys package`).
- `dumpsys netstats detail`, polled before and after three recognition sessions: 0 bytes received and 0 sent for Android System Intelligence (uid 10168) and for Yumi (uid 10548), and none recorded for either before that.
- Android System Intelligence also has no internet permission of its own.

## What it means

### The language check

The recognizer reports a stream of guesses at the spoken language, each with a confidence, and they swing a lot.
For "export my Keynote deck as a PDF", Brent's guesses went between `en-us` and `fil-ph`, both up to "highly confident", and ended on `fil-ph`.
The first version used the last confident guess, so a plain English goal with product names got the language error.
5 of the 12 "open the camera" goals in the miss test got it too.
Real Tagalog never drew a confident `en-us` guess, and the English-only recognizer found no match for it.

So Yumi now judges the whole session and trusts a transcript:

- With a transcript, it is the goal, unless English was never guessed at all and another language was guessed with confidence.
- Without one, it is "Language not supported on this phone" if another language was guessed with confidence and English never was, and "Didn't catch speech" otherwise.

Replayed against all 25 of Brent's sessions, this passes every English goal and still gives Tagalog the language message.
`LanguageGuessesTest` holds his real sequences.

### Testing with a laptop speaker

Speech played from the Mac's speakers was only a few decibels above the room's noise at the phone (the recognizer reported about 7 dB of background and 10 dB at peaks).
The recognizer then often could not tell when the speech ended and gave no match after about 8 seconds, and while the phone was locked it mostly misheard the goal.
Brent's own voice at the same distance had none of these problems, so test transcription with a person, not a laptop speaker.

### ONNX Runtime telemetry

ONNX Runtime 1.29.0 and later add the internet permission and a content provider that starts an HTTP telemetry client when the app opens.
Yumi pins 1.28.0, which has none, and its manifest removes that provider in case of a later upgrade.

## Not verified

- The language fix with Brent's voice: unit tests replay his recorded guesses, and he still has to say the goals again.
- An hour-long idle run, and a battery drain measured off USB.
- False triggers from real everyday Taglish, TV, and music.
- The development phone (Samsung, Android 16).
- The "Hey Yumi" model, which does not exist yet.
