# Yumi in Remotion

Video assets of the Yumi cat for the demo and pitch video.
Remotion is for video only; the live cursor uses the Rive file (see [../README.md](../README.md)).

## Run it

```bash
npm install
npm run studio        # live preview of every composition
npm run render:all    # writes every video to out/
```

## Compositions

| ID | Size | Length | What |
|---|---|---|---|
| `YumiIntro` | 1920x1080 | 7 s | Yumi drops in, hears "Hey Yumi", lights up, and steps aside for the wordmark |
| `YumiMoods` | 1920x1080 | 8 s | All 9 cursor states from SPEC-04 on one sheet |
| `YumiLittermates` | 1920x1080 | 6 s | The main cat and two ghost littermates |
| `YumiIdleLoop` | 1080x1080 | 5 s | Seamless idle loop on the paper background |
| `YumiSticker` | 1080x1080 | 5 s | The same loop with a transparent background, rendered as VP9 WebM with alpha for overlays |
| `YumiMoodLoop` | 512x512 | 4 s | One cursor state as a seamless, background-free loop (prop `state`) |
| `YumiPose` | 256x256 | 4 s | One clean, background-free pose for stills (prop `state`) |

## App assets

`npm run export:assets` writes the background-free stand-ins for the apps to [../assets](../assets/README.md): an SVG, a PNG set, and a WebM loop with alpha for every cursor state, plus `manifest.json` with the hotspot.

## Using the cat in a new scene

```tsx
import {YumiCat} from './cat/YumiCat';
import {poseFor} from './cat/poses';

const f = useCurrentFrame();
<YumiCat size={400} {...poseFor('listening', f)} />
```

- `poseFor(state, frame, fps, loop?)` gives the motion for any SPEC-04 cursor state; pass `loop` to snap every rhythm into a seamless loop of that many frames. States: `idle`, `listening`, `thinking`, `moving`, `acting`, `waitingForUser`, `paused`, `done`, `stuck`.
- `mixPose(a, b, t)` blends between two poses for a smooth handover.
- Every pose value is a plain prop, so you can also drive the cat by hand: `earLeft`, `earRight`, `tail`, `blink`, `eyes`, `lookX`, `lookY`, `mouthOpen`, `blush`, `squashX`, `squashY`, `x`, `y`, `tilt`, `whiskers`.
- `palette` recolors the cat, for example for ghost littermates (`LITTERMATES` in `src/theme.ts`).

## Where the art comes from

`src/cat/catParts.ts` is generated from the reference art.
Do not edit it by hand.
The master SVG and the scripts live in [../art](../art):

1. `art/tools/trace.py` measures the reference PNG and fits clean Bezier curves to each part.
2. `art/tools/build.py` assembles `art/yumi-cat.svg` and writes `catParts.ts`.

The rebuilt cat matches 99.6% of the reference pixels away from anti-aliased edges.
The only intended change is the forehead stripes: one width, one gap, rounded ends, middle stripe longest.
