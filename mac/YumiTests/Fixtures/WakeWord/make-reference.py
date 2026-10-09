# Makes reference.json for WakeWordTests (OBJ-16.2): openWakeWord 0.6.0's own features and
# "hey jarvis" scores for hey-jarvis-clip.wav, fed in 80 ms chunks the way the Mac app feeds them.
# The clip is the macOS voice Samantha saying "Hey Jarvis. Export my Keynote deck as a PDF." at
# 16 kHz, with 2 s of silence before and 1 s after.
# Run with openwakeword==0.6.0, onnxruntime, and numpy installed, from this folder.
import json, wave
import numpy as np
from openwakeword.model import Model

clip = wave.open("hey-jarvis-clip.wav")
audio = np.frombuffer(clip.readframes(clip.getnframes()), dtype=np.int16)
audio = audio[: len(audio) // 1280 * 1280]
model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
embeddings, scores = [], []
for start in range(0, len(audio), 1280):
    score = model.predict(audio[start:start + 1280])
    scores.append(float(list(score.values())[0]))
    embeddings.append(model.preprocessor.feature_buffer[-1].tolist())
print("chunks", len(scores), "max score", max(scores), "at chunk", int(np.argmax(scores)))
json.dump({"samples": len(audio), "chunk": 1280, "leadingSilenceSamples": 32000, "embeddings": embeddings, "scores": scores},
          open("reference.json", "w"), separators=(",", ":"))
