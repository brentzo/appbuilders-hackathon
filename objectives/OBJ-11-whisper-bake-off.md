---
id: OBJ-11
title: Whisper bake-off
product: models
assignee: Jepoy
touches: [mac, android]
specs: [SPEC-01]
status: in-progress
priority: p0
depends-on: []
integrates-with: []
tags: [objective, p0, models, voice]
---

# OBJ-11 Whisper bake-off

**Product:** [Yumi Models](../models/README.md) · **Also touches:** [mac](../mac/README.md), [android](../android/README.md) · **Specs:** [SPEC-01](../specs/01-voice-intake.md) · **Assignee:** Jepoy

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

Users will speak Taglish, and Whisper is weakest when speakers switch languages mid-sentence.
This p0 objective benchmarks the Mac options with real recordings and records the choice for Mac voice intake.
Android Whisper is p1 in SPEC-01 and SPEC-10, so its phone-specific benchmark is tracked separately in [OBJ-28](OBJ-28-android-whisper-bake-off.md).

## Read first

- [SPEC-01](../specs/01-voice-intake.md), section "Whisper model options" (options table, runtimes, how to decide).
- [models/README.md](../models/README.md), especially the rule about not committing voice recordings.

## Tasks

- [x] **OBJ-11.1** Record about 20 real Taglish goals from the team, with consent, including names, numbers, and app names. Store them in the team's shared storage, not in git.
- [x] **OBJ-11.2** Write the correct transcript for each and commit the transcripts to `models/whisper/transcripts/`.
- [x] **OBJ-11.3** Write a script that evaluates one selected model against a preloaded local endpoint, supporting both Mac runtimes: WhisperKit and whisper.cpp. Run it once per selected model/runtime combination when Mac access and recordings are available.
- [x] **OBJ-11.4** Measure word error rate and warm end-of-speech-to-transcript latency for every Mac combination. Also run about 10 plain English commands to decide whether Whisper alone is fast enough for English on the Mac under SPEC-01 requirements 2 and 3.
- [ ] **OBJ-11.5** Measure memory on the Mac while Qwen3.5-9B and the wake word model are also loaded. Use the peak memory recorded in [OBJ-26](OBJ-26-gui-smoke-test.md) if it is done.
- [x] **OBJ-11.6** Check confirmed model sizes against the estimates in SPEC-01 and correct the table if they differ.
- [x] **OBJ-11.7** Pick the smallest Mac option whose errors would not change what Yumi repeats back. Write results and the Mac choice to `models/whisper/RESULTS.md`.
- [ ] **OBJ-11.8** Record the Mac decision in SPEC-01 and `models/manifest.json` with the download source and checksum. Leave the Android p1 question open for OBJ-28.

## Expectations

- [x] Results cover every selected option and Mac runtime, or explain why one was skipped. Android results are tracked in OBJ-28 after SPEC-10 Part B (p1).
- [ ] The chosen Mac option fits in memory alongside Qwen3.5-9B and the wake word.
- [x] The results say whether Whisper alone is fast enough for English commands on the Mac.
- [ ] SPEC-01 records the Mac choice and keeps the Android p1 choice open for OBJ-28.
- [x] No voice recordings are in git.

## Expected outcomes

- `models/whisper/RESULTS.md` with numbers and the decision.
- A benchmark script and committed transcripts, with recordings kept in approved shared storage.
- A focused local HTTP-server and WER test for the benchmark runner.
- Updated SPEC-01 and `models/manifest.json` with the Mac decision.

## Out of scope

- Wiring Whisper into the apps: [OBJ-15](OBJ-15-mac-voice-intake.md) (Mac), [OBJ-24](OBJ-24-android-voice-intake.md) (Android).

## Outcome

- **Result:** In progress. The bake-off is run and a Mac model is recommended. Two things are left: Jepoy's confirmation of the pick, and the wake word memory check once OBJ-12 has a model.
- **Delivered:**
  - `models/whisper/RESULTS.md`: every result, the error review, memory, the English answer, the Tagalog fine-tune search, and notes for OBJ-15.
  - `models/manifest.json` (new): the recommended model, its Hugging Face repo and pinned revision, license, settings, and every file's size and SHA-256.
  - `models/whisper/benchmark.py`: a normalized WER that ignores written forms of spoken words ("15" for "fifteen", "3pm", "github.com", hyphens), and `--rescore` to score a saved report again. Tests in `models/whisper/test_benchmark.py`.
  - SPEC-01: confirmed sizes in the Whisper options table, and the recommendation under "How to decide" and in the open question.
  - Per-run reports in `models/whisper/results/` (git-ignored) and a copy in `~/Yumi recordings/whisper-results/` on Brent's Mac.
