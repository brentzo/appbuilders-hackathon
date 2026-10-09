# Yumi art

`yumi-cat.svg` is the layered master of the orange cat.
It is about 8 KB, has 4 colors, and every part has an `id` (`ear-left`, `body`, `stripes`, `patch`, `tail`, `eyes`, `mouth`, `whiskers`, and so on), so it can be imported into Rive and animated part by part.

Lines are kept as strokes on purpose so they stay the same weight when parts move.
Expand them to filled outlines only for print or cutting.

## Rebuilding it

The tools read the reference image, which is not checked in.
Put it at `tools/ref.png` first.

```bash
pip install opencv-python-headless numpy
python tools/trace.py   # measures the reference and fits the curves -> tools/parts.json
python tools/build.py   # writes tools/yumi-cat.svg and tools/catParts.ts
```

Then copy `tools/yumi-cat.svg` here and `tools/catParts.ts` to `../remotion/src/cat/catParts.ts`.
