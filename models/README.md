# Yumi Models

Everything about choosing, testing, and producing the models Yumi runs on the devices.
The apps load models; this product decides which ones, proves they are good enough, and produces custom ones such as the wake word.

Owner: Jepoy.

Status: the Mac Whisper bake-off has a recommended model, pending Jepoy's confirmation ([RESULTS.md](whisper/RESULTS.md)).
The custom wake-word model is being trained in [OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md); app checks still use the documented stand-in until its model and thresholds are validated.

## Responsibilities

- **Whisper bake-off:** pick the Whisper option and runtime for the Mac and the phone using real Taglish recordings ([SPEC-01](../specs/01-voice-intake.md)).
- **Mac Whisper benchmark (p0):** run in [OBJ-11](../objectives/OBJ-11-whisper-bake-off.md) on 30 real recordings. Results and the recommended model are in [whisper/RESULTS.md](whisper/RESULTS.md).
- **Android Whisper benchmark (p1):** tracked separately in [OBJ-28](../objectives/OBJ-28-android-whisper-bake-off.md), after SPEC-10 Part B.
- **Wake word:** train and test the "Hey Yumi" model with openWakeWord ([SPEC-01](../specs/01-voice-intake.md)).
- **GUI smoke test (p0):** check that Qwen3.5-9B at 4-bit completes the 3 demo tasks from the trimmed accessibility tree ([SPEC-05](../specs/05-mac-gui-control.md), [OBJ-26](../objectives/OBJ-26-gui-smoke-test.md)).
- **GUI model bake-off (p1):** compare Qwen3.5-4B, Qwen3.5-9B, and UI-TARS-1.5-7B on the 3 demo tasks, 5 runs each ([SPEC-05](../specs/05-mac-gui-control.md) r14). UI-TARS is a vision model, so this matters for the p1 vision fallback.
- **Voice stop keywords (p1):** model training and evaluation are tracked in [OBJ-55](../objectives/OBJ-55-voice-stop-keyword-models.md). The Mac app integration belongs with [OBJ-35](../objectives/OBJ-35-mac-stop-and-take-over.md) or its p1 follow-up.
- **Model manifest:** which model files each app loads, where to download them, and their checksums.

## Current model choices

| Role | Model | Notes |
|---|---|---|
| Mac brain and GUI control | Qwen3.5-9B, 4-bit | ~6 GB. p0 works from the trimmed accessibility tree, not screenshots, so [OBJ-26](../objectives/OBJ-26-gui-smoke-test.md) decides whether it is good enough |
| Android brain and app control (p1 only) | Qwen3.5-4B, 4-bit, fixed | ~2.7 GB. 9B was too tight on the 12 GB demo phone. Decided in [SPEC-10](../specs/10-android-companion.md). Part A (p0) has no model |
| Speech to text, Mac | Whisper large-v3-turbo on WhisperKit (`large-v3-v20240930_turbo_632MB`), Tagalog forced | 646 MB on disk, about 0.8 GiB loaded. Recommended by [OBJ-11](../objectives/OBJ-11-whisper-bake-off.md), pending Jepoy's confirmation. Handles English and Taglish |
| Speech to text, Android and iPhone | Whisper, size to be decided | Android (p1, [OBJ-28](../objectives/OBJ-28-android-whisper-bake-off.md)) and iPhone (p2, WhisperKit, [SPEC-12](../specs/12-iphone-companion.md)). The Android p0 recognizer is Android's on-device English recognizer |
| Yumi's voice, Mac | Kokoro-82M with the af_heart voice, on MLX Swift | 327 MB on disk, about 0.5 GB loaded. Picked by Brent in [OBJ-51](../objectives/OBJ-51-mac-neural-voice.md); measurements in [the voice report](../wiki/mac-neural-voice.md) |
| Wake word | openWakeWord, custom "Hey Yumi" | Trained once, runs fully on device |
| Voice stop keywords (p1) | openWakeWord, custom | "stop", "teka", "tama na", "hinto" |

Vendor benchmark scores are at full precision.
4-bit lowers accuracy, so our own tests decide.
The public GUI scores (ScreenSpot-Pro, OSWorld) measure vision, which p0 does not use.

## Rules

- Large model weights are not committed to git. The manifest lists where to get them.
- Small files (such as the wake word model) may be committed.
- Voice recordings of teammates are not committed. Keep them in the team's shared storage and only commit transcripts and results.

## Specs

- [SPEC-01 Voice intake and confirmation](../specs/01-voice-intake.md)
- [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md)
- [SPEC-06 User control](../specs/06-user-control.md) (voice stop keywords, p1)
- [SPEC-10 Yumi on Android](../specs/10-android-companion.md) (Part B model, p1)
- [SPEC-12 Yumi on iPhone](../specs/12-iphone-companion.md) (WhisperKit, p2)

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-11](../objectives/OBJ-11-whisper-bake-off.md) | Whisper bake-off | Jepoy | in-progress |
| [OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md) | "Hey Yumi" wake word model | Jepoy | in-progress |
| [OBJ-26](../objectives/OBJ-26-gui-smoke-test.md) | Qwen3.5-9B smoke test on the demo tasks | Brent | in-progress |
| [OBJ-28](../objectives/OBJ-28-android-whisper-bake-off.md) | Android Whisper bake-off | Jepoy | todo |
| [OBJ-55](../objectives/OBJ-55-voice-stop-keyword-models.md) | Voice stop keyword models | Jepoy | todo |
| [OBJ-59](../objectives/OBJ-59-quick-hey-yumi-model.md) | Quick "Hey Yumi" wake word model for the demo | Brent | todo |
<!-- generated:product-objectives:end -->

Not written yet: the p1 GUI model bake-off.
