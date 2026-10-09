/**
 * Writes one SVG per SPEC-04 cursor state to the folder given as the only argument, from the
 * layered Remotion cat (character/remotion/src/cat), for mac/scripts/render-cursor-cat.py.
 *
 * Each state uses the same key frame, size, and padding the character assets used before the states
 * moved to the Rive file (character/assets/README.md), so the cursor poses and their hotspot stay
 * as they are. Run by render-cursor-cat.py with character/remotion's tsx; it needs `npm install`
 * in character/remotion.
 */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {YumiCat} from '../../character/remotion/src/cat/YumiCat';
import {CatState, poseFor} from '../../character/remotion/src/cat/poses';
import {LOOP, STILL_PAD} from '../../character/remotion/src/scenes/loopSpec';

// React from character/remotion, the same copy YumiCat uses.
const remotion = createRequire(path.resolve(__dirname, '../../character/remotion/package.json'));
const React = remotion('react') as typeof import('react');
const {renderToStaticMarkup} = remotion('react-dom/server') as typeof import('react-dom/server');

const FPS = 30;

/** Each state's key frame: a moment that reads clearly on its own. */
const STATES: {state: CatState; frame: number}[] = [
  {state: 'idle', frame: 0},
  {state: 'listening', frame: 0},
  {state: 'thinking', frame: 10},
  {state: 'moving', frame: 3},
  {state: 'acting', frame: 5},
  {state: 'waitingForUser', frame: 0},
  {state: 'paused', frame: 0},
  {state: 'done', frame: 0},
  {state: 'stuck', frame: 8},
];

const out = process.argv[2];
if (!out) throw new Error('Usage: cursor-cat-states.tsx <output folder>');
fs.mkdirSync(out, {recursive: true});
for (const {state, frame} of STATES) {
  const svg = renderToStaticMarkup(React.createElement(YumiCat, {size: 512, pad: STILL_PAD, ...poseFor(state, frame, FPS, LOOP)}))
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/ style="[^"]*"/, '');
  fs.writeFileSync(path.join(out, `yumi-${state}.svg`), svg);
}
