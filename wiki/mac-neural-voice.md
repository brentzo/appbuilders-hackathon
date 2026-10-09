# Yumi's neural voice on the Mac

What we compared to replace the robotic system voice, what Brent picked, and how fast and how big the result is next to Qwen3.5-9B.
Measured on 2026-10-10 on Brent's MacBook (Apple M5, 16 GB, macOS 26.6) for [OBJ-51](../objectives/OBJ-51-mac-neural-voice.md).

## Result

- Yumi speaks with Kokoro-82M and its af_heart voice, at speed 1.1, raised 7 semitones: 4 inside the model with livelier intonation, 3 on playback.
- The first repeat-back of a goal starts with the cat's meow, which plays at once while the voice gets the first sentence ready.
- It runs on MLX Swift inside the Mac app, from files stored on the Mac ahead of time, and works with the network off.
- If it cannot load, Yumi stays quiet and shows "Voice didn't load (Mac)" instead of falling back to the system voice (Brent's decision).

## Candidates

| Model | Licence | Runtime on the Mac | Peak memory | First sound, warm | Verdict |
|---|---|---|---|---|---|
| Kokoro-82M | Apache-2.0 | MLX Swift (kokoro-ios, MIT) with MisakiSwift (Apache-2.0) | about 0.5 GB | 0.1 to 0.3 s, a whole sentence at a time | Chosen |
| Kyutai Pocket TTS | CC-BY-4.0 | No Swift port checked; FluidAudio's Core ML build is the likely route | about 0.4 GB | about 45 ms, streaming | Not picked by ear |
| Qwen3-TTS 1.7B VoiceDesign, 8-bit | Apache-2.0 | No Swift port known | about 3.7 GB | 0.2 to 0.9 s, streaming | Too big next to Qwen3.5-9B, and the voice changes from line to line |
| Chatterbox, 8-bit | MIT | No Swift port known | about 2.3 GB | about 1.8 s for the repeat-back | Too slow |

FluidAudio's Core ML Kokoro was ruled out because its pronunciation step is eSpeak-NG, which is GPL-3.0.
Supertonic was ruled out because its repository was announced as archived.
The memory and latency in this table come from Python (mlx-audio 0.5.8), not the app.

## How the voice was picked

- Round 1: six stock voices (four Kokoro, two Pocket TTS), then six male voices. Brent liked none and asked for something much cuter, like an animated cat character.
- Round 2: Kokoro pitched up by three methods (inside the model, `AVAudioUnitTimePitch`, and a blend of both), the two expressive models, and a chirp before each line.
- Brent picked the blend at +7 semitones with a sound before lines, and asked for a real meow instead of the chirp.
- The samples are in `~/Developer/vendor/yumi-voice-samples` on Brent's Mac.

Raising the pitch inside the model works because Kokoro's decoder renders audio from a predicted pitch curve.
Shifting that curve changes the pitch but keeps the voice's character, while `AVAudioUnitTimePitch` moves the formants too and starts to sound like a chipmunk.
The blend uses a little of the second to make the voice sound smaller.
Measured median pitch of the repeat-back: 209 Hz as af_heart speaks it, 320 Hz with the chosen blend.

## In the app

Measured in the Debug app with `-YumiSay`, with Qwen3.5-9B loaded in the model server (6.2 GB).
"First word" is from the line being asked for to its first sentence being queued for playback.

| What | Time |
|---|---|
| Loading the voice, first time after a restart | 5.5 s |
| Loading the voice, files already cached by macOS | 0.7 s |
| "On it." | 162 ms to the first word |
| The repeat-back, without the meow | 482 ms to the first word |
| The repeat-back as the opening line | The meow at once, the first word at 1.17 s, right after the meow fades |
| The system voice, for comparison | 105 ms to the first word warm, 583 ms for its first line |

| Memory | Size |
|---|---|
| The app without the voice | 38 MB |
| The app with the voice loaded | 525 to 530 MB |
| Peak while loading | 1.3 GB, for a moment |

- The repeat-back is the line that matters most, and it opens with the meow, so the user hears Yumi answer at once, sooner than the system voice's first word.
- A plain line such as "On it." starts about 60 ms later than the system voice did.
- A Release build should be a little faster, since only the model's GPU kernels are optimized in Debug. Not measured.

## Offline

- The app reads the model and voice from `~/Library/Application Support/Yumi/Models/Voice`; `mac/scripts/fetch-voice-model.sh` puts them there with their checksums.
- With all internet traffic blocked by a sandbox rule, the app loaded the voice and said the repeat-back with the meow, and `lsof` showed no internet sockets.
- Nothing about speech leaves the Mac: the text goes to the model in the app, and the audio to the speakers.

## Not measured

- Memory and latency while Qwen3.5-9B is answering a request at the same moment. Both run on the GPU, so a line may start later while the model is busy.
- A Release build.
- How it sounds through the real app: Brent still has to listen to the live app (steps in OBJ-51's Outcome).
