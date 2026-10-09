import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {YumiCat} from '../cat/YumiCat';
import {blinkEvery, wave} from '../cat/poses';
import {COLOR} from '../theme';
import {Shadow} from './Extras';

export type IdleLoopProps = {transparent: boolean};

/**
 * A seamless loop: every motion's period divides the composition length, so frame 0 follows the last frame cleanly.
 * The transparent version is for overlays in the pitch video.
 */
export const IdleLoop: React.FC<IdleLoopProps> = ({transparent}) => {
  const f = useCurrentFrame();
  const {width, durationInFrames: D} = useVideoConfig();
  const size = width * 0.78;
  const b = wave(f, D / 2);
  const pose = {
    squashY: 1 + 0.014 * b,
    squashX: 1 - 0.009 * b,
    blink: blinkEvery(f, D, Math.round(D * 0.4)),
    tail: 6 * wave(f, D / 2, 0.6),
    earRight: f > D * 0.75 && f < D * 0.85 ? -6 * Math.sin((Math.PI * (f - D * 0.75)) / (D * 0.1)) : 0,
    whiskers: 1.5 * wave(f, D / 2, 1.2),
  };
  return (
    <AbsoluteFill style={{background: transparent ? 'transparent' : COLOR.paper, alignItems: 'center', justifyContent: 'center'}}>
      <div style={{position: 'relative', width: size, height: size}}>
        {transparent ? null : <Shadow size={size} />}
        <YumiCat size={size} {...pose} />
      </div>
    </AbsoluteFill>
  );
};
