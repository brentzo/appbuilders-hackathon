#!/usr/bin/env python3
"""Renders the cursor cat's ears-back pose (SPEC-04 r21) in each cat palette, at 1x and 2x.

The cat a pointer comes too close to: ears flat back, eyes narrowed, crouched a little, like a cat
that does not want to be petted. It is built from the master art (character/art/yumi-cat.svg) with
the same part pivots the Remotion cat uses (character/remotion/src/cat/catParts.ts), framed exactly
like the state poses, so the paws land on the same hotspot (CursorLayer.hotspot).

Writes mac/Yumi/Overlay/CursorCat.xcassets/cat-{palette}-earsBack.imageset and leaves the state
poses alone. Needs resvg (brew install resvg).

Run from anywhere: python3 mac/scripts/render-ears-back-cat.py
"""
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import tempfile

# Importing the state poses' script below must not leave a __pycache__ folder in the repo.
sys.dont_write_bytecode = True

ROOT = pathlib.Path(__file__).resolve().parents[2]
MASTER = ROOT / "character/art/yumi-cat.svg"
OUT = ROOT / "mac/Yumi/Overlay/CursorCat.xcassets"

# The palettes, recoloring, and size come from the state poses' script, so every pose matches.
_spec = importlib.util.spec_from_file_location("render_cursor_cat", pathlib.Path(__file__).with_name("render-cursor-cat.py"))
render_cursor_cat = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(render_cursor_cat)

POSE = "earsBack"
# The state poses' frame: the art's 704-unit square grown by 12% on every side (STILL_PAD in
# character/remotion/src/scenes/loopSpec.ts), drawn at 512 px. Keeps the hotspot at 229.6, 434.3.
VIEWBOX = "84.52 135.52 872.96 872.96"
# Ears fold outward around their bases (catParts.ts pivots); negative turns the left ear outward.
EAR_DEGREES = 38
EAR_LEFT_PIVOT = (272, 342)
EAR_RIGHT_PIVOT = (680, 342)
# Eyes narrowed to this share of their height.
EYE_SQUINT = 0.45
# A small crouch around the paws (catParts.ts centerX, groundY), so the paws stay on the hotspot.
PAWS = (476, 876)
CROUCH = (1.04, 0.95)


def ears_back(svg: str) -> str:
    svg = re.sub(r'viewBox="[^"]*"', f'viewBox="{VIEWBOX}" width="512" height="512"', svg, count=1)
    svg = svg.replace('<g id="ear-left">', f'<g id="ear-left" transform="rotate({-EAR_DEGREES} {EAR_LEFT_PIVOT[0]} {EAR_LEFT_PIVOT[1]})">')
    svg = svg.replace('<g id="ear-right">', f'<g id="ear-right" transform="rotate({EAR_DEGREES} {EAR_RIGHT_PIVOT[0]} {EAR_RIGHT_PIVOT[1]})">')

    def squint(match: re.Match) -> str:
        return f'{match.group(1)}ry="{float(match.group(2)) * EYE_SQUINT:.1f}"'

    svg = re.sub(r'(<ellipse id="eye-(?:left|right)"[^>]*?)ry="([\d.]+)"', squint, svg)
    # Everything but the defs crouches together, around the paws.
    x, y = PAWS
    sx, sy = CROUCH
    head, rest = svg.split("</defs>", 1)
    body, tail = rest.rsplit("</svg>", 1)
    crouch = f'<g transform="translate({x} {y}) scale({sx} {sy}) translate({-x} {-y})">'
    return f"{head}</defs>{crouch}{body}</g></svg>{tail}"


def main() -> None:
    source = ears_back(MASTER.read_text())
    info = {"author": "xcode", "version": 1}
    points = render_cursor_cat.POINTS
    with tempfile.TemporaryDirectory() as tmp:
        for palette, colors in render_cursor_cat.PALETTES.items():
            name = f"cat-{palette}-{POSE}"
            folder = OUT / f"{name}.imageset"
            folder.mkdir(parents=True, exist_ok=True)
            svg = pathlib.Path(tmp) / f"{name}.svg"
            svg.write_text(render_cursor_cat.recolor(source, colors))
            images = []
            for scale in (1, 2):
                png = f"{name}@{scale}x.png"
                subprocess.run(["resvg", "-w", str(points * scale), str(svg), str(folder / png)], check=True)
                images.append({"filename": png, "idiom": "mac", "scale": f"{scale}x"})
            contents = {"images": images, "info": info}
            (folder / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")
    print(f"Wrote {len(render_cursor_cat.PALETTES)} {POSE} poses to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
