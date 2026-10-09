# Yumi Models

Everything about choosing, testing, and producing the models Yumi runs on the devices.
The apps load models; this product decides which ones, proves they are good enough, and produces custom ones such as the wake word.

Status: empty scaffold, nothing built yet.

## Responsibilities

- **Whisper bake-off:** pick the Whisper option and runtime for the Mac and the phone using real Taglish recordings ([SPEC-01](../specs/01-voice-intake.md)).
- **Wake word:** train and test the "Hey Yumi" model with openWakeWord ([SPEC-01](../specs/01-voice-intake.md)).
- **GUI model bake-off:** compare Qwen3.5-4B, Qwen3.5-9B, and UI-TARS-1.5-7B on the demo tasks. Waits on SPEC-05, which is not finalized.
- **Model manifest:** which model files each app loads, where to download them, and their checksums.

## Current model choices

| Role | Model | Notes |
|---|---|---|
| Mac brain and GUI control | Qwen3.5-9B, 4-bit | ~6 GB. Beats UI-TARS-1.5-7B on public GUI benchmarks |
| Android brain and app control (p1 only) | Under review | SPEC-10 Part B says Qwen3.5-9B, fixed, but 9B (~6 GB plus context) is too tight on the 12 GB demo phone. Proposal: Qwen3.5-4B (~2.7 GB), fixed. Part A (p0) has no model |
| Speech to text | Whisper, size to be decided | Taglish and long dictation on the Mac (p0) and the phone (p1). The phone's p0 recognizer is Android's on-device English recognizer |
| Wake word | openWakeWord, custom "Hey Yumi" | Trained once, runs fully on device |

Vendor benchmark scores are at full precision.
4-bit lowers accuracy, so our own tests decide.

## Rules

- Large model weights are not committed to git. The manifest lists where to get them.
- Small files (such as the wake word model) may be committed.
- Voice recordings of teammates are not committed. Keep them in the team's shared storage and only commit transcripts and results.

## Specs

- [SPEC-01 Voice intake and confirmation](../specs/01-voice-intake.md)
- Not finalized yet: [SPEC-05 Mac GUI control](../specs/05-mac-gui-control.md), [SPEC-10 Yumi on Android](../specs/10-android-companion.md).

## Objectives

| ID | Objective | Status |
|---|---|---|
| [OBJ-11](../objectives/OBJ-11-whisper-bake-off.md) | Whisper bake-off | todo |
| [OBJ-12](../objectives/OBJ-12-hey-yumi-wake-word.md) | "Hey Yumi" wake word model | todo |
