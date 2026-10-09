# Whisper bake-off results (Mac)

Objective: [OBJ-11](../../objectives/OBJ-11-whisper-bake-off.md).
Spec: [SPEC-01](../../specs/01-voice-intake.md), section "Whisper model options".
Measured on 2026-10-09 on Brent's MacBook Air (Apple M5, 16 GB, macOS 26.6) while he kept using it.

## Recommendation

**WhisperKit with `large-v3-v20240930_turbo_632MB`, with the language forced to Tagalog (`tl`), for all Mac speech, English included.**
This is a recommendation pending Jepoy's confirmation; Jepoy owns the final pick.

- It is OpenAI's large-v3-turbo (809M parameters, 4 decoder layers), compressed by Argmax to 646 MB on disk with 4-bit and 6-bit palettization.
- Its errors on our corpus would not change what Yumi repeats back. Medium and small make errors that would (see "What the errors mean").
- It is the fastest accurate option: median 632 ms for a Taglish goal and 515 ms for an English command, warm, slowest clip 850 ms.
- It adds about 0.8 GiB next to Qwen3.5-9B: about 0.65 GiB of Neural Engine memory plus a 117 MiB server process.
- WhisperKit is a Swift package, which suits the Mac app in [OBJ-15](../../objectives/OBJ-15-mac-voice-intake.md).
- Runner-up: whisper.cpp with `ggml-large-v3-turbo-q5_0.bin` (574 MB). Same accuracy class (normalized Taglish WER 3.0%), about 1 second per clip, and about 0.75 GiB.
  It held up better than WhisperKit while Qwen was generating (see "Latency with Qwen3.5-9B loaded"), so it is the fallback if that case matters more than it seems to.

Download source and checksums are in [models/manifest.json](../manifest.json).

## Corpus and method

