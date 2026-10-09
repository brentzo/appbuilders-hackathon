import React from 'react';
import {COLOR, FONT} from '../theme';
import {wave} from '../cat/poses';

/** Small marks that sit around the cat to make a state readable. Positions are relative to a cat of `size` px. */
type P = {f: number; size: number};

export const SoundArcs: React.FC<P> = ({f, size}) => (
  <svg width={size * 0.3} height={size * 0.4} viewBox="0 0 60 80" style={{position: 'absolute', left: size * 0.86, top: size * 0.2, overflow: 'visible'}}>
    {[0, 1, 2].map((i) => {
      const t = ((f / 24 + i / 3) % 1);
      return (
        <path
          key={i}
          d={`M${8 + i * 16} ${40 - 12 - i * 9}Q${18 + i * 22} 40 ${8 + i * 16} ${40 + 12 + i * 9}`}
          fill="none"
          stroke={COLOR.orange}
          strokeWidth={7}
          strokeLinecap="round"
          opacity={Math.sin(Math.PI * t)}
        />
      );
    })}
  </svg>
);

export const ThinkDots: React.FC<P> = ({f, size}) => (
  <div style={{position: 'absolute', left: size * 0.8, top: size * 0.02, display: 'flex', gap: size * 0.03}}>
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        style={{
          width: size * 0.06,
          height: size * 0.06,
          borderRadius: '50%',
          background: COLOR.line,
          transform: `translateY(${-size * 0.04 * Math.max(0, wave(f - i * 4, 24))}px)`,
          opacity: 0.45 + 0.55 * Math.max(0, wave(f - i * 4, 24)),
        }}
      />
    ))}
  </div>
);

export const Zzz: React.FC<P> = ({f, size}) => (
  <div style={{position: 'absolute', left: size * 0.78, top: size * 0.0, fontFamily: FONT.display, fontWeight: 800, color: COLOR.hush}}>
    {[0, 1, 2].map((i) => {
      const t = ((f / 60 + i / 3) % 1);
      return (
        <span
          key={i}
          style={{
            position: 'absolute',
            fontSize: size * (0.09 + i * 0.03),
            transform: `translate(${size * 0.12 * t}px, ${-size * 0.18 * t}px)`,
            opacity: Math.sin(Math.PI * t),
          }}
        >
          z
        </span>
      );
    })}
  </div>
);

export const Question: React.FC<P> = ({f, size}) => (
  <div
    style={{
      position: 'absolute',
      left: size * 0.84,
      top: size * 0.02,
      fontFamily: FONT.display,
      fontWeight: 800,
      fontSize: size * 0.2,
      color: COLOR.hush,
      transform: `rotate(${10 * wave(f, 30)}deg)`,
    }}
  >
    ?
  </div>
);

export const Sparkles: React.FC<P> = ({f, size}) => (
  <>
    {[
      [0.86, 0.06, 0.1, 0],
      [0.06, 0.22, 0.07, 10],
      [0.92, 0.42, 0.06, 20],
    ].map(([x, y, s, ph], i) => {
      const k = 0.55 + 0.45 * wave(f + ph, 40);
      return (
        <svg key={i} viewBox="0 0 20 20" width={size * s} height={size * s} style={{position: 'absolute', left: size * x, top: size * y, transform: `scale(${k}) rotate(${20 * k}deg)`}}>
          <path d="M10 0l2.4 7.6L20 10l-7.6 2.4L10 20l-2.4-7.6L0 10l7.6-2.4z" fill={COLOR.orange} />
        </svg>
      );
    })}
  </>
);

export const LandRing: React.FC<P & {period: number}> = ({f, size, period}) => {
  const t = (f % period) / period;
  const k = t > 0.5 && t < 0.8 ? (t - 0.5) / 0.3 : -1;
  if (k < 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: size * 0.5 - size * 0.32 * (0.6 + k),
        top: size * 0.93 - size * 0.05 * (0.6 + k),
        width: size * 0.64 * (0.6 + k),
        height: size * 0.1 * (0.6 + k),
        borderRadius: '50%',
        border: `${size * 0.012}px solid ${COLOR.orange}`,
        opacity: 1 - k,
      }}
    />
  );
};

export const Shadow: React.FC<{size: number; lift?: number}> = ({size, lift = 0}) => {
  const k = Math.max(0.55, 1 - lift / 300);
  return (
    <div
      style={{
        position: 'absolute',
        left: size * 0.5 - size * 0.3 * k,
        top: size * 0.92,
        width: size * 0.6 * k,
        height: size * 0.07 * k,
        borderRadius: '50%',
        background: COLOR.line,
        opacity: 0.12 * k,
      }}
    />
  );
};
