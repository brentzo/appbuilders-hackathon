#!/usr/bin/env python3
"""Renders the Yumi mark images the app draws, from character/assets/logo/yumi-mark.svg.

Writes res/drawable-nodpi/yumi_mark.png (the cat on home and onboarding), res/drawable-xxxhdpi/yumi_mark_small.png
(the 26 dp header mark), and res/drawable-nodpi/yumi_mark_happy.png: the mark with the happy closed eyes of the
Mac's "done" pose. One renderer draws both 1024 px images, so the tap reaction swaps them without a jump.
Needs resvg (brew install resvg).

Run from anywhere: python3 android/scripts/render-mark.py
"""
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MARK = ROOT / "character/assets/logo/yumi-mark.svg"
RES = ROOT / "android/app/src/main/res"
LINE = "#6E413E"


def happy(svg: str) -> str:
    """Swaps each eye (a cocoa ellipse) for an arc that curves up, like a smile turned over."""
    def arc(match: re.Match) -> str:
        cx, cy = float(match["cx"]), float(match["cy"])
        return (f'<path d="M{cx - 18:.1f} {cy + 6:.1f}Q{cx:.1f} {cy - 18:.1f} {cx + 18:.1f} {cy + 6:.1f}" '
                f'fill="none" stroke="{LINE}" stroke-width="12" stroke-linecap="round"></path>')
    pattern = re.compile(r'<ellipse cx="(?P<cx>[\d.]+)" cy="(?P<cy>[\d.]+)" rx="[\d.]+" ry="[\d.]+" fill="' + LINE + r'"></ellipse>')
    result, count = pattern.subn(arc, svg)
    if count != 2:
        raise SystemExit(f"Expected 2 eyes in {MARK.name}, found {count}")
    return result


def render(svg: pathlib.Path, out: pathlib.Path, px: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["resvg", "-w", str(px), "-h", str(px), str(svg), str(out)], check=True)


render(MARK, RES / "drawable-nodpi/yumi_mark.png", 1024)
render(MARK, RES / "drawable-xxxhdpi/yumi_mark_small.png", 104)
with tempfile.TemporaryDirectory() as tmp:
    happy_svg = pathlib.Path(tmp) / "yumi-mark-happy.svg"
    happy_svg.write_text(happy(MARK.read_text(encoding="utf-8")), encoding="utf-8")
    render(happy_svg, RES / "drawable-nodpi/yumi_mark_happy.png", 1024)
print("Wrote yumi_mark.png, yumi_mark_small.png, and yumi_mark_happy.png")
