#!/usr/bin/env python3
"""Renders the cursor cat: one pose per SPEC-04 state in each cat palette, at 1x and 2x.

Reads the stand-in state art in character/assets/svg (generated from character/art/yumi-cat.svg)
and writes mac/Yumi/Overlay/CursorCat.xcassets. The colors are the design tokens' cat palettes
(character/design/tokens.json). Needs resvg (brew install resvg).

Run from anywhere: python3 mac/scripts/render-cursor-cat.py
"""
import json
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "character/assets/svg"
OUT = ROOT / "mac/Yumi/Overlay/CursorCat.xcassets"

# The size of the whole image on screen, in points. Must match CursorLayer.catSize.
POINTS = 48

STATES = ["idle", "listening", "thinking", "moving", "acting", "waitingForUser", "paused", "done", "stuck"]

# The ginger art's colors, then each palette's (fur, markings, line, cheeks), from the design tokens.
GINGER = ("#F0A76A", "#F6DBB5", "#6E413E", "#ED8770")
PALETTES = {
    "ginger": GINGER,
    "mint": ("#86D6BE", "#DDF3EA", "#2F5A50", "#EE9A86"),
    "sky": ("#93BCF0", "#E0EBFB", "#30466B", "#EE9A86"),
    "slate": ("#AEB4BE", "#EEF0F3", "#3B4049", "#EE9A86"),
}


def recolor(svg: str, colors: tuple[str, ...]) -> str:
    # Through placeholders, so one palette's color never gets swapped twice.
    for index, old in enumerate(GINGER):
        svg = svg.replace(old, f"@{index}@")
    for index, new in enumerate(colors):
        svg = svg.replace(f"@{index}@", new)
    return svg


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    info = {"author": "xcode", "version": 1}
    (OUT / "Contents.json").write_text(json.dumps({"info": info}, indent=2) + "\n")
    with tempfile.TemporaryDirectory() as tmp:
        for palette, colors in PALETTES.items():
            for state in STATES:
                name = f"cat-{palette}-{state}"
                folder = OUT / f"{name}.imageset"
                folder.mkdir()
                svg = pathlib.Path(tmp) / f"{name}.svg"
                svg.write_text(recolor((SOURCE / f"yumi-{state}.svg").read_text(), colors))
                images = []
                for scale in (1, 2):
                    png = f"{name}@{scale}x.png"
                    subprocess.run(["resvg", "-w", str(POINTS * scale), str(svg), str(folder / png)], check=True)
                    images.append({"filename": png, "idiom": "mac", "scale": f"{scale}x"})
                contents = {"images": images, "info": info}
                (folder / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")
    print(f"Wrote {len(PALETTES) * len(STATES)} cursor poses to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
