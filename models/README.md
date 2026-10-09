# Yumi Models

Everything about choosing, testing, and producing the models Yumi runs on the devices.
The apps load models; this product decides which ones, proves they are good enough, and produces custom ones such as the wake word.

Owner: Jepoy.

Status: empty scaffold, nothing built yet.

## Responsibilities

- **Whisper bake-off:** pick the Whisper option and runtime for the Mac and the phone using real Taglish recordings ([SPEC-01](../specs/01-voice-intake.md)).
- **Wake word:** train and test the "Hey Yumi" model with openWakeWord ([SPEC-01](../specs/01-voice-intake.md)).
- **GUI smoke test (p0):** check that Qwen3.5-9B at 4-bit completes the 3 demo tasks from the trimmed accessibility tree ([SPEC-05](../specs/05-mac-gui-control.md), [OBJ-26](../objectives/OBJ-26-gui-smoke-test.md)).
- **GUI model bake-off (p1):** compare Qwen3.5-4B, Qwen3.5-9B, and UI-TARS-1.5-7B on the 3 demo tasks, 5 runs each ([SPEC-05](../specs/05-mac-gui-control.md) r14). UI-TARS is a vision model, so this matters for the p1 vision fallback.
- **Voice stop keywords (p1):** a small detector for "stop", "teka", "tama na", and "hinto" that works while Yumi is talking ([SPEC-06](../specs/06-user-control.md) r10). Reuse the openWakeWord training from OBJ-12.
- **Model manifest:** which model files each app loads, where to download them, and their checksums.

## Current model choices

| Role | Model | Notes |
|---|---|---|
| Mac brain and GUI control | Qwen3.5-9B, 4-bit | ~6 GB. p0 works from the trimmed accessibility tree, not screenshots, so [OBJ-26](../objectives/OBJ-26-gui-smoke-test.md) decides whether it is good enough |
| Android brain and app control (p1 only) | Qwen3.5-4B, 4-bit, fixed | ~2.7 GB. 9B was too tight on the 12 GB demo phone. Decided in [SPEC-10](../specs/10-android-companion.md). Part A (p0) has no model |
| Speech to text | Whisper, size to be decided | Taglish and long dictation on the Mac (p0), Android (p1), and iPhone (p2, WhisperKit, [SPEC-12](../specs/12-iphone-companion.md)). The Android p0 recognizer is Android's on-device English recognizer |
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
| [OBJ-11](../objectives/OBJ-11-whisper-bake-off.md) | Whisper bake-off | Jepoy | todo |
| [OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md) | "Hey Yumi" wake word model | Jepoy | todo |
| [OBJ-26](../objectives/OBJ-26-gui-smoke-test.md) | Qwen3.5-9B smoke test on the demo tasks | Jepoy | todo |
<!-- generated:product-objectives:end -->

Not written yet: the p1 GUI model bake-off and the p1 voice stop keywords.
