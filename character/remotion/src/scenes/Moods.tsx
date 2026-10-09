import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {YumiCat} from '../cat/YumiCat';
import {CatState, poseFor} from '../cat/poses';
import {COLOR, FONT} from '../theme';
import {LandRing, Question, Shadow, SoundArcs, Sparkles, ThinkDots, Zzz} from './Extras';

const MOODS: {state: CatState; title: string; line: string}[] = [
  {state: 'idle', title: 'Idle', line: 'Sits calmly, blinks now and then'},
  {state: 'listening', title: 'Listening', line: 'Ears perk up at “Hey Yumi”'},
  {state: 'thinking', title: 'Thinking', line: 'Eyes follow an idea, tail swishes'},
  {state: 'moving', title: 'Moving', line: 'Trots to the target'},
  {state: 'acting', title: 'Pouncing', line: 'A click is a pounce'},
  {state: 'waitingForUser', title: 'Waiting', line: 'Tilts its head until you answer'},
  {state: 'paused', title: 'Paused', line: 'Curls up and dozes'},
  {state: 'done', title: 'Done', line: 'A happy little hop'},
  {state: 'stuck', title: 'Stuck', line: 'Confused, never alarming'},
];

const SIZE = 196;

/** Every cursor state from SPEC-04 on one sheet. */
export const Moods: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: COLOR.paper, fontFamily: FONT.text, color: COLOR.ink}}>
      <div style={{position: 'absolute', left: 80, top: 96, width: 400}}>
        <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 104, lineHeight: 0.92, letterSpacing: '-0.035em', color: COLOR.line}}>
          Yumi's
          <br />
          moods
        </div>
        <div style={{fontSize: 30, lineHeight: 1.35, color: COLOR.muted, marginTop: 28}}>
          One pose for every cursor state, so you can always tell what Yumi is doing.
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 520,
          top: 40,
          right: 60,
          bottom: 40,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
          gap: 18,
        }}
      >
        {MOODS.map((m, i) => {
          const pop = spring({frame: f - i * 3, fps, config: {damping: 14}});
          const pose = poseFor(m.state, f, fps);
          return (
            <div
              key={m.state}
              style={{
                position: 'relative',
                borderRadius: 34,
                background: '#FFFDF6',
                boxShadow: `inset 0 0 0 2px ${COLOR.paperDeep}`,
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '0 22px 0 16px',
                minWidth: 0,
                transform: `scale(${0.9 + 0.1 * pop})`,
                opacity: pop,
              }}
            >
              <div style={{position: 'relative', width: SIZE, height: SIZE, flex: 'none'}}>
                <Shadow size={SIZE} lift={pose.y ?? 0} />
                <YumiCat size={SIZE} {...pose} />
                {m.state === 'listening' ? <SoundArcs f={f} size={SIZE} /> : null}
                {m.state === 'thinking' ? <ThinkDots f={f} size={SIZE} /> : null}
                {m.state === 'paused' ? <Zzz f={f} size={SIZE} /> : null}
                {m.state === 'stuck' ? <Question f={f} size={SIZE} /> : null}
                {m.state === 'done' ? <Sparkles f={f} size={SIZE} /> : null}
                {m.state === 'acting' ? <LandRing f={f} size={SIZE} period={39} /> : null}
              </div>
              <div style={{minWidth: 0}}>
                <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 36, lineHeight: 1, color: COLOR.line}}>{m.title}</div>
                <div style={{fontSize: 21, lineHeight: 1.3, color: COLOR.muted, marginTop: 8}}>{m.line}</div>
                <div style={{fontFamily: 'Consolas, monospace', fontSize: 17, color: COLOR.orange, marginTop: 12, filter: 'brightness(.8)'}}>{m.state}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
