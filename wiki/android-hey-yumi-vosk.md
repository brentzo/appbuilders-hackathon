# "Hey Yumi" on Android with Vosk

Date: 2026-10-10.
Objective: [OBJ-59](../objectives/OBJ-59-android-hey-yumi-vosk.md).
Specs: [SPEC-01](../specs/01-voice-intake.md) requirement 10 and its Decisions, [SPEC-10](../specs/10-android-companion.md).

## Summary

The phone now spots "Hey Yumi" with Vosk, an offline speech recognizer, limited by a grammar to "hey yumi" plus an unknown-word catch-all.
It replaces the "Hey Jarvis" stand-in until Jepoy's trained openWakeWord model ([OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md)) is ready.
On the Mac, with synthesized voices, it heard "Hey Yumi" 12 times out of 12 and "Hey Jarvis" 0 times out of 6.

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

Not measured yet.

## Not verified

- Brent's own voice at arm's length, a minute of normal talk, and battery and CPU on the demo phone.
- False triggers from real everyday Taglish, TV, and music.
