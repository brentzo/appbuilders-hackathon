"""Runs openWakeWord's own streaming pipeline on a WAV file and prints one score per 80 ms chunk."""
import sys, wave
import numpy as np
from openwakeword.model import Model

models, wav_path = sys.argv[1], sys.argv[2]
with wave.open(wav_path) as w:
    assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
np.random.seed(0)
m = Model(wakeword_models=[f"{models}/hey_jarvis_v0.1.onnx"], inference_framework="onnx",
          melspec_model_path=f"{models}/melspectrogram.onnx", embedding_model_path=f"{models}/embedding_model.onnx")
for i in range(0, len(audio) - 1279, 1280):
    print(f"{m.predict(audio[i:i+1280])['hey_jarvis_v0.1']:.6f}")