- 30 clips recorded by Brent on the MacBook Air's built-in microphone with [record/record.py](record/record.py): 20 Taglish goals and 10 plain English commands. Brent recorded his own voice, so the consent is his.
- Audio is 16 kHz mono 16-bit WAV in `~/Yumi recordings/whisper/` on Brent's Mac, outside git. Taglish clips are 2.8 to 6.6 seconds (median 4.7); English clips are 1.7 to 3.9 seconds (median 2.8).
- References are in [transcripts.jsonl](transcripts.jsonl), written the way the goal was spoken, with numbers as words.
- Each run used [benchmark.py](benchmark.py) against one local server with one model loaded: one warm-up request, then each clip once, in order.
- **Latency** is the warm HTTP round trip for a finished clip: upload, transcription, and response. It stands in for end-of-speech-to-transcript. It does not include end-of-speech detection or the app's own audio handling, which OBJ-15 adds.
- **Raw WER** counts every word difference after lowercasing and dropping punctuation.
- **Normalized WER** first rewrites written forms into the spoken forms the references use: digits and clock times become words ("15" is "fifteen", "6.30" is "six thirty"), "3pm" is "three pm", "github.com" is "github dot com", and hyphens inside words are dropped ("mag-set" equals "magset"). Raw WER mostly measures those formatting choices, so normalized WER is the better accuracy signal.
- Even normalized WER does not say whether a mistake matters, so every error in the leading options was read by hand. See "What the errors mean".
- Runtimes: whisper.cpp 1.9.5 from Homebrew (ggml 0.26.0, Metal) and WhisperKit's `argmax-cli serve` built from [argmax-oss-swift](https://github.com/argmaxinc/argmax-oss-swift) at `93a97e3` (v0.17.0 plus 37 commits), default compute units (CPU and Neural Engine).
- Model files: whisper.cpp from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) at revision `5359861c`, WhisperKit from [argmaxinc/whisperkit-coreml](https://huggingface.co/argmaxinc/whisperkit-coreml) at revision `0f63a780`. Every file's SHA-256 was checked against Hugging Face.
- Per-clip transcripts, latencies, and memory figures for every run are JSON reports in `models/whisper/results/`, which is git-ignored until consent to commit them is confirmed. A copy is in `~/Yumi recordings/whisper-results/` on Brent's Mac. The tables here are complete without them.

## Results

All runs below force the language to Tagalog (`tl`) except whisper.cpp large-v3-turbo q8_0, which was only run with auto-detect.
Latency is the median across clips, warm, with Qwen not loaded.

| Runtime | Model | On disk | Taglish WER raw / normalized | English WER raw / normalized | Median latency Taglish / English | Slowest clip |
|---|---|---|---|---|---|---|
| WhisperKit | `large-v3-v20240930_turbo_632MB` | 646 MB | 11.7% / 4.2% | 8.8% / 3.5% | 632 / 515 ms | 850 ms |
| WhisperKit | `large-v3-v20240930_turbo` | 1,638 MB | 12.6% / 3.4% | 8.8% / 3.5% | 697 / 553 ms | 836 ms |
| WhisperKit | `large-v3-v20240930_626MB` | 627 MB | 11.7% / 4.2% | 8.8% / 3.5% | 1,259 / 959 ms | 1,736 ms |
| WhisperKit | `medium` | 1,530 MB | 17.4% / 10.2% | 8.8% / 3.5% | 1,371 / 937 ms | 2,577 ms |
| WhisperKit | `small` | 486 MB | 29.1% / 21.6% | 7.0% / 1.8% | 551 / 335 ms | 737 ms |
| whisper.cpp | `ggml-large-v3-turbo-q5_0.bin` | 574 MB | 12.1% / 3.0% | 7.0% / 1.8% | 997 / 945 ms | 1,133 ms |
| whisper.cpp | `ggml-large-v3-turbo-q8_0.bin` (auto) | 874 MB | 12.6% / 3.4% | 8.8% / 3.5% | 1,834 / 1,731 ms | 1,987 ms |
| whisper.cpp | `ggml-medium-q5_0.bin` | 539 MB | 17.0% / 9.3% | 5.3% / 0.0% | 681 / 578 ms | 960 ms |
| whisper.cpp | `ggml-small.bin` | 488 MB | 28.7% / 22.0% | 7.0% / 1.8% | 304 / 222 ms | 380 ms |

The Taglish group has 247 reference words and the English group 57, so one word is 0.4 points of Taglish WER and 1.8 points of English WER.
Every WhisperKit `large-v3-v20240930*` variant is OpenAI's large-v3-turbo (released 2024-09-30). The `_turbo` suffix is Argmax's faster build of it, and `_626MB` and `_turbo_632MB` are compressed versions.

### Auto-detect or forced Tagalog

Force `tl`.

- With auto-detect, WhisperKit `small` and `medium` heard Taglish as English and translated it instead of transcribing it ("Make a draft email to Anna and tell her that I'm late by 15 minutes"). Taglish WER was 85% and 82%.
- With auto-detect, whisper.cpp runs the encoder twice (once to detect the language, once to transcribe), so large-v3-turbo q5_0 took 1,893 ms instead of 997 ms with the same transcripts.
- Forcing `tl` did not hurt English commands: English normalized WER was the same or better for every model.
- The large-v3-turbo variants detected the language correctly with auto-detect, so this is about speed and safety, not accuracy, for the recommended model.

WhisperKit's server ignores the `language` field of a request: it only forces the language when the server itself is started with `--language`.
Every WhisperKit `tl` run here was started with `--language tl`. In the Swift API, set both `language: "tl"` and `usePrefillPrompt: true` in `DecodingOptions`.

## What the errors mean

The test is SPEC-01's: pick the smallest option whose errors do not change what Yumi repeats back.

**Large-v3-turbo passes.** Every error in the recommended model, with what it changes:

| Clip | Said | Heard | Changes the repeat-back? |
|---|---|---|---|
| tl-01 | "i-export mo nga yung Q3 Report" | "i-export mo ka yung Q3 report" | No: a filler word |
| tl-02 | "si Ana, sabihin mo" | "si Anna. Sabihan mo" | Spelling of the name only; "sabihan" means the same here |
| tl-07 | "tapos sabihan mo ako pag tapos na" | "tapos sabihin mga kapag tapos na" | Barely: "me" is lost, but the timer and its length are right |
| tl-11 | "email ni Jepoy" | "email ni Jeppoy" | Spelling of the name only |
| tl-17 | "galing kay Ana" | "galing kay Anna" | Spelling of the name only |
| tl-18 | "huwag mong i-replace" | "wag mong i-replace" | No: the same word, shortened |
| en-01 | "Set a timer" | "Set the timer" | No |
| en-05 | "email to Ana" | "email to Anna" | Spelling of the name only |

Every app name (Keynote, Notes, Spotify, Chrome, Finder), file name (Q3 Report), folder (Downloads, Desktop, Documents), number, time, and verb was right.
The full turbo build and whisper.cpp's q5_0 build made the same kinds of errors on the same clips; whisper.cpp heard "Jepo" for "Jepoy" in tl-11.
Names are the weak spot: "Ana" and "Jepoy" are spelled differently from the contact. Spoken back, they sound the same, but a contact lookup by exact text would miss them (see "For OBJ-15").

**Medium fails.** Both runtimes made errors that change the goal:

- tl-01: "i-expert" for "i-export", the verb (whisper.cpp).
- tl-03: "para huwag mo munang isend" for "pero huwag...", "so that you don't send it" instead of "but don't send it yet" (whisper.cpp).
- tl-17: "Yung summarize mo" for "I-summarize mo", the verb lost (both).
- tl-19: "Taka, stop muna" for "Teka, stop muna", a stop word (whisper.cpp).
- tl-11: "Jeffoy" for "Jepoy" (both).

**Small fails badly:** "ATM" for "eight PM" (tl-20), "1 kilo gawas" for "isang kilong bigas" (tl-05), and "Ia-touch may yung Q3 report na piliya" for "I-attach mo yung Q3 Report na PDF" (tl-03).

large-v3 (1.55B) was not run: large-v3-turbo is already good enough, and large-v3 is about 1.1 GB quantized or 3.1 GB at full precision, with a decoder eight times deeper (32 layers instead of 4), so it would only be slower and heavier.

## Memory

On Apple silicon, WhisperKit's model memory belongs to the Neural Engine, not to the server process, so the process footprint alone hides it.
Each server was measured two ways: its own physical footprint (the method OBJ-26 used for Qwen), and the rise in the Mac's wired memory while it was loaded and warm, as a median over 15 seconds against the same window before start and after stop.
Each measurement was repeated three times with Whisper alone, then once with Qwen3.5-9B loaded.
The raw samples are in `memory.json` with the reports.

| Server | Process footprint, loaded (peak) | Wired memory rise | Estimate of what it adds |
|---|---|---|---|
| WhisperKit `large-v3-v20240930_turbo_632MB` alone | 117 MiB (peak 139 to 154) | 627, 668, 680 MiB | about 0.8 GiB |
| WhisperKit `large-v3-v20240930_turbo_632MB` with Qwen loaded | 71 MiB (peak 139) | 710 MiB | about 0.8 GiB |
| whisper.cpp `large-v3-turbo-q5_0` alone | 653 to 724 MiB (peak 752 to 755) | 850, 867, 1,056 MiB | about 0.75 GiB (the wired rise counts the same Metal buffers as the footprint) |
| whisper.cpp `large-v3-turbo-q5_0` with Qwen loaded | 660 MiB (peak 733) | 832 MiB | about 0.75 GiB |

With Qwen3.5-9B loaded (mlx-vlm 0.7.6, `mlx-community/Qwen3.5-9B-4bit`), the Qwen server's footprint was 6,187 MiB after warm-up and peaked at 6,333 MiB with the short prompts used here.
OBJ-26 measured 7.2 GiB during real GUI steps and 8.6 GiB with 200-element trees, so plan for the larger figure.

**Budget on the 16 GB Mac:** Qwen3.5-9B up to 8.6 GiB, plus Whisper about 0.8 GiB, is about 9.4 GiB, leaving about 6.6 GiB for macOS, the Yumi app, and the user's apps.
The "Hey Yumi" wake word model does not exist yet ([OBJ-12](../../objectives/OBJ-12-hey-yumi-wake-word.md)), so it could not be measured. Add its measured size here when OBJ-12 is done.
The recommended model fits; the budget is tight only because Qwen is large.

Brent's Mac already had about 13.8 GB in use (apps, wired, and compressed) before any model loaded, with ongoing swapping.
That is why the "used memory" delta was too noisy to report (it swung from -305 to +494 MiB) and why the wired-memory rise is used instead.
On the demo Mac, quit heavy apps before the demo.

## Latency with Qwen3.5-9B loaded

| Server | Qwen idle: median Taglish / English | Qwen generating: median Taglish / English | Slowest clip while Qwen generated |
|---|---|---|---|
| WhisperKit `large-v3-v20240930_turbo_632MB` | 750 / 588 ms | 2,036 / 781 ms | 2,809 ms |
| whisper.cpp `large-v3-turbo-q5_0` | 793 / 768 ms | 999 / 1,433 ms | 1,692 ms |

With Qwen loaded but idle, which is the normal case for voice intake, latency was about the same as without Qwen.
While Qwen was generating text non-stop, WhisperKit slowed to about 2 to 2.8 seconds per clip and went back to about 0.8 seconds as soon as a generation finished (the English clips ran mostly between generations, so the English median understates it). whisper.cpp slowed less.
These busy runs are one pass each with only one or two Qwen generations in flight, so treat them as a direction, not a measurement.
In the SPEC-01 flow Qwen is idle while the user speaks a goal, and voice stop words during a task are a separate small detector (SPEC-06, p1), so this case should be rare. If OBJ-15 finds that Whisper often runs while Qwen generates, compare whisper.cpp again there.

## English commands: is Whisper alone fast enough?

Yes. Use Whisper for English too on the Mac.

- SPEC-01 requirement 2 allows ("may use") the native recognizer for English, and requirement 3 requires Whisper for Taglish. It sets no latency number.
- With the recommended model, plain English commands came back in a median 515 ms (slowest 850 ms) after the clip ended, and 588 ms with Qwen loaded and idle.
- That is small next to what follows: Qwen restating the goal takes seconds (OBJ-26 measured about 4 seconds per step at 1,000 prompt tokens).
- English accuracy was fine with Tagalog forced: the only differences were "the" for "a" and "Anna" for "Ana".
- One path is also simpler and safer: the app cannot know whether a goal is English or Taglish before transcribing it, so routing English to a second recognizer would need language detection first.
- Not measured: Apple's on-device recognizer (`SFSpeechRecognizer` with `requiresOnDeviceRecognition`) was not benchmarked, because it needs the speech recognition permission prompt on Brent's Mac. This does not change the answer, since Whisper alone meets the need.

## Tagalog fine-tunes

None was included.
Searched Hugging Face on 2026-10-09 for Whisper models tagged or named Tagalog, Filipino, `tl`, and Taglish, and filtered for ggml, GGUF, Core ML, and WhisperKit formats.

- The most credible is [LWobole/whisper-small-tagalog](https://huggingface.co/LWobole/whisper-small-tagalog): Apache-2.0, fine-tuned from whisper-small on FLEURS Filipino, reporting 16.7% WER on FLEURS. It is only published as Hugging Face Transformers weights, so neither Mac runtime can load it without a conversion step that needs PyTorch and Transformers, which were not approved for this run.
- Others found: [kerker256/whisper-small-tl](https://huggingface.co/kerker256/whisper-small-tl) (Apache-2.0, small, 20.2% WER on FLEURS, Transformers only), [jdzabala/whisper-ltv3-ft-tagalog](https://huggingface.co/jdzabala/whisper-ltv3-ft-tagalog) (Apache-2.0, CTranslate2 format, empty model card), and several with no license or a non-commercial license.
- No Tagalog Whisper fine-tune exists in ggml, GGUF, or Core ML format.
- These are trained on read, monolingual Filipino (FLEURS), not Taglish, and all but one are based on small. Stock large-v3-turbo already reaches 3 to 4% normalized WER on our Taglish, so a converted small fine-tune is unlikely to win. Revisit only if Taglish accuracy becomes a problem with more speakers.

## Limits of this test

- One speaker (Brent), one microphone, a quiet room, 30 clips. Other teammates' voices and accents, noise, and distance were not tested.
- One pass per configuration. The Mac was in use (many apps and a virtual machine running), so latency varied between repeated runs of the same configuration: two auto-detect runs of WhisperKit `large-v3-v20240930_turbo` had Taglish medians of 667 and 888 ms.
- Latency excludes end-of-speech detection.
- The wake word model does not exist yet (OBJ-12).

## Reproduce

```sh
# whisper.cpp
brew install whisper-cpp
whisper-server --host 127.0.0.1 --port 8178 --model ggml-large-v3-turbo-q5_0.bin -l tl

# WhisperKit, from a source checkout of argmax-oss-swift
BUILD_ALL=1 swift build -c release --product argmax-cli
.build/release/argmax-cli serve --host 127.0.0.1 --port 50060 \
  --model large-v3-v20240930_turbo_632MB --language tl

# Then, for either server
python3 models/whisper/benchmark.py --runtime whisperkit --model large-v3-v20240930_turbo_632MB \
  --endpoint http://127.0.0.1:50060/v1/audio/transcriptions --language tl \
  --manifest models/whisper/transcripts.jsonl --audio-dir ~/"Yumi recordings/whisper" \
  --output models/whisper/results/<runtime>-<model>-<language>.json
```

The first WhisperKit start downloads the model and compiles it for the Neural Engine, which took 1.5 to 5 minutes per model. Later starts took about 8 to 11 seconds.

## For OBJ-15 (Mac voice intake)

- Use WhisperKit as a Swift package, model `large-v3-v20240930_turbo_632MB` from `argmaxinc/whisperkit-coreml` at the pinned revision in [models/manifest.json](../manifest.json), and verify the SHA-256 of each file after download.
- Set `DecodingOptions(language: "tl", usePrefillPrompt: true)`. Without `usePrefillPrompt`, the language is not forced.
- Load the model at app start and keep it loaded: the first compile takes minutes, and a cold load takes seconds.
- Expect names to come back with other spellings ("Anna", "Jeppoy"). Match contacts by sound or edit distance, not exact text, or pass known names as a prompt (WhisperKit's `promptTokens`; not tested here).
- Re-run `benchmark.py` with the app's own audio path once it exists, to include end-of-speech detection in the latency.
