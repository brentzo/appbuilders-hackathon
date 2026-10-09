import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {YumiCat} from '../cat/YumiCat';
import {CatState, poseFor} from '../cat/poses';
import {Question, SoundArcs, Sparkles, ThinkDots, Zzz, LandRing} from './Extras';

export type MoodProps = {state: CatState};

import {LOOP, LOOP_CAT, STILL_PAD} from './loopSpec';

export {LOOP};

/** A background-free, seamlessly looping mood for the apps, with the small marks that make the state readable. */
export const MoodLoop: React.FC<MoodProps> = ({state}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pose = poseFor(state, f, fps, LOOP);
  const {left, top, size} = LOOP_CAT;
  return (
    <AbsoluteFill style={{background: 'transparent'}}>
      <div style={{position: 'absolute', left, top, width: size, height: size}}>
        <YumiCat size={size} {...pose} />
        {state === 'listening' ? <SoundArcs f={f} size={size} /> : null}
        {state === 'thinking' ? <ThinkDots f={f} size={size} /> : null}
        {state === 'paused' ? <Zzz f={f} size={size} /> : null}
        {state === 'stuck' ? <Question f={f} size={size} /> : null}
        {state === 'done' ? <Sparkles f={f} size={size} /> : null}
        {state === 'acting' ? <LandRing f={f} size={size} period={40} /> : null}
      </div>
    </AbsoluteFill>
  );
};

/** A clean, background-free still of one pose, filling the canvas. Used for the PNG sets. */
export const PoseStill: React.FC<MoodProps> = ({state}) => {
  const f = useCurrentFrame();
  const {fps, width} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: 'transparent'}}>
      <YumiCat size={width} pad={STILL_PAD} {...poseFor(state, f, fps, LOOP)} />
    </AbsoluteFill>
  );
};
