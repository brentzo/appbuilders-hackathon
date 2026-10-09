#!/bin/sh
# Puts Yumi's voice model into the folder Yumi reads it from (OBJ-51). The app never downloads it.
# Kokoro-82M (Apache-2.0) as converted for MLX by mlx-community, pinned to one revision, and the
# af_heart voice. Copies from ~/Developer/vendor/kokoro-82m when it is there, otherwise downloads
# from Hugging Face. Either way every file is checked against its SHA-256 before it is used.
set -eu

revision="a71e4d38b236d968966a2002c4c895dbd12b1c3c"
source="https://huggingface.co/mlx-community/Kokoro-82M-bf16/resolve/$revision"
vendor="$HOME/Developer/vendor/kokoro-82m"
folder="$HOME/Library/Application Support/Yumi/Models/Voice"
mkdir -p "$folder"

fetch() {
    path="$1"
    sum="$2"
    name=$(basename "$path")
    if [ -f "$folder/$name" ] && echo "$sum  $folder/$name" | shasum -a 256 -c - >/dev/null 2>&1; then
        echo "$name is already there"
        return
    fi
    if [ -f "$vendor/$path" ]; then
        cp "$vendor/$path" "$folder/$name.part"
    else
        curl -fsSL "$source/$path" -o "$folder/$name.part"
    fi
    echo "$sum  $folder/$name.part" | shasum -a 256 -c - >/dev/null
    mv "$folder/$name.part" "$folder/$name"
    echo "Fetched $name"
}

fetch kokoro-v1_0.safetensors 4e9ecdf03b8b6cf906070390237feda473dc13327cb8d56a43deaa374c02acd8
fetch voices/af_heart.safetensors 2c1c733b0e6576c810e268d3e440c21dea4e0f0131a3ba4cfc98d7fe6136d094
echo "Yumi's voice is in $folder"
