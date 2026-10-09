import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {YumiCat} from '../cat/YumiCat';
import type {Pose} from '../cat/poses';
import {Shadow} from './Extras';
import {COLOR, FONT} from '../theme';

/** Shared building blocks for the showreel, all on the Yumi design system (character/design/tokens.json). */

export const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace';
export const SURFACE = '#FFFDF6';
export const LINE = '#E7DCC4';
export const INK = '#3A2620';
export const ACCENT_TEXT = '#9A4F17';
export const ON_ACCENT = '#3A2018';
export const ON_HUSH = '#2A2440';

/** Fade a Series.Sequence's content in and out over the steady paper backdrop, so cuts read as a wipe, never a black flash. */
export const SceneFade: React.FC<{children: React.ReactNode; inFrames?: number; outFrames?: number}> = ({
  children,
  inFrames = 14,
  outFrames = 14,
}) => {
  const f = useCurrentFrame();
  const {durationInFrames: D} = useVideoConfig();
  const op = Math.min(
    interpolate(f, [0, inFrames], [0, 1], {extrapolateRight: 'clamp'}),
    interpolate(f, [D - outFrames, D], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
  );
  return <AbsoluteFill style={{opacity: op}}>{children}</AbsoluteFill>;
};

/** Soft paper halos in the corners for depth. */
export const Decor: React.FC = () => (
  <>
    <div
      style={{
        position: 'absolute',
        width: 940,
        height: 940,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(243,235,211,0.9), rgba(243,235,211,0) 70%)',
        top: -340,
        right: -240,
      }}
    />
    <div
      style={{
        position: 'absolute',
        width: 760,
        height: 760,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(243,235,211,0.85), rgba(243,235,211,0) 70%)',
        bottom: -300,
        left: -200,
      }}
    />
  </>
);

export const Kicker: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: '0.2em', color: ACCENT_TEXT, textTransform: 'uppercase', ...style}}>
    {children}
  </div>
);

export const Headline: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{fontFamily: FONT.display, fontWeight: 800, fontSize: 88, lineHeight: 1.0, letterSpacing: '-0.035em', color: COLOR.line, ...style}}>
    {children}
  </div>
);

export const Sub: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{fontFamily: FONT.text, fontSize: 32, lineHeight: 1.35, color: COLOR.muted, ...style}}>{children}</div>
);

export const Panel: React.FC<{children: React.ReactNode; style?: React.CSSProperties; radius?: number}> = ({
  children,
  style,
  radius = 24,
}) => (
  <div
    style={{
      background: SURFACE,
      border: `1.5px solid ${LINE}`,
      borderRadius: radius,
      boxShadow: '0 30px 70px -38px rgba(74,46,38,.38)',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Button: React.FC<{children: React.ReactNode; kind?: 'go' | 'hush' | 'ghost'; style?: React.CSSProperties}> = ({
  children,
  kind = 'go',
  style,
}) => {
  const bg = kind === 'go' ? COLOR.orange : kind === 'hush' ? COLOR.hush : SURFACE;
  const fg = kind === 'go' ? ON_ACCENT : kind === 'hush' ? ON_HUSH : COLOR.ink;
  const border = kind === 'ghost' ? `1.5px solid ${LINE}` : 'none';
  const glow =
    kind === 'go'
      ? '0 14px 30px -16px rgba(240,167,106,1)'
      : kind === 'hush'
        ? '0 14px 30px -16px rgba(183,168,232,1)'
        : undefined;
  return (
    <div
      style={{
        fontFamily: FONT.text,
        fontWeight: 600,
        fontSize: 28,
        padding: '15px 34px',
        borderRadius: 999,
        background: bg,
        color: fg,
        border,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        boxShadow: glow,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Chip: React.FC<{children: React.ReactNode; dot?: string; style?: React.CSSProperties}> = ({children, dot, style}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 24px',
      borderRadius: 999,
      background: SURFACE,
      border: `1.5px solid ${LINE}`,
      fontFamily: FONT.text,
      fontSize: 26,
      fontWeight: 600,
      color: COLOR.ink,
      ...style,
    }}
  >
    {dot ? <span style={{width: 16, height: 16, borderRadius: '50%', background: dot, flex: 'none'}} /> : null}
    {children}
  </div>
);

export const Progress: React.FC<{value: number; color?: string; height?: number; style?: React.CSSProperties}> = ({
  value,
  color = COLOR.orange,
  height = 12,
  style,
}) => (
  <div style={{height, borderRadius: 999, background: '#F1E7D2', overflow: 'hidden', ...style}}>
    <div style={{width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, height: '100%', background: color, borderRadius: 999}} />
  </div>
);

export const MonoTag: React.FC<{children: React.ReactNode; color?: string; style?: React.CSSProperties}> = ({children, color = COLOR.line, style}) => (
  <div style={{fontFamily: MONO, fontSize: 22, fontWeight: 600, letterSpacing: '0.02em', color, ...style}}>{children}</div>
);

/** A cat with its ground shadow and optional marks, in a `size` x `size` box. */
export const CatSpot: React.FC<{size: number; pose: Pose; children?: React.ReactNode; style?: React.CSSProperties}> = ({
  size,
  pose,
  children,
  style,
}) => (
  <div style={{position: 'relative', width: size, height: size, ...style}}>
    <Shadow size={size} lift={pose.y ?? 0} />
    <YumiCat size={size} {...pose} />
    {children}
  </div>
);

/** A macOS-shaped app window with the on-brand (never red) window dots. */
export const Window: React.FC<{
  title: string;
  width: number;
  height: number;
  children: React.ReactNode;
  bar?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({title, width, height, children, bar, style}) => (
  <div
    style={{
      position: 'relative',
      width,
      height,
      background: SURFACE,
      borderRadius: 18,
      border: `1.5px solid ${LINE}`,
      boxShadow: '0 46px 100px -44px rgba(74,46,38,.45)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        height: 50,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 18px',
        borderBottom: `1.5px solid ${LINE}`,
        background: '#FFFDF6',
      }}
    >
      <span style={{width: 15, height: 15, borderRadius: '50%', background: '#6E413E'}} />
      <span style={{width: 15, height: 15, borderRadius: '50%', background: '#D8C7A6'}} />
      <span style={{width: 15, height: 15, borderRadius: '50%', background: '#E7DCC4'}} />
      <div style={{flex: 1, textAlign: 'center', fontFamily: FONT.text, fontSize: 22, fontWeight: 600, color: COLOR.muted}}>{title}</div>
    </div>
    {bar}
    <div style={{flex: 1, position: 'relative', minHeight: 0}}>{children}</div>
  </div>
);

export const Lock: React.FC<{size: number; color?: string; style?: React.CSSProperties}> = ({size, color = COLOR.line, style}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" style={style}>
    <path d="M20 26V20a12 12 0 0 1 24 0v6" fill="none" stroke={color} strokeWidth={5.5} strokeLinecap="round" />
    <rect x="12" y="26" width="40" height="28" rx="9" fill={color} />
    <circle cx="32" cy="39" r="4.5" fill={SURFACE} />
    <path d="M32 42.5v5.5" stroke={SURFACE} strokeWidth={3.2} strokeLinecap="round" />
  </svg>
);

export const Check: React.FC<{size: number; style?: React.CSSProperties}> = ({size, style}) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={style}>
    <circle cx="16" cy="16" r="15" fill={COLOR.orange} />
    <path d="M9 16.5l5 5 9-10" fill="none" stroke={ON_ACCENT} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
