# "Hey Yumi" on Android with Vosk

Date: 2026-10-10.
Objective: [OBJ-59](../objectives/OBJ-59-android-hey-yumi-vosk.md).
Specs: [SPEC-01](../specs/01-voice-intake.md) requirement 10 and its Decisions, [SPEC-10](../specs/10-android-companion.md).

## Summary

The phone now spots "Hey Yumi" with Vosk, an offline speech recognizer, limited by a grammar to "hey yumi" plus an unknown-word catch-all.
It replaces the "Hey Jarvis" stand-in until Jepoy's trained openWakeWord model ([OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md)) is ready.
On the Mac, with synthesized voices, it heard "Hey Yumi" 12 times out of 12 and "Hey Jarvis" 0 times out of 6.
On the demo phone, with Brent's voice at arm's length, it woke on "Hey Yumi" and the goal after it was captured each time, and Brent reported it worked normally.
Idle listening costs about 6% of one CPU core, less than the openWakeWord stand-in's 9%, and Yumi sent and received nothing.

## Library and model

| | Version | Size | Licence | Source |
|---|---|---|---|---|
| Vosk for Android | `com.alphacephei:vosk-android:0.3.75` | 10 MB native library for arm64 | Apache 2.0 | Maven Central POM |
| JNA, which Vosk calls through | `net.java.dev.jna:jna:5.18.1` (AAR) | 0.2 MB native library | Apache 2.0 or LGPL 2.1, our choice | Maven Central POM |
| English model | `vosk-model-small-en-us-0.15` | 40 MB zip, 71 MB unpacked | Apache 2.0 | `https://alphacephei.com/vosk/models` |

- Neither AAR's manifest asks for any permission, so the app still has no internet permission (checked in the merged manifest).
- "yumi" is in the small model's vocabulary: Vosk warns and drops grammar words it does not know, and it did not.
- The debug APK grew to 118 MB, almost all of it the model and Vosk's native library.

## Mac test with synthesized voices

Method: macOS `say` with 6 English voices (Samantha, Daniel, Karen, Moira, Rishi, Tessa), 16 kHz mono, decoded with Vosk 0.3.44 for Python, the same model, and the grammar `["hey yumi", "[unk]"]`.

| Said | Woke | Notes |
|---|---|---|
| "Hey Yumi" | 6 of 6 | |
| "Hey Yumi", a pause, then a question | 6 of 6 | The question decodes as `[unk]` in its own utterance |
| "Hey Jarvis" | 0 of 6 | |
| "Hey you, come here" | 2 of 6 | A sound-alike, accepted on purpose |
| "I made yummy noodles", "You and me should go", "Hey, what time is it?", "Hey Siri", "Hey Google" | 0 of 30 | |

Vosk's in-progress guesses are not usable: for "Hey Jarvis", "hey you" and others they read "hey yumi" for a moment, then the finished utterance settles on `[unk]`.
So the spotter only acts on finished utterances, which end after a short pause.
The app uses Vosk's short end-of-utterance setting so the pause after "Hey Yumi" can be brief.

## On the demo phone

Device: Xiaomi 25069PTEBG, HyperOS 2, Android 15, 12 GB RAM, on USB the whole time.
Build: Yumi 0.1.0 debug from `main` at `5e403f3`, installed at 3:09 am.

| Measure | Result |
|---|---|
| First start | The model copied out of the APK into private storage in 0.4 seconds |
| Microphone | Android listed Yumi's open 16 kHz `VOICE_RECOGNITION` session, with the app open and with the phone locked |
| Brent's "Hey Yumi" at arm's length, 3:11 am to 3:12 am | 3 wake-ups, each followed by the chime and a transcript handed to the goal (6, 6, and 12 words). Brent: "It worked just fine, and normally." |
| Wake to the recognizer's microphone opening | About 0.8 seconds (the chime, then the recognizer starting), the same as the stand-in |
| Normal talk, 3:12 am to 3:13 am | No wake-ups |
| One more wake-up at 3:13:08 am, as the phone was locked | Then no goal was heard ("Didn't catch speech"). Not known whether it was Brent's locked-phone try or a false trigger |
| Idle CPU, screen off, 60 seconds | 3.4 s of process CPU time, about 6% of one core |
| Memory | About 267 MB PSS for the whole app, with the model loaded |
| Battery | 76% before and after, on USB, so no drain could be measured |
| Traffic | No internet permission (`dumpsys package`), and `dumpsys netstats detail` holds no traffic entries for Yumi's uid |

## Not verified

- "Hey Jarvis" on the phone with a real voice: Brent's report does not say whether he tried it. It did not wake Vosk with synthesized voices on the Mac.
- An hour-long idle run, and a battery drain measured off USB.
- False triggers from real everyday Taglish, TV, and music.
