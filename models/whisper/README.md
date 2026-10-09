# Whisper benchmark

`benchmark.py` compares one already-loaded local transcription server with a JSONL corpus.
Run it once for each candidate model and runtime, then compare the JSON reports.
Only consented transcripts belong in the repository; keep all audio in team shared storage.

## Corpus format

Each JSONL row has a unique `id`, a `group` (`taglish` or `english`), a relative `audio` filename, and the verified `reference` transcript.
The audio directory is passed separately, so shared-storage paths and recordings do not enter Git.

```json
{"id":"clip-001","group":"taglish","audio":"clip-001.wav","reference":"<verified transcript>"}
```

## Run

Start one runtime with one model loaded and bound to localhost.
The runner submits the first clip once as a warm-up, then submits every clip sequentially and records per-request latency after the model is warm.
It also reports corpus WER by language group.

WhisperKit's official CLI supports a local OpenAI-compatible transcription server.
For example, from its source checkout:

```sh
BUILD_ALL=1 swift run argmax-cli serve --host 127.0.0.1 --port 50060 --model <model-name>
```

`<model-name>` must be installed in WhisperKit's supported format.
The API endpoint is `http://127.0.0.1:50060/v1/audio/transcriptions`.

For whisper.cpp, start its server with a converted model file:

```sh
whisper-server --host 127.0.0.1 --port 8080 --model <ggml-model-file>
```

The endpoint is `http://127.0.0.1:8080/inference`.
Check `whisper-server --help` for build-specific flags.

Then run:

```sh
python3 models/whisper/benchmark.py \
  --runtime whisperkit \
  --model <model-label> \
  --endpoint http://127.0.0.1:50060/v1/audio/transcriptions \
  --manifest models/whisper/transcripts.jsonl \
  --audio-dir /path/to/approved/shared/recordings \
  --output models/whisper/results/<runtime>-<model>.json
```

For whisper.cpp, set `--runtime whisper.cpp` and the `/inference` endpoint.
The report stores per-clip references, transcripts, WER edit counts, and latency, plus Taglish and English totals.
It gives two WERs: raw, and normalized, which first rewrites written forms into the spoken forms the references use (digits, clock times, "3pm", "github.com", and hyphens inside words), so only real word errors count.
To score a saved report again after the scoring rules change, run `python3 models/whisper/benchmark.py --rescore <report.json> --output <report.json>`.
An unused group appears with a sample count of zero and no WER or latency value.
The report does not measure peak memory; record that separately while the Mac brain and wake-word model are loaded.
Reports contain transcripts of the recorded speech, so commit them only with the speaker's consent. Brent consented for his corpus on 2026-10-09.

Pass `--language tl` for Taglish.
With auto-detect, small and medium translate Taglish into English instead of transcribing it, and whisper.cpp runs the encoder twice.
WhisperKit's server ignores the request's `language` unless the server itself is started with `--language tl`.

## Results

The Mac results, the recommended model, and how it was chosen are in [RESULTS.md](RESULTS.md).
Each run's report and the memory measurements (`memory.json`) are committed in `results/`, with Brent's consent.

## Runtime references

- [WhisperKit local server](https://github.com/argmaxinc/argmax-oss-swift#local-server)
- [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)

## Recording the corpus

`record/record.py` records the goals in `record/prompts.jsonl` (20 Taglish, 10 English) on the Mac's microphone, one at a time:

```sh
python3 models/whisper/record/record.py
```

- Everything happens in the terminal with the Enter key; there is nothing to click. A "pop" plays just before the microphone opens and a "tink" when the clip is saved.
- It shows each goal, records while you speak, and lets you play it back, redo it, or type what you actually said.
- Audio is saved as 16 kHz mono WAV in `~/Yumi recordings/whisper`, outside git. Pass `--out` to put it in shared storage instead.
- It writes `transcripts.jsonl`, the manifest `benchmark.py` reads, after every clip, so you can stop and continue later.
- `--redo tl-03` records one goal again.
- It uses only Apple's frameworks: the first run compiles a small Swift recorder, and macOS asks once for microphone access for your terminal.
- References are written the way the goal is spoken, with numbers as words.
