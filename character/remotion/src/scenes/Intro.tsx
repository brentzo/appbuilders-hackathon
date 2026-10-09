import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {YumiCat} from '../cat/YumiCat';
import {mixPose, poseFor} from '../cat/poses';
import {COLOR, FONT} from '../theme';
import {Shadow, SoundArcs, Sparkles} from './Extras';

const CAT_SIZE = 640;
const WORD = 'yumi';

/** Logo reveal: Yumi drops in, hears "Hey Yumi", lights up, and steps aside for the wordmark. */
export const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  // 1. drop in with a squash on landing
  const drop = spring({frame: f - 4, fps, config: {damping: 13, mass: 0.9, stiffness: 120}});
  const fallY = interpolate(drop, [0, 1], [-height, 0]);
  const land = Math.max(0, 1 - Math.abs(f - 20) / 7);
  const landPose = {squashY: 1 - 0.14 * land, squashX: 1 + 0.1 * land};

  // 2. states over time
  const idle = poseFor('idle', f, fps);
  const listen = poseFor('listening', f, fps);
  const happy = poseFor('done', f - 112, fps);
  let pose = f < 58 ? idle : mixPose(idle, listen, (f - 58) / 8);
  if (f >= 104) pose = mixPose(listen, happy, (f - 104) / 8);
  if (f >= 150) pose = mixPose(happy, idle, (f - 150) / 10);
  if (f < 30) pose = {...pose, ...landPose};

  // 3. slide left for the wordmark
  const slide = spring({frame: f - 128, fps, config: {damping: 16}});
  const catX = interpolate(slide, [0, 1], [0, -360]);

  // speech bubble
  const bubbleIn = spring({frame: f - 46, fps, config: {damping: 12}});
  const bubbleOut = interpolate(f, [118, 128], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const bubble = bubbleIn * bubbleOut;

  const halo = spring({frame: f - 2, fps, config: {damping: 20}});
  const tagline = interpolate(f, [168, 184], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const catLeft = width / 2 - CAT_SIZE / 2 + catX;
  const catTop = height / 2 - CAT_SIZE / 2 + 30;

  return (
    <AbsoluteFill style={{background: COLOR.paper, fontFamily: FONT.text}}>
      <div
        style={{
          position: 'absolute',
          left: width / 2 - 420 + catX,
          top: height / 2 - 400,
          width: 840,
          height: 840,
          borderRadius: '50%',
          background: COLOR.paperDeep,
          transform: `scale(${halo})`,
        }}
      />
      <div style={{position: 'absolute', left: catLeft, top: catTop + fallY, width: CAT_SIZE, height: CAT_SIZE}}>
        <Shadow size={CAT_SIZE} lift={pose.y ?? 0} />
        <YumiCat size={CAT_SIZE} {...pose} />
        {f >= 60 && f < 104 ? <SoundArcs f={f} size={CAT_SIZE} /> : null}
        {f >= 110 && f < 160 ? <Sparkles f={f} size={CAT_SIZE} /> : null}
      </div>

      <div
        style={{
          position: 'absolute',
          left: width / 2 - 620,
          top: 150,
          padding: '22px 34px',
          borderRadius: 40,
          borderBottomRightRadius: 8,
          background: '#FFFFFF',
          boxShadow: '0 18px 40px -18px rgba(74,46,38,.35)',
          fontFamily: FONT.display,
          fontWeight: 800,
          fontSize: 64,
          color: COLOR.ink,
          transform: `scale(${bubble})`,
          transformOrigin: '100% 100%',
          opacity: bubble,
        }}
      >
        Hey Yumi!
      </div>

      <div style={{position: 'absolute', left: width / 2 + 40, top: height / 2 - 190, display: 'flex'}}>
        {WORD.split('').map((ch, i) => {
          const s = spring({frame: f - 140 - i * 4, fps, config: {damping: 11, stiffness: 140}});
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontFamily: FONT.display,
                fontWeight: 800,
                fontSize: 300,
                letterSpacing: '-0.04em',
                lineHeight: 1,
                color: COLOR.line,
                transform: `translateY(${interpolate(s, [0, 1], [90, 0])}px)`,
                opacity: s,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
      <div
        style={{
          position: 'absolute',
          left: width / 2 + 52,
          top: height / 2 + 140,
          fontSize: 46,
          fontWeight: 600,
          color: COLOR.muted,
          opacity: tagline,
          transform: `translateY(${(1 - tagline) * 20}px)`,
        }}
      >
        Say it once. Watch the cat do it.
      </div>
    </AbsoluteFill>
  );
};
