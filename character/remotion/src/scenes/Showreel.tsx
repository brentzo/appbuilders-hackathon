import React from 'react';
import {AbsoluteFill, Easing, interpolate, Series, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {CatSpot, Chip, Check, Decor, Headline, Kicker, Lock, MonoTag, ON_ACCENT, Panel, Progress, SceneFade, Sub, Window, Button, INK} from './ShowreelKit';
import {CatState, mixPose, poseFor, wave} from '../cat/poses';
import {COLOR, FONT, LITTERMATES} from '../theme';
import {LandRing, SoundArcs, Sparkles, ThinkDots, Zzz} from './Extras';

const fps = 30;

/** 60 second showreel: Yumi's voice loop, the cat at work, the phone remote, ghosts, control, and the local-first promise. */
export const Showreel: React.FC = () => (
  <AbsoluteFill style={{background: COLOR.paper}}>
    <Series>
      <Series.Sequence durationInFrames={150}>
        <Hook />
      </Series.Sequence>
      <Series.Sequence durationInFrames={210}>
        <VoiceLoop />
      </Series.Sequence>
      <Series.Sequence durationInFrames={300}>
        <CatAtWork />
      </Series.Sequence>
      <Series.Sequence durationInFrames={270}>
        <PhoneRemote />
      </Series.Sequence>
      <Series.Sequence durationInFrames={210}>
        <Ghosts />
      </Series.Sequence>
      <Series.Sequence durationInFrames={210}>
        <Control />
      </Series.Sequence>
      <Series.Sequence durationInFrames={210}>
        <ListToNote />
      </Series.Sequence>
      <Series.Sequence durationInFrames={240}>
        <Close />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ */
/* 1. Hook                                                            */
/* ------------------------------------------------------------------ */

const Wordmark: React.FC<{size: number; start: number; style?: React.CSSProperties; color?: string}> = ({size, start, style, color = COLOR.line}) => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();
  return (
    <div style={{display: 'flex', ...style}}>
      {'yumi'.split('').map((ch, i) => {
        const s = spring({frame: f - start - i * 4, fps: fp, config: {damping: 11, stiffness: 140}});
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              fontFamily: FONT.display,
              fontWeight: 800,
              fontSize: size,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              color,
              transform: `translateY(${interpolate(s, [0, 1], [90, 0])}px)`,
              opacity: s,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
};

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp, width, height} = useVideoConfig();
  const CAT = 620;
  const drop = spring({frame: f - 2, fps: fp, config: {damping: 13, mass: 0.9, stiffness: 120}});
  const fallY = interpolate(drop, [0, 1], [-height, 0]);
  const land = Math.max(0, 1 - Math.abs(f - 24) / 7);

  const idle = poseFor('idle', f, fp);
  const listen = poseFor('listening', f, fp);
  let pose = f < 42 ? idle : mixPose(idle, listen, (f - 42) / 8);
  if (f < 32) pose = {...pose, squashY: 1 - 0.14 * land, squashX: 1 + 0.1 * land};

  const bubble = spring({frame: f - 22, fps: fp, config: {damping: 12}});
  const kicker = interpolate(f, [104, 124], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const tagline = interpolate(f, [122, 140], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});

  const catLeft = 250;
  const catTop = height / 2 - CAT / 2 + 20;

  return (
    <SceneFade>
      <Decor />
      <div
        style={{
          position: 'absolute',
          left: catLeft - 200,
          top: catTop - 180,
          width: CAT + 400,
          height: CAT + 400,
          borderRadius: '50%',
          background: COLOR.paperDeep,
          transform: `scale(${spring({frame: f, fps: fp, config: {damping: 20}})})`,
        }}
      />
      <div style={{position: 'absolute', left: catLeft, top: catTop + fallY, width: CAT, height: CAT}}>
        <CatSpot size={CAT} pose={pose}>
          {f >= 46 && f < 100 ? <SoundArcs f={f} size={CAT} /> : null}
        </CatSpot>
      </div>

      <div
        style={{
          position: 'absolute',
          left: catLeft + CAT - 120,
          top: 130,
          padding: '20px 32px',
          borderRadius: 38,
          borderBottomRightRadius: 8,
          background: '#FFFFFF',
          boxShadow: '0 18px 40px -18px rgba(74,46,38,.35)',
          fontFamily: FONT.display,
          fontWeight: 800,
          fontSize: 60,
          color: INK,
          transform: `scale(${bubble})`,
          transformOrigin: '100% 100%',
          opacity: bubble,
        }}
      >
        Hey Yumi!
      </div>

      <div style={{position: 'absolute', left: 880, top: 150}}>
        <div style={{opacity: kicker, transform: `translateY(${(1 - kicker) * 18}px)`}}>
          <Kicker>A local AI companion</Kicker>
        </div>
        <Wordmark size={300} start={64} style={{marginTop: 8}} />
        <div
          style={{
            marginTop: 26,
            fontFamily: FONT.text,
            fontSize: 42,
            fontWeight: 600,
            color: COLOR.muted,
            opacity: tagline,
            transform: `translateY(${(1 - tagline) * 20}px)`,
          }}
        >
          Say it once. Watch the cat do it.
        </div>
      </div>
    </SceneFade>
  );
};

/* ------------------------------------------------------------------ */
/* 2. Voice loop                                                      */
/* ------------------------------------------------------------------ */

const VoiceLoop: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();

  const state: CatState = f < 60 ? 'listening' : f < 112 ? 'waitingForUser' : 'done';
  const pose = poseFor(state, f, fp);
  const dot = f < 60 ? COLOR.orange : f < 112 ? COLOR.hush : COLOR.orange;

  const wake = spring({frame: f - 8, fps: fp, config: {damping: 14}});
  const user = spring({frame: f - 34, fps: fp, config: {damping: 14}});
  const yumi = spring({frame: f - 66, fps: fp, config: {damping: 14}});
  const go = spring({frame: f - 116, fps: fp, config: {damping: 13, stiffness: 160}});
  const onIt = interpolate(f, [124, 140], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});

  return (
    <SceneFade>
      <Decor />
      <div style={{position: 'absolute', left: 100, top: 84}}>
        <Kicker>01 · The goal loop</Kicker>
        <Headline style={{marginTop: 14, fontSize: 78}}>
          You talk.
          <br />
          Yumi repeats it back.
        </Headline>
        <Sub style={{marginTop: 22, maxWidth: 820}}>
          Every goal is repeated and confirmed before a single click, so nothing happens you did not ask for.
        </Sub>

        <div style={{marginTop: 40, display: 'flex', flexDirection: 'column', gap: 30, alignItems: 'flex-start'}}>
          <div style={{transform: `translateY(${(1 - wake) * 30}px)`, opacity: wake}}>
            <Chip dot={COLOR.orange}>Hey Yumi</Chip>
          </div>
          <div style={{alignSelf: 'flex-end', transform: `translateY(${(1 - user) * 30}px)`, opacity: user}}>
            <div style={{position: 'relative', background: '#FFFFFF', borderRadius: 26, borderBottomRightRadius: 8, padding: '18px 26px', boxShadow: '0 18px 44px -20px rgba(74,46,38,.35)', fontFamily: FONT.text, fontSize: 30, color: INK, lineHeight: 1.3, maxWidth: 620}}>
              Export my Q3 Report deck as a PDF.
            </div>
          </div>
          <div style={{transform: `translateY(${(1 - yumi) * 30}px)`, opacity: yumi}}>
            <div style={{position: 'relative', background: '#FFFFFF', borderRadius: 26, borderBottomLeftRadius: 8, padding: '20px 26px', boxShadow: '0 18px 44px -20px rgba(74,46,38,.35)', fontFamily: FONT.text, fontSize: 28, color: INK, lineHeight: 1.3, maxWidth: 640}}>
              You want me to export your Q3 Report deck as a PDF. Should I go ahead?
              <div style={{display: 'flex', gap: 14, marginTop: 18}}>
                <Button kind="go" style={{fontSize: 25, padding: '12px 28px', transform: `scale(${0.9 + 0.1 * go})`, boxShadow: go > 0 ? '0 14px 30px -16px rgba(240,167,106,1)' : 'none'}}>Go ahead</Button>
                <Button kind="ghost" style={{fontSize: 25, padding: '12px 28px'}}>Change it</Button>
                <Button kind="ghost" style={{fontSize: 25, padding: '12px 28px'}}>Cancel</Button>
              </div>
            </div>
          </div>
          <div style={{opacity: onIt, transform: `translateY(${(1 - onIt) * 16}px)`}}>
            <Chip dot={COLOR.coral}>On it.</Chip>
          </div>
        </div>
      </div>

      <div style={{position: 'absolute', left: 1180, top: 250, width: 620, height: 620}}>
        <CatSpot size={620} pose={pose}>
          {state === 'listening' ? <SoundArcs f={f} size={620} /> : null}
          {state === 'waitingForUser' ? <Question f={f} size={620} /> : null}
          {state === 'done' ? <Sparkles f={f} size={620} /> : null}
        </CatSpot>
      </div>
      <div style={{position: 'absolute', left: 1180, top: 890, width: 620, textAlign: 'center'}}>
        <Chip dot={dot}>{state}</Chip>
      </div>
    </SceneFade>
  );
};

/* ------------------------------------------------------------------ */
/* 3. The cat at work: Keynote -> PDF                                  */
/* ------------------------------------------------------------------ */

type Wp = {at: number; x: number; y: number; click?: boolean};

const seg = (f: number, wps: Wp[]) => {
  if (wps.length === 0) return {x: 0, y: 0, transit: false};
  if (f <= wps[0].at) return {x: wps[0].x, y: wps[0].y, transit: false};
  const last = wps[wps.length - 1];
  if (f >= last.at) return {x: last.x, y: last.y, transit: false};
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    if (f >= a.at && f <= b.at) {
      const t = (f - a.at) / (b.at - a.at);
      const e = Easing.inOut(Easing.cubic)(t);
      return {x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, transit: true};
    }
  }
  return {x: last.x, y: last.y, transit: false};
};