- **Commits:** `fdb71af docs(objectives): start OBJ-11 now that the corpus and Mac access exist`, `3c4c93a feat(models): score Whisper runs on spoken forms too, and rescore saved reports`, `12f3e1d feat(models): record the Mac Whisper bake-off results and the recommended model`, `a57ca5a docs(spec-01): confirm Whisper sizes and note the recommended Mac model`, plus this Outcome commit.
- **Expectations:**
  - Results cover every option and runtime: met. small, medium, and large-v3-turbo on both WhisperKit and whisper.cpp, 20 runs in all. large-v3 was skipped because large-v3-turbo already passed; no Tagalog fine-tune exists in a format either runtime loads. Both reasons are in RESULTS.md.
  - Fits in memory alongside Qwen3.5-9B and the wake word: not met yet. Measured with Qwen3.5-9B loaded: the recommended model adds about 0.8 GiB, for about 9.4 GiB with Qwen's 8.6 GiB peak from OBJ-26. The wake word model does not exist yet (OBJ-12).
  - Whether Whisper alone is fast enough for English: met. Yes: median 515 ms, slowest 850 ms, warm (RESULTS.md, "English commands").
  - SPEC-01 records the Mac choice and keeps Android open: not met yet. SPEC-01 records the recommendation as pending Jepoy's confirmation; the Android question is unchanged for OBJ-28.
  - No voice recordings in git: met. Audio stays in `~/Yumi recordings/whisper/`; `git ls-files` has no audio files.
- **Not verified:**
  - Wake word memory. When OBJ-12 has a model, load it with Qwen3.5-9B and the recommended WhisperKit model, and add its footprint to RESULTS.md "Memory".
  - Other speakers, noise, and distance: only Brent's voice on the built-in microphone in a quiet room.
  - Apple's on-device recognizer was not benchmarked for English, because it needs a permission prompt on Brent's Mac. Whisper alone met the need, so the answer does not depend on it.
  - Latency while Qwen generates is one noisy pass per runtime.
- **Decisions and deviations:**
  - The corpus is one speaker (Brent), not "the team" (OBJ-11.1). Audio is on Brent's Mac in `~/Yumi recordings/whisper/`, not team shared storage. Transcripts are in `models/whisper/transcripts.jsonl`, not a `transcripts/` folder (OBJ-11.2).
  - Ranked by normalized WER plus a hand review of every error, because raw WER mostly counted digit and hyphen formatting.
  - Language forced to `tl` for every recommended run: auto-detect made small and medium translate Taglish into English, and doubled whisper.cpp's time.
  - Tested two extra WhisperKit builds of large-v3-turbo (`_626MB` and `_turbo_632MB`) and whisper.cpp q8_0. The compressed `_turbo_632MB` matched the full build at 40% of the size.
  - Memory for WhisperKit is the rise in wired memory plus the process footprint, because Neural Engine memory is not in the process footprint.
  - `models/manifest.json` did not exist, so its format is new: one entry per model with source, revision, license, settings, and per-file SHA-256.
  - The per-run reports stay out of git, as `models/whisper/.gitignore` and the README require until consent to commit them is confirmed.
- **For the next objectives:**
  - OBJ-15: load `large-v3-v20240930_turbo_632MB` with `DecodingOptions(language: "tl", usePrefillPrompt: true)`; without prefill, the language is ignored. Keep the model loaded; the first Neural Engine compile takes minutes. Match contact names loosely ("Anna" for "Ana", "Jeppoy" for "Jepoy"). See RESULTS.md "For OBJ-15".
  - OBJ-12: add the wake word's memory to RESULTS.md and tick the memory expectation here.
  - OBJ-28: reuse `benchmark.py` and its normalized WER. Force `tl`.
