import React, {useId} from 'react';
import {CAT} from './catParts';
import type {Pose} from './poses';

export type Palette = {orange: string; cream: string; line: string; blush: string};

export type YumiCatProps = Pose & {
  size: number;
  /** Empty margin around the cat, as a fraction of its width, so tilts and perked ears never touch the edge. */
  pad?: number;
  palette?: Partial<Palette>;
  style?: React.CSSProperties;
};

const [CX, GY] = [CAT.centerX, CAT.groundY];

/** The art's viewBox grown by `pad` (a fraction of its width) on every side. */
export const paddedViewBox = (pad: number) => {
  const [x, y, w] = CAT.viewBox.split(' ').map(Number);
  const m = w * pad;
  return `${x - m} ${y - m} ${w + 2 * m} ${w + 2 * m}`;
};

const Eye: React.FC<{
  e: (typeof CAT.eyes)[number];
  blink: number;
  shape: NonNullable<Pose['eyes']>;
  color: string;
}> = ({e, blink, shape, color}) => {
  if (shape === 'happy' || shape === 'closed') {
    // happy: ^ arcs; closed: soft downward curves for sleeping
    const up = shape === 'happy';
    const y = up ? e.cy + e.ry * 0.35 : e.cy;
    const ctrl = up ? e.cy - e.ry * 0.95 : e.cy + e.ry * 0.85;
    return (
      <path
        d={`M${e.cx - e.rx * 1.15} ${y}Q${e.cx} ${ctrl} ${e.cx + e.rx * 1.15} ${y}`}
        fill="none"
        stroke={color}
        strokeWidth={CAT.inner}
        strokeLinecap="round"
      />
    );
  }
  const k = shape === 'wide' ? 1.22 : 1;
  const ry = Math.max(1.5, e.ry * k * (1 - 0.92 * blink));
  return (
    <g>
      <ellipse cx={e.cx} cy={e.cy} rx={e.rx * k} ry={ry} fill={color} />
      {shape === 'wide' && blink < 0.5 ? (
        <circle cx={e.cx + e.rx * 0.35} cy={e.cy - e.ry * 0.45} r={e.rx * 0.32} fill="#FFFFFF" opacity={0.9} />
      ) : null}
    </g>
  );
};

/**
 * The Yumi cat, built from the layered master art (character/art/yumi-cat.svg).
 * Every prop is a plain number or enum, so any Remotion animation can drive it.
 */
export const YumiCat: React.FC<YumiCatProps> = ({
  size,
  pad = 0,
  palette,
  style,
  earLeft = 0,
  earRight = 0,
  tail = 0,
  blink = 0,
  eyes = 'open',
  lookX = 0,
  lookY = 0,
  mouthOpen = 0,
  blush = 1,
  squashX = 1,
  squashY = 1,
  x = 0,
  y = 0,
  tilt = 0,
  whiskers = 0,
}) => {
  const p: Palette = {...CAT.palette, ...palette};
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clip = `yumi-body-${id}`;
  const L = CAT.outline;
  // The tail lies on the floor and wraps around the front paws, so it only flicks a few degrees.
  const tailDeg = Math.max(-4, Math.min(4, tail * 0.3));
  const body =
    `translate(${x} ${-y}) rotate(${tilt} ${CX} ${GY}) ` +
    `translate(${CX} ${GY}) scale(${squashX} ${squashY}) translate(${-CX} ${-GY})`;
  const lineProps = {fill: 'none', stroke: p.line, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};

  return (
    <svg viewBox={paddedViewBox(pad)} width={size} height={size} style={{overflow: 'visible', ...style}}>
      <defs>
        <clipPath id={clip}>
          <path d={CAT.body} />
        </clipPath>
      </defs>
      <g transform={body}>
        <g transform={`rotate(${earLeft} ${CAT.earLeft.pivot[0]} ${CAT.earLeft.pivot[1]})`}>
          <path d={CAT.earLeft.d} fill={p[CAT.earLeft.fill]} stroke={p.line} strokeWidth={L} strokeLinejoin="round" />
          <path d={CAT.earLeft.line} {...lineProps} strokeWidth={CAT.inner} />
        </g>
        <g transform={`rotate(${earRight} ${CAT.earRight.pivot[0]} ${CAT.earRight.pivot[1]})`}>
          <path d={CAT.earRight.d} fill={p[CAT.earRight.fill]} stroke={p.line} strokeWidth={L} strokeLinejoin="round" />
          <path d={CAT.earRight.line} {...lineProps} strokeWidth={CAT.inner} />
        </g>

        <path d={CAT.body} fill={p.orange} />
        <g clipPath={`url(#${clip})`} fill={p.cream}>
          {CAT.stripes.map((s, i) => (
            <rect key={i} x={s.x} y={230} width={s.w} height={s.bottom - 230} rx={s.w / 2} />
          ))}
          <circle cx={CAT.patch.cx} cy={CAT.patch.cy} r={CAT.patch.r} />
          <path d={CAT.bib} />
          <path d={CAT.pawLeft} />
          <path d={CAT.pawRight} />
        </g>
        <path d={CAT.body} fill="none" stroke={p.line} strokeWidth={L} strokeLinejoin="round" />
        <g {...lineProps} strokeWidth={CAT.inner}>
          {CAT.legs.map((d, i) => (
            <path key={i} d={d} />
          ))}
          {CAT.toes.map((d, i) => (
            <path key={i} d={d} strokeWidth={11} />
          ))}
        </g>

        <g transform={`rotate(${tailDeg} ${CAT.tailPivot[0]} ${CAT.tailPivot[1]})`}>
          <path d={CAT.tail} fill={p.orange} stroke={p.line} strokeWidth={L} strokeLinejoin="round" />
        </g>

        <g>
          {CAT.blush.map((b, i) => (
            <ellipse
              key={i}
              cx={b.cx}
              cy={b.cy}
              rx={b.rx}
              ry={b.ry}
              transform={`rotate(${b.rot} ${b.cx} ${b.cy})`}
              fill={p.blush}
              opacity={Math.min(1, blush)}
            />
          ))}
          <g transform={`translate(${lookX} ${lookY})`}>
            {CAT.eyes.map((e, i) => (
              <Eye key={i} e={e} blink={blink} shape={eyes} color={p.line} />
            ))}
          </g>
          {mouthOpen > 0.02 ? (
            <g>
              <ellipse cx={474} cy={541} rx={11 * mouthOpen + 3} ry={13 * mouthOpen + 2} fill={p.line} />
              <ellipse cx={474} cy={547 + 2 * mouthOpen} rx={7 * mouthOpen} ry={5 * mouthOpen} fill={p.blush} />
            </g>
          ) : null}
          <path d={CAT.mouth} {...lineProps} strokeWidth={CAT.inner} />
          <g {...lineProps} strokeWidth={CAT.inner}>
            {CAT.whiskers.map((d, i) => {
              const left = i < 2;
              const pivot = left ? '322 565' : '628 565';
              return <path key={i} d={d} transform={`rotate(${left ? -whiskers : whiskers} ${pivot})`} />;
            })}
          </g>
        </g>
      </g>
    </svg>
  );
};