const CatAtWork: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();
  const CAT = 118;
  const WX = 370;
  const WY = 196;

  const wps: Wp[] = [
    {at: 22, x: WX + 560, y: WY + 560},
    {at: 58, x: WX + 60, y: WY + 74, click: true},
    {at: 112, x: WX + 220, y: WY + 330, click: true},
    {at: 172, x: WX + 940, y: WY + 470, click: true},
    {at: 214, x: WX + 560, y: WY + 560},
  ];
  const pos = seg(f, wps);
  const clicks = wps.filter((w) => w.click).map((w) => w.at);
  const clicking = clicks.some((c) => f >= c && f < c + 18);
  const finished = f >= 214;
  const state: CatState = clicking ? 'acting' : pos.transit ? 'moving' : finished ? 'done' : 'idle';
  const pose = poseFor(state, f, fp);

  const win = spring({frame: f - 4, fps: fp, config: {damping: 16}});
  const menu = spring({frame: f - 64, fps: fp, config: {damping: 14}});
  const dialog = spring({frame: f - 120, fps: fp, config: {damping: 15}});
  const progress = interpolate(f, [180, 216], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const saved = spring({frame: f - 220, fps: fp, config: {damping: 14}});
  const summary = spring({frame: f - 240, fps: fp, config: {damping: 14}});

  const steps = [
    {t: 'open File', at: 60},
    {t: 'Export To › PDF…', at: 114},
    {t: 'Save as PDF', at: 174},
  ];

  const clickRing = (p: Wp) => {
    if (!p.click) return null;
    const k = spring({frame: f - p.at + 6, fps: fp, config: {damping: 12}});
    return <div style={{position: 'absolute', left: p.x - 15, top: p.y - 15, width: 30, height: 30, borderRadius: '50%', border: `4px solid ${COLOR.coral}`, transform: `scale(${k})`, opacity: 1 - k}} />;
  };

  return (
    <SceneFade>
      <Decor />
      <div style={{position: 'absolute', left: 100, top: 70}}>
        <Kicker>02 · The cat does the work</Kicker>
        <Headline style={{marginTop: 12, fontSize: 72}}>A spoken goal, done for real.</Headline>
      </div>

      <div style={{position: 'absolute', right: 100, top: 96, width: 360, display: 'flex', flexDirection: 'column', gap: 18}}>
        {steps.map((s, i) => {
          const done = f >= s.at;
          const pop = spring({frame: f - s.at, fps: fp, config: {damping: 14}});
          return (
            <div key={i} style={{display: 'flex', alignItems: 'center', gap: 14, opacity: 0.35 + 0.65 * (done ? 1 : 0.2), transform: done ? `scale(${0.9 + 0.1 * pop})` : 'none'}}>
              <div style={{width: 34, height: 34, borderRadius: '50%', background: done ? COLOR.orange : '#EADFC6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: done ? ON_ACCENT : COLOR.muted, fontFamily: FONT.text, fontWeight: 700, fontSize: 19}}>
                {done ? '✓' : i + 1}
              </div>
              <MonoTag>{s.t}</MonoTag>
            </div>
          );
        })}
      </div>

      <div style={{position: 'absolute', left: WX, top: WY, transform: `scale(${0.9 + 0.1 * win})`, opacity: win}}>
        <Window title="Keynote — Q3 Report" width={1180} height={640}>
          <div style={{display: 'flex', alignItems: 'center', gap: 30, padding: '12px 22px', borderBottom: `1.5px solid ${COLOR.paperDeep}`, fontFamily: FONT.text, fontSize: 24, color: COLOR.muted, position: 'relative'}}>
            {['File', 'Edit', 'Insert', 'Slide', 'Format', 'Arrange', 'Share'].map((m) => (
              <span key={m} style={{fontWeight: m === 'File' && f >= 58 && f < 112 ? 700 : 400, color: m === 'File' && f >= 58 && f < 112 ? INK : COLOR.muted, textDecoration: m === 'File' && f >= 58 && f < 112 ? 'underline' : 'none', textDecorationColor: COLOR.orange, textUnderlineOffset: 8}}>
                {m}
              </span>
            ))}
          </div>

          <div style={{position: 'absolute', left: 120, top: 110, width: 560, height: 420, background: COLOR.paper, borderRadius: 14, border: `1.5px solid ${LINE}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20}}>
            <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 56, color: COLOR.line}}>Q3 Report</div>
            <div style={{fontFamily: FONT.text, fontSize: 24, color: COLOR.muted}}>Quarterly review · slides 1-12</div>
            <div style={{display: 'flex', alignItems: 'flex-end', gap: 14, height: 150, marginTop: 12}}>
              {[64, 92, 70, 118, 84].map((h, i) => (
                <div key={i} style={{width: 56, height: h, borderRadius: 8, background: i === 3 ? COLOR.orange : '#EADFC6'}} />
              ))}
            </div>
          </div>

          {f >= 62 && f < 118 ? (
            <div style={{position: 'absolute', left: 30, top: 108, width: 380, background: SURFACE, borderRadius: 16, border: `1.5px solid ${LINE}`, boxShadow: '0 30px 60px -30px rgba(74,46,38,.4)', padding: '14px 8px', transform: `scale(${menu})`, transformOrigin: '0% 0%', opacity: f < 112 ? 1 : interpolate(f, [112, 118], [1, 0])}}>
              {[
                {t: 'New', sub: ''},
                {t: 'Open…', sub: ''},
                {t: 'Export To', sub: '› PDF…'},
                {t: 'Print…', sub: ''},
                {t: 'Share', sub: ''},
              ].map((item, i) => {
                const hl = i === 2 && f >= 104;
                return (
                  <div key={item.t} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderRadius: 10, background: hl ? COLOR.orange : 'transparent', color: hl ? ON_ACCENT : INK, fontFamily: FONT.text, fontSize: 25, fontWeight: hl ? 700 : 500}}>
                    <span>{item.t}</span>
                    <span style={{color: hl ? ON_ACCENT : COLOR.muted, fontFamily: FONT.text}}>{item.sub}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {f >= 118 && f < 216 ? (
            <div style={{position: 'absolute', left: 320, top: 120, width: 560, background: SURFACE, borderRadius: 20, border: `1.5px solid ${LINE}`, boxShadow: '0 40px 80px -36px rgba(74,46,38,.5)', padding: '26px 30px', transform: `scale(${dialog})`, transformOrigin: '50% 50%'}}>
              <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 34, color: COLOR.line}}>Save as PDF</div>
              <div style={{marginTop: 20, fontFamily: FONT.text, fontSize: 23, color: COLOR.muted}}>Name</div>
              <div style={{marginTop: 8, padding: '14px 18px', borderRadius: 10, border: `1.5px solid ${LINE}`, background: COLOR.paper, fontFamily: FONT.text, fontSize: 26, color: INK}}>Q3 Report.pdf</div>
              <Progress value={progress} style={{marginTop: 22}} />
              <div style={{marginTop: 10, fontFamily: FONT.text, fontSize: 21, color: COLOR.muted}}>{f < 180 ? 'Exporting…' : 'Done'}</div>
              <div style={{display: 'flex', justifyContent: 'flex-end', gap: 14, marginTop: 22}}>
                <Button kind="ghost" style={{fontSize: 24, padding: '11px 26px'}}>Cancel</Button>
                <Button kind="go" style={{fontSize: 24, padding: '11px 26px', transform: `scale(${f >= 170 && f < 190 ? 0.94 : 1})`}}>Export</Button>
              </div>
            </div>
          ) : null}
        </Window>
      </div>

      {wps.map((p, i) => (
        <div key={i} style={{position: 'absolute', left: p.x - 15, top: p.y - 15}}>{clickRing(p)}</div>
      ))}

      <div style={{position: 'absolute', left: pos.x - CAT / 2, top: pos.y - CAT * 0.82, width: CAT, height: CAT, zIndex: 5}}>
        <CatSpot size={CAT} pose={pose}>
          {state === 'acting' ? <LandRing f={f} size={CAT} period={18} /> : null}
          {state === 'done' ? <Sparkles f={f} size={CAT} /> : null}
        </CatSpot>
      </div>

      {f >= 218 ? (
        <div style={{position: 'absolute', left: 100, bottom: 60, transform: `translateY(${(1 - saved) * 30}px)`, opacity: saved, display: 'flex', alignItems: 'center', gap: 20}}>
          <Panel style={{padding: '20px 28px', display: 'flex', alignItems: 'center', gap: 18}}>
            <div style={{width: 52, height: 60, borderRadius: 10, background: COLOR.orange, opacity: 0.9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ON_ACCENT, fontFamily: FONT.display, fontWeight: 800, fontSize: 20}}>PDF</div>
            <div>
              <div style={{fontFamily: FONT.text, fontSize: 28, fontWeight: 700, color: INK}}>Q3 Report.pdf</div>
              <div style={{fontFamily: FONT.text, fontSize: 22, color: COLOR.muted}}>Saved to Downloads</div>
            </div>
            <Check size={40} />
          </Panel>
        </div>
      ) : null}

      {f >= 236 ? (
        <div style={{position: 'absolute', right: 100, bottom: 60, width: 430, transform: `translateY(${(1 - summary) * 30}px)`, opacity: summary}}>
          <Panel style={{padding: '24px 28px'}}>
            <div style={{fontFamily: FONT.text, fontSize: 23, color: COLOR.muted}}>Summary</div>
            <div style={{fontFamily: FONT.text, fontSize: 27, lineHeight: 1.35, color: INK, marginTop: 8}}>I exported your Q3 Report deck as a PDF to Downloads.</div>
          </Panel>
        </div>
      ) : null}
    </SceneFade>
  );
};

/* ------------------------------------------------------------------ */
/* 4. Phone remote + sealed relay                                      */
/* ------------------------------------------------------------------ */

const PhoneRemote: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();

  const phoneIn = spring({frame: f - 8, fps: fp, config: {damping: 15}});
  const macIn = spring({frame: f - 14, fps: fp, config: {damping: 15}});
  const said = spring({frame: f - 30, fps: fp, config: {damping: 14}});
  const send = spring({frame: f - 58, fps: fp, config: {damping: 13, stiffness: 160}});
  const working = spring({frame: f - 120, fps: fp, config: {damping: 14}});
  const progress = interpolate(f, [150, 230], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const done = spring({frame: f - 232, fps: fp, config: {damping: 14}});

  const macState: CatState = f < 96 ? 'idle' : f < 236 ? 'thinking' : 'done';
  const macPose = poseFor(macState, f, fp);

  const packets = [0, 1, 2].map((i) => {
    const t = f - (84 + i * 12);
    if (t < 0 || t > 132) return {x: 20, o: 0};
    return {x: interpolate(t, [0, 132], [20, 820]), o: Math.sin((Math.PI * t) / 132)};
  });

  return (
    <SceneFade>
      <Decor />
      <div style={{position: 'absolute', left: 100, top: 84}}>
        <Kicker>03 · Your phone is the remote</Kicker>
        <Headline style={{marginTop: 14, fontSize: 72}}>Say it on your phone.</Headline>
        <Sub style={{marginTop: 18, maxWidth: 720}}>The goal travels sealed to your Mac. The relay in the middle never sees a plain word.</Sub>
      </div>

      {/* phone */}
      <div style={{position: 'absolute', left: 120, top: 330, transform: `translateY(${(1 - phoneIn) * 50}px)`, opacity: phoneIn}}>
        <div style={{width: 340, height: 620, background: SURFACE, borderRadius: 40, border: `1.5px solid ${LINE}`, boxShadow: '0 40px 90px -40px rgba(74,46,38,.5)', padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 18}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div style={{width: 30, height: 30, borderRadius: '50%', background: COLOR.orange}} />
            <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 30, color: COLOR.line}}>Yumi</div>
            <div style={{flex: 1}} />
            <div style={{fontFamily: FONT.text, fontSize: 20, color: COLOR.muted}}>9:41 am</div>
          </div>
          <div style={{transform: `translateY(${(1 - said) * 24}px)`, opacity: said, background: '#FFFFFF', borderRadius: 18, padding: '16px 18px', fontFamily: FONT.text, fontSize: 23, color: INK, lineHeight: 1.3}}>
            You said: <span style={{fontWeight: 700}}>open my Spotify and play Discover Weekly</span>
          </div>
          {f < 118 ? (
            <div style={{display: 'flex', gap: 12, opacity: said}}>
              <Button kind="go" style={{flex: 1, fontSize: 25, padding: '14px 0', transform: `scale(${0.9 + 0.1 * send})`}}>Send</Button>
              <Button kind="ghost" style={{flex: 1, fontSize: 25, padding: '14px 0'}}>Edit</Button>
            </div>
          ) : null}
          {f >= 118 ? (
            <div style={{transform: `translateY(${(1 - working) * 24}px)`, opacity: working, background: '#FFFFFF', borderRadius: 18, padding: '18px', display: 'flex', flexDirection: 'column', gap: 14}}>
              <div style={{fontFamily: FONT.text, fontSize: 25, fontWeight: 700, color: INK}}>Working on your Mac</div>
              <MonoTag color={COLOR.muted}>{f < 236 ? 'Opening Spotify · step 3 of 5' : 'Done'}</MonoTag>
              <Progress value={progress} />
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                <span style={{fontFamily: FONT.text, fontSize: 20, color: COLOR.muted}}>{Math.round(progress * 100)}%</span>
                {f < 236 ? <Button kind="ghost" style={{fontSize: 22, padding: '8px 24px'}}>Stop</Button> : <Check size={34} />}
              </div>
            </div>
          ) : null}
          {f >= 234 ? (
            <div style={{transform: `translateY(${(1 - done) * 20}px)`, opacity: done, background: '#FFFFFF', borderRadius: 18, padding: '16px 18px', fontFamily: FONT.text, fontSize: 23, color: INK, lineHeight: 1.3}}>
              Playing <span style={{fontWeight: 700}}>Discover Weekly</span> on your Mac.
            </div>
          ) : null}
        </div>
      </div>

      {/* relay */}
      <div style={{position: 'absolute', left: 500, top: 520, width: 840, height: 240}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: 118, height: 4, background: LINE}} />
        {packets.map((p, i) => (
          <div key={i} style={{position: 'absolute', left: p.x, top: 118 - 12, width: 26, height: 26, borderRadius: 7, background: COLOR.line, transform: 'rotate(45deg)', opacity: p.o * 0.9}} />
        ))}
        <div style={{position: 'absolute', left: 380, top: 78, width: 80, height: 80, borderRadius: '50%', background: SURFACE, border: `1.5px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 20px 44px -22px rgba(74,46,38,.5)'}}>
          <Lock size={44} />
        </div>
        <div style={{position: 'absolute', left: 0, top: 152, width: 220, textAlign: 'center'}}>
          <MonoTag color={COLOR.muted}>phone</MonoTag>
        </div>
        <div style={{position: 'absolute', right: 0, top: 152, width: 220, textAlign: 'center'}}>
          <MonoTag color={COLOR.muted}>mac</MonoTag>
        </div>
        <div style={{position: 'absolute', left: 0, right: 0, top: 40, textAlign: 'center'}}>
          <MonoTag color={ACCENT_TEXT}>end-to-end encrypted</MonoTag>
        </div>
      </div>

      {/* mac */}
      <div style={{position: 'absolute', right: 120, top: 330, transform: `translateY(${(1 - macIn) * 50}px)`, opacity: macIn}}>
        <Window title="Spotify" width={420} height={300}>
          <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexDirection: 'column'}}>
            <CatSpot size={190} pose={macPose}>
              {macState === 'thinking' ? <ThinkDots f={f} size={190} /> : null}
              {macState === 'done' ? <Sparkles f={f} size={190} /> : null}
            </CatSpot>
            {macState === 'done' ? (
              <div style={{fontFamily: FONT.text, fontSize: 23, fontWeight: 700, color: INK}}>Discover Weekly · playing</div>
            ) : null}
          </div>
        </Window>
      </div>
    </SceneFade>
  );
};

/* ------------------------------------------------------------------ */
/* 5. Ghost littermates                                               */
/* ------------------------------------------------------------------ */

const Ghosts: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();

  const CATS = [
    {label: 'Main cat', task: 'Export Q3 Report.pdf', app: 'Keynote', palette: undefined, color: COLOR.orange, state: 'acting' as CatState},
    {label: 'Ghost', task: 'Fill the expense form', app: 'Numbers', palette: LITTERMATES.mint, color: LITTERMATES.mint.orange, state: 'moving' as CatState},
    {label: 'Ghost', task: 'Add the chart to the deck', app: 'Keynote', palette: LITTERMATES.sky, color: LITTERMATES.sky.orange, state: 'thinking' as CatState},
  ];

  return (
    <SceneFade>
      <Decor />
      <div style={{position: 'absolute', left: 100, top: 84}}>
        <Kicker>04 · Parallel ghosts</Kicker>
        <Headline style={{marginTop: 14, fontSize: 72}}>One cat, a few littermates.</Headline>
        <Sub style={{marginTop: 18, maxWidth: 800}}>Ghost cursors work other windows at the same time, each in its own color.</Sub>
      </div>

      <div style={{position: 'absolute', left: 100, top: 400, right: 100, display: 'flex', gap: 44, justifyContent: 'center'}}>
        {CATS.map((c, i) => {
          const pop = spring({frame: f - 16 - i * 8, fps: fp, config: {damping: 14}});
          const pose = poseFor(c.state, f + i * 9, fp);
          const prog = i === 0 ? interpolate(f, [40, 180], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : i === 1 ? interpolate(f, [30, 160], [0, 0.85], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : interpolate(f, [30, 200], [0, 0.7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const done = f >= (i === 0 ? 180 : i === 1 ? 160 : 200);
          return (
            <div key={i} style={{width: 540, transform: `translateY(${(1 - pop) * 50}px)`, opacity: pop, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <Window title={c.app} width={540} height={360}>
                <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  <CatSpot size={230} pose={pose}>
                    {c.state === 'acting' ? <LandRing f={f} size={230} period={39} /> : null}
                    {c.state === 'thinking' ? <ThinkDots f={f} size={230} /> : null}
                  </CatSpot>
                </div>
              </Window>
              <div style={{marginTop: 24, display: 'flex', alignItems: 'center', gap: 14}}>
                <div style={{padding: '9px 20px', borderRadius: 999, background: c.color, color: c.palette?.line ?? ON_ACCENT, fontFamily: FONT.text, fontSize: 23, fontWeight: 700}}>{c.label}</div>
                <MonoTag color={COLOR.muted}>{c.task}</MonoTag>
              </div>
              <div style={{width: 540, marginTop: 18, display: 'flex', alignItems: 'center', gap: 16}}>
                <Progress value={prog} color={c.color} style={{flex: 1}} />
                {done ? <Check size={34} /> : <span style={{fontFamily: MONO, fontSize: 22, color: COLOR.muted}}>{Math.round(prog * 100)}%</span>}
              </div>
            </div>
          );
        })}
      </div>
    </SceneFade>
  );
};

/* ------------------------------------------------------------------ */
/* 6. Control & safety                                                */
/* ------------------------------------------------------------------ */

const Control: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();

  const win = spring({frame: f - 6, fps: fp, config: {damping: 15}});
  const pause = spring({frame: f - 44, fps: fp, config: {damping: 14}});
  const resume = spring({frame: f - 78, fps: fp, config: {damping: 13}});
  const approve = spring({frame: f - 120, fps: fp, config: {damping: 14}});
  const ok = spring({frame: f - 160, fps: fp, config: {damping: 14}});

  const state: CatState = f < 44 ? 'acting' : f < 78 ? 'paused' : f < 120 ? 'acting' : f < 160 ? 'waitingForUser' : 'done';
  const pose = poseFor(state, f, fp);

  return (
    <SceneFade>
      <Decor />
      <div style={{position: 'absolute', left: 100, top: 84}}>
        <Kicker>05 · You stay in charge</Kicker>
        <Headline style={{marginTop: 14, fontSize: 72}}>Pause, resume, approve.</Headline>
        <Sub style={{marginTop: 18, maxWidth: 760}}>Grab the mouse or press Control-Option-Escape and every cat freezes. Sends and deletes always stop for your okay.</Sub>
      </div>

      <div style={{position: 'absolute', left: 470, top: 340, transform: `scale(${0.92 + 0.08 * win})`, opacity: win}}>
        <Window title="Mail" width={980} height={420}>
          <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            <CatSpot size={260} pose={pose}>
              {state === 'paused' ? <Zzz f={f} size={260} /> : null}
              {state === 'waitingForUser' ? <Question f={f} size={260} /> : null}
              {state === 'done' ? <Sparkles f={f} size={260} /> : null}
            </CatSpot>
          </div>
        </Window>
      </div>

      {f >= 42 && f < 78 ? (
        <div style={{position: 'absolute', left: 660, top: 300, width: 600, transform: `scale(${pause})`, transformOrigin: '50% 50%'}}>
          <Panel radius={28} style={{padding: '30px 36px', background: COLOR.hush, border: 'none'}}>
            <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 40, color: ON_HUSH}}>Paused</div>
            <div style={{fontFamily: FONT.text, fontSize: 25, color: ON_HUSH, opacity: 0.8, marginTop: 6}}>Every cat is holding still.</div>
            <div style={{display: 'flex', gap: 14, marginTop: 22}}>
              <Button kind="go" style={{fontSize: 25, padding: '12px 30px', transform: `scale(${0.9 + 0.1 * resume})`}}>Resume</Button>
              <Button kind="ghost" style={{fontSize: 25, padding: '12px 30px', background: 'rgba(255,255,255,.4)', border: 'none'}}>Cancel</Button>
            </div>
          </Panel>
        </div>
      ) : null}

      {f >= 118 && f < 160 ? (
        <div style={{position: 'absolute', left: 620, top: 330, width: 680, transform: `scale(${approve})`, transformOrigin: '50% 50%'}}>
          <Panel radius={28} style={{padding: '30px 36px'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
              <Lock size={40} />
              <div style={{fontFamily: FONT.text, fontSize: 26, fontWeight: 700, color: INK}}>Yumi wants to send this email</div>
            </div>
            <div style={{fontFamily: FONT.text, fontSize: 24, color: COLOR.muted, marginTop: 12}}>To: jordan@example.com · Re: Q3 numbers</div>
            <div style={{display: 'flex', gap: 14, marginTop: 22}}>
              <Button kind="go" style={{fontSize: 25, padding: '12px 30px', transform: `scale(${0.9 + 0.1 * ok})`}}>Approve</Button>
              <Button kind="ghost" style={{fontSize: 25, padding: '12px 30px'}}>Not now</Button>
            </div>
          </Panel>
        </div>
      ) : null}

      {f >= 160 ? (
        <div style={{position: 'absolute', left: 660, top: 320, display: 'flex', alignItems: 'center', gap: 18, opacity: ok}}>
          <Check size={56} />
          <div style={{fontFamily: FONT.text, fontSize: 30, fontWeight: 700, color: INK}}>Approved and sent.</div>
        </div>
      ) : null}
    </SceneFade>
  );
};

/* ------------------------------------------------------------------ */
/* 7. List into a note                                                */
/* ------------------------------------------------------------------ */

const ListToNote: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();

  const user = spring({frame: f - 10, fps: fp, config: {damping: 14}});
  const offer = spring({frame: f - 40, fps: fp, config: {damping: 14}});
  const yes = spring({frame: f - 76, fps: fp, config: {damping: 13, stiffness: 160}});
  const notesIn = spring({frame: f - 96, fps: fp, config: {damping: 15}});
  const done = spring({frame: f - 176, fps: fp, config: {damping: 14}});

  const FILES = ['Q3 Report.pdf', 'budget.xlsx', 'holiday-photo.jpg', 'demo-script.md', 'yumi-keynote.key'];
  const typing = interpolate(f, [112, 176], [0, FILES.length], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});

  const catState: CatState = f < 40 ? 'listening' : f < 90 ? 'waitingForUser' : f < 176 ? 'acting' : 'done';
  const pose = poseFor(catState, f, fp);

  return (
    <SceneFade>
      <Decor />
      <div style={{position: 'absolute', left: 100, top: 84}}>
        <Kicker>06 · From folder to note</Kicker>
        <Headline style={{marginTop: 14, fontSize: 72}}>Ask, and it is written down.</Headline>
      </div>

      <div style={{position: 'absolute', left: 100, top: 330, width: 720, display: 'flex', flexDirection: 'column', gap: 28}}>
        <div style={{alignSelf: 'flex-start', transform: `translateY(${(1 - user) * 30}px)`, opacity: user}}>
          <div style={{background: '#FFFFFF', borderRadius: 26, borderBottomLeftRadius: 8, padding: '18px 26px', boxShadow: '0 18px 44px -20px rgba(74,46,38,.35)', fontFamily: FONT.text, fontSize: 29, color: INK}}>
            List the files in my Downloads folder.
          </div>
        </div>
        <div style={{alignSelf: 'flex-end', transform: `translateY(${(1 - offer) * 30}px)`, opacity: offer}}>
          <div style={{background: '#FFFFFF', borderRadius: 26, borderBottomRightRadius: 8, padding: '20px 26px', boxShadow: '0 18px 44px -20px rgba(74,46,38,.35)', fontFamily: FONT.text, fontSize: 27, color: INK, lineHeight: 1.3, maxWidth: 620}}>
            Want it in a note too?
            <div style={{display: 'flex', gap: 14, marginTop: 16}}>
              <Button kind="go" style={{fontSize: 24, padding: '11px 26px', transform: `scale(${0.9 + 0.1 * yes})`}}>Yes</Button>
              <Button kind="ghost" style={{fontSize: 24, padding: '11px 26px'}}>Just list them</Button>
            </div>
          </div>
        </div>
      </div>

      <div style={{position: 'absolute', right: 120, top: 330, transform: `translateY(${(1 - notesIn) * 50}px)`, opacity: notesIn}}>
        <Window title="Notes" width={640} height={580}>
          <div style={{padding: '28px 34px'}}>
            <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 38, color: COLOR.line}}>Downloads</div>
            <div style={{fontFamily: FONT.text, fontSize: 22, color: COLOR.muted, marginTop: 4}}>Fri · 10:12 am</div>
            <div style={{marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14}}>
              {FILES.map((file, i) => {
                const visible = typing > i;
                const t = visible ? 1 : 0;
                return (
                  <div key={file} style={{display: 'flex', alignItems: 'center', gap: 14, opacity: t, transform: `translateY(${(1 - t) * 10}px)`}}>
                    <span style={{width: 10, height: 10, borderRadius: '50%', background: COLOR.orange, flex: 'none'}} />
                    <span style={{fontFamily: MONO, fontSize: 24, color: INK}}>{file}</span>
                  </div>
                );
              })}
              {f >= 112 && f < 178 ? <span style={{fontFamily: MONO, fontSize: 24, color: COLOR.orange, opacity: wave(f, 14) > 0 ? 1 : 0}}>▍</span> : null}
            </div>
          </div>
        </Window>
      </div>

      <div style={{position: 'absolute', left: 100, bottom: 60, display: 'flex', alignItems: 'center', gap: 18, opacity: done, transform: `translateY(${(1 - done) * 20}px)`}}>
        <div style={{position: 'relative', width: 130, height: 130}}>
          <CatSpot size={130} pose={pose}>
            {catState === 'waitingForUser' ? <Question f={f} size={130} /> : null}
            {catState === 'done' ? <Sparkles f={f} size={130} /> : null}
          </CatSpot>
        </div>
        <Panel style={{padding: '18px 26px'}}>
          <div style={{fontFamily: FONT.text, fontSize: 27, color: INK}}>I put the full list in a new note called <span style={{fontWeight: 700}}>Downloads</span>.</div>
        </Panel>
      </div>
    </SceneFade>
  );
};

/* ------------------------------------------------------------------ */
/* 8. Close                                                           */
/* ------------------------------------------------------------------ */

const Close: React.FC = () => {
  const f = useCurrentFrame();
  const {fps: fp} = useVideoConfig();

  const head = spring({frame: f - 8, fps: fp, config: {damping: 15}});
  const pills = ['Qwen3.5-9B plans on your Mac', 'Whisper · speech on device', 'Kokoro · Yumi voice', 'Sealed relay · no plaintext'].map((p, i) => ({
    t: p,
    at: 40 + i * 16,
  }));
  const endIn = interpolate(f, [126, 150], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const cat = poseFor('done', f, fp);

  return (
    <SceneFade inFrames={16} outFrames={20}>
      <Decor />
      <div style={{position: 'absolute', left: 100, top: 120, transform: `translateY(${(1 - head) * 30}px)`, opacity: head}}>
        <Kicker>Everything local</Kicker>
        <Headline style={{marginTop: 14}}>Everything runs on your devices.</Headline>
      </div>

      <div style={{position: 'absolute', left: 100, top: 420, right: 100, display: 'flex', flexWrap: 'wrap', gap: 20, opacity: interpolate(f, [126, 146], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        {pills.map((p, i) => {
          const pop = spring({frame: f - p.at, fps: fp, config: {damping: 14}});
          return (
            <div key={i} style={{transform: `translateY(${(1 - pop) * 30}px)`, opacity: pop}}>
              <Chip dot={COLOR.orange}>{p.t}</Chip>
            </div>
          );
        })}
      </div>

      <div style={{position: 'absolute', left: 100, right: 100, top: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, opacity: interpolate(f, [126, 146], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        <div style={{fontFamily: MONO, fontSize: 24, color: COLOR.muted}}>mac</div>
        <div style={{flex: 1, height: 4, background: LINE, margin: '0 24px'}} />
        <div style={{width: 84, height: 84, borderRadius: '50%', background: SURFACE, border: `1.5px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 20px 44px -22px rgba(74,46,38,.5)'}}>
          <Lock size={46} />
        </div>
        <div style={{flex: 1, height: 4, background: LINE, margin: '0 24px'}} />
        <div style={{fontFamily: MONO, fontSize: 24, color: COLOR.muted}}>phone</div>
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, top: 250, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: endIn}}>
        <div style={{width: 240, height: 240}}>
          <CatSpot size={240} pose={cat}>
            <Sparkles f={f} size={240} />
          </CatSpot>
        </div>
        <Wordmark size={220} start={140} style={{marginTop: 6}} />
        <div style={{fontFamily: FONT.text, fontSize: 38, fontWeight: 600, color: COLOR.muted, marginTop: 14, transform: `translateY(${(1 - endIn) * 20}px)`}}>
          Say it once. Watch the cat do it.
        </div>
        <div style={{fontFamily: FONT.text, fontSize: 24, color: COLOR.muted, marginTop: 18, transform: `translateY(${(1 - endIn) * 20}px)`}}>
          Built for a local-AI hackathon
        </div>
      </div>
    </SceneFade>
  );
};
