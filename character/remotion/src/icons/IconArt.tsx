import React from 'react';
import {YumiCat, paddedViewBox} from '../cat/YumiCat';
import {CAT} from '../cat/catParts';
import {LittermateName, littermatePalettes} from '../cat/palettes';

/** Every logo and app-icon variant. All are drawn on a 1024 x 1024 canvas. */
export type IconKind =
  | 'mark'
  | 'markMono'
  | 'markWhite'
  | `mark-${LittermateName}`
  | 'macos'
  | 'menubar'
  | 'androidForeground'
  | 'androidBackground'
  | 'androidLegacy'
  | 'androidRound'
  | 'playStore';

const PAPER_TOP = '#FFF8E9';
const PAPER_BOTTOM = '#F6DFBC';
const HALO = '#F3E2C2';

const Cat: React.FC<{size: number; cx: number; cy: number}> = ({size, cx, cy}) => (
  <g transform={`translate(${cx - size / 2} ${cy - size / 2})`}>
    <YumiCat size={size} />
  </g>
);

const Paper: React.FC<{id: string}> = ({id}) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stopColor={PAPER_TOP} />
    <stop offset="1" stopColor={PAPER_BOTTOM} />
  </linearGradient>
);

const LITTERMATES = littermatePalettes();

/** One-color silhouette with the eyes cut out. Black for the macOS menu bar (macOS tints template images itself). */
const Silhouette: React.FC<{size: number; color?: string; id?: string}> = ({size, color = '#000', id = 'yumi-menubar-eyes'}) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox={paddedViewBox(0.04)} width={size} height={size}>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="1100" height="1100">
        <rect width="1100" height="1100" fill="#fff" />
        {CAT.eyes.map((e, i) => (
          <ellipse key={i} cx={e.cx} cy={e.cy} rx={e.rx * 1.5} ry={e.ry * 1.35} fill="#000" />
        ))}
      </mask>
    </defs>
    <g mask={`url(#${id})`} fill={color} stroke={color} strokeWidth={CAT.outline} strokeLinejoin="round">
      <path d={CAT.earLeft.d} />
      <path d={CAT.earRight.d} />
      <path d={CAT.body} />
      <path d={CAT.tail} />
    </g>
  </svg>
);

export const IconArt: React.FC<{kind: IconKind; size: number}> = ({kind, size}) => {
  if (kind === 'mark') return <YumiCat size={size} pad={0.06} />;
  if (kind === 'menubar') return <Silhouette size={size} />;
  if (kind === 'markMono') return <Silhouette size={size} color={CAT.palette.line} id="yumi-mono-eyes" />;
  if (kind === 'markWhite') return <Silhouette size={size} color="#FFFFFF" id="yumi-white-eyes" />;
  if (kind.startsWith('mark-')) return <YumiCat size={size} pad={0.06} palette={LITTERMATES[kind.slice(5) as LittermateName]} />;
  const frame = (children: React.ReactNode) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width={size} height={size}>
      {children}
    </svg>
  );
  switch (kind) {
    case 'macos':
      // Apple's macOS icon grid: an 824 px rounded body centered on the 1024 canvas, with a soft shadow.
      return frame(
        <>
          <defs>
            <Paper id="yumi-mac-paper" />
            <filter id="yumi-mac-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#3A2018" floodOpacity="0.28" />
            </filter>
          </defs>
          <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#yumi-mac-paper)" filter="url(#yumi-mac-shadow)" />
          <circle cx="512" cy="540" r="300" fill={HALO} />
          <Cat size={640} cx={512} cy={520} />
        </>,
      );
    case 'androidForeground':
      // Adaptive icon foreground: 108 dp canvas, the cat inside the 66 dp safe zone.
      return frame(<Cat size={600} cx={512} cy={522} />);
    case 'androidBackground':
      return frame(
        <>
          <defs>
            <Paper id="yumi-and-bg" />
          </defs>
          <rect width="1024" height="1024" fill="url(#yumi-and-bg)" />
          <circle cx="512" cy="530" r="330" fill={HALO} />
        </>,
      );
    case 'androidLegacy':
    case 'androidRound': {
      const round = kind === 'androidRound';
      return frame(
        <>
          <defs>
            <Paper id={`yumi-${kind}`} />
          </defs>
          {round ? (
            <circle cx="512" cy="512" r="448" fill={`url(#yumi-${kind})`} />
          ) : (
            <rect x="64" y="64" width="896" height="896" rx="190" fill={`url(#yumi-${kind})`} />
          )}
          <circle cx="512" cy="540" r="310" fill={HALO} />
          <Cat size={660} cx={512} cy={520} />
        </>,
      );
    }
    case 'playStore':
      // Google Play applies its own mask, so this one is full bleed.
      return frame(
        <>
          <defs>
            <Paper id="yumi-play" />
          </defs>
          <rect width="1024" height="1024" fill="url(#yumi-play)" />
          <circle cx="512" cy="540" r="340" fill={HALO} />
          <Cat size={720} cx={512} cy={520} />
        </>,
      );
  }
};
