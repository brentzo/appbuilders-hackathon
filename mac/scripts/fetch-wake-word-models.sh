#!/bin/sh
# Downloads the wake word models into the folder Yumi reads them from (OBJ-16).
# They are not in git. The wake word model is a STAND-IN until OBJ-12's "Hey Yumi":
# openWakeWord's pre-trained "hey jarvis". openWakeWord's pre-trained models are licensed
# CC BY-NC-SA 4.0 (non-commercial), so they are fetched for development and never shipped.
set -eu

release="https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"
folder="$HOME/Library/Application Support/Yumi/Models/WakeWord"
mkdir -p "$folder"

fetch() {
    name="$1"
    sum="$2"
    if [ -f "$folder/$name" ] && echo "$sum  $folder/$name" | shasum -a 256 -c - >/dev/null 2>&1; then
        echo "$name is already there"
        return
    fi
    curl -fsSL "$release/$name" -o "$folder/$name.part"
    echo "$sum  $folder/$name.part" | shasum -a 256 -c - >/dev/null
    mv "$folder/$name.part" "$folder/$name"
    echo "Downloaded $name"
}

fetch melspectrogram.onnx ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f
fetch embedding_model.onnx 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
fetch hey_jarvis_v0.1.onnx 94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb
echo "Wake word models are in $folder"
