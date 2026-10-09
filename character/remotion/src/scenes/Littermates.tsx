import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {YumiCat} from '../cat/YumiCat';
import {poseFor} from '../cat/poses';
import {COLOR, FONT, LITTERMATES} from '../theme';
import {Shadow} from './Extras';

const CATS = [
  {label: 'Main cat', sub: 'Your pointer and keyboard', palette: undefined, state: 'thinking' as const},
  {label: 'Ghost', sub: 'Fill expense form', palette: LITTERMATES.mint, state: 'moving' as const},
  {label: 'Ghost', sub: 'Add chart to Keynote', palette: LITTERMATES.sky, state: 'acting' as const},
];

/** SPEC-04: ghost cursors are the same cat in their own color, like littermates. */
export const Littermates: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{background: COLOR.paper, fontFamily: FONT.text}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 80, textAlign: 'center', fontFamily: FONT.display, fontWeight: 800, fontSize: 84, color: COLOR.line, letterSpacing: '-0.03em'}}>
        One cat, a few littermates
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 260, display: 'flex', justifyContent: 'center', gap: 80}}>
        {CATS.map((c, i) => {
          const pop = spring({frame: f - i * 6, fps, config: {damping: 12}});
          const pose = poseFor(c.state, f + i * 9, fps);
          const accent = c.palette?.orange ?? COLOR.orange;
          return (
            <div key={i} style={{width: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${(1 - pop) * 60}px)`, opacity: pop}}>
              <div style={{position: 'relative', width: 420, height: 420}}>
                <Shadow size={420} lift={pose.y ?? 0} />
                <YumiCat size={420} palette={c.palette} {...pose} />
              </div>
              <div style={{marginTop: 26, padding: '10px 22px', borderRadius: 18, background: accent, color: c.palette?.line ?? COLOR.ink, fontSize: 32, fontWeight: 600}}>
                {c.label}
              </div>
              <div style={{marginTop: 12, fontSize: 28, color: COLOR.muted}}>{c.sub}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
