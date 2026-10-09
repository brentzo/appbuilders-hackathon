#!/usr/bin/env python3
"""Renders the cursor cat: one pose per SPEC-04 state in each cat palette, at 1x and 2x.

Draws each state from the layered Remotion cat (character/remotion/src/cat) with
mac/scripts/cursor-cat-states.tsx, then writes mac/Yumi/Overlay/CursorCat.xcassets. The colors are
the design tokens' cat palettes (character/design/tokens.json). Needs resvg (brew install resvg) and
`npm install` in character/remotion.

Run from anywhere: python3 mac/scripts/render-cursor-cat.py
"""
import json
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
REMOTION = ROOT / "character/remotion"
STATE_ART = ROOT / "mac/scripts/cursor-cat-states.tsx"
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
    # Only the state poses are replaced: the ears-back pose (render-ears-back-cat.py) stays.
    OUT.mkdir(parents=True, exist_ok=True)
    info = {"author": "xcode", "version": 1}
    (OUT / "Contents.json").write_text(json.dumps({"info": info}, indent=2) + "\n")
    with tempfile.TemporaryDirectory() as tmp:
        source = pathlib.Path(tmp) / "states"
        tsx = REMOTION / "node_modules/.bin/tsx"
        if not tsx.exists():
            raise SystemExit(f"Run `npm install` in {REMOTION.relative_to(ROOT)} first")
        subprocess.run([str(tsx), str(STATE_ART), str(source)], cwd=REMOTION, check=True)
        for palette, colors in PALETTES.items():
            for state in STATES:
                name = f"cat-{palette}-{state}"
                folder = OUT / f"{name}.imageset"
                if folder.exists():
                    shutil.rmtree(folder)
                folder.mkdir()
                svg = pathlib.Path(tmp) / f"{name}.svg"
                svg.write_text(recolor((source / f"yumi-{state}.svg").read_text(), colors))
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
