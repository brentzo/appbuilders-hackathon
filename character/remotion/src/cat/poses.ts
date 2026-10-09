import {Easing, interpolate} from 'remotion';

/** Everything the cat can do. All angles are degrees, all offsets are art units (the art is 704 units wide). */
export type Pose = {
  /** Positive tips the left ear upright (perk); negative relaxes it outward. */
  earLeft?: number;
  /** Negative tips the right ear upright (perk); positive relaxes it outward. */
  earRight?: number;
  /** Negative lifts the tail, positive drops it. */
  tail?: number;
  /** 0 = eyes open, 1 = shut. */
  blink?: number;
  eyes?: 'open' | 'wide' | 'happy' | 'closed';
  lookX?: number;
  lookY?: number;
  /** 0..1, a small open mouth under the :3 for talking or surprise. */
  mouthOpen?: number;
  /** Blush opacity, 0..1. */
  blush?: number;
  squashX?: number;
  squashY?: number;
  x?: number;
  /** Positive moves the cat up (jumps). */
  y?: number;
  /** Whole-cat tilt around the feet. */
  tilt?: number;
  /** Whisker twitch angle. */
  whiskers?: number;
};

/** The cursor states from SPEC-04, named exactly like the protocol's CursorState values. */
export type CatState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'moving'
  | 'acting'
  | 'waitingForUser'
  | 'paused'
  | 'done'
  | 'stuck';

const TAU = Math.PI * 2;
export const wave = (f: number, period: number, phase = 0) => Math.sin(TAU * (f / period) + phase);
const pos = (f: number, period: number) => ((f % period) + period) % period;

/** A quick blink: shut and open again over `len` frames, starting every `every` frames. */
export const blinkEvery = (f: number, every: number, offset = 0, len = 7) => {
  const t = (pos(f - offset, every)) / len;
  return t >= 1 ? 0 : 1 - Math.abs(2 * t - 1);
};

const breathe = (f: number, period: number, amount = 0.012): Pose => {
  const b = wave(f, period);
  return {squashY: 1 + amount * b, squashX: 1 - amount * 0.6 * b};
};

/** A jump cycle used by pounce and the happy hop. */
const hop = (f: number, period: number, height: number): Pose => {
  const t = pos(f, period) / period;
  if (t < 0.18) {
    const k = Easing.out(Easing.quad)(t / 0.18);
    return {squashY: 1 - 0.13 * k, squashX: 1 + 0.09 * k, y: 0};
  }
  if (t < 0.52) {
    const k = (t - 0.18) / 0.34;
    const arc = Math.sin(Math.PI * k);
    return {y: height * arc, squashY: 1 + 0.07 * arc, squashX: 1 - 0.05 * arc};
  }
  if (t < 0.64) {
    const k = Math.sin(Math.PI * ((t - 0.52) / 0.12));
    return {squashY: 1 - 0.12 * k, squashX: 1 + 0.09 * k, y: 0};
  }
  return {y: 0};
};

/**
 * The motion for a cursor state at frame `f`.
 * Pass `loop` (in frames) to snap every rhythm so the motion repeats exactly every `loop` frames, for seamless loops.
 */
export const poseFor = (state: CatState, f: number, fps = 30, loop?: number): Pose => {
  const s = (sec: number) => (loop ? loop / Math.max(1, Math.round(loop / (sec * fps))) : sec * fps);
  switch (state) {
    case 'idle':
      return {
        ...breathe(f, s(2.5)),
        blink: blinkEvery(f, s(3.6), s(1)),
        tail: 5 * wave(f, s(2.4)),
        earLeft: f % s(5) > s(4.6) ? 6 * wave(f, s(0.2)) : 0,
      };
    case 'listening':
      return {
        ...breathe(f, s(2)),
        earLeft: 11 + 2 * wave(f, s(0.9)),
        earRight: -11 - 2 * wave(f, s(0.9), 1),
        eyes: 'wide',
        lookY: -5,
        blink: blinkEvery(f, s(4), s(2.2)),
        tail: -8 + 3 * wave(f, s(1.4)),
        whiskers: 3 * wave(f, s(1.1)),
      };
    case 'thinking':
      return {
        ...breathe(f, s(2.2)),
        lookX: 9 * wave(f, s(1.6)),
        lookY: -7,
        earLeft: 4,
        earRight: 4 * wave(f, s(1.6)),
        tail: 12 * wave(f, s(0.9)),
        blink: blinkEvery(f, s(3), s(0.7)),
      };
    case 'moving': {
      const t = wave(f, s(0.34));
      return {
        y: 10 * Math.abs(t),
        tilt: -5,
        squashY: 1 - 0.03 * Math.abs(t),
        squashX: 1 + 0.02 * Math.abs(t),
        earLeft: -6,
        earRight: 6,
        tail: -14 + 6 * t,
        lookX: 8,
      };
    }
    case 'acting': {
      const h = hop(f, s(1.3), 70);
      const crouching = (h.squashY ?? 1) < 0.97 && (h.y ?? 0) === 0;
      return {...h, eyes: 'wide', earLeft: 8, earRight: -8, tail: crouching ? 10 : -16, lookY: -4};
    }
    case 'waitingForUser':
      return {
        ...breathe(f, s(2.6)),
        tilt: -7 + 1.2 * wave(f, s(2.6)),
        earLeft: 6,
        earRight: 8,
        blink: blinkEvery(f, s(2.8), s(1.4), 10),
        tail: 6 * wave(f, s(3)),
      };
    case 'paused':
      return {
        ...breathe(f, s(3.4), 0.025),
        eyes: 'closed',
        earLeft: -10,
        earRight: 10,
        tail: 8,
        blush: 0.8,
      };
    case 'done': {
      const h = hop(f, s(1.1), 34);
      return {...h, eyes: 'happy', blush: 1, earLeft: 9, earRight: -9, tail: -18 + 10 * wave(f, s(0.5)), whiskers: 4};
    }
    case 'stuck':
      return {
        ...breathe(f, s(2)),
        eyes: 'wide',
        tilt: 4 * wave(f, s(1.8)),
        lookX: 6 * wave(f, s(0.9)),
        earLeft: -4 + 3 * wave(f, s(0.6)),
        earRight: 9,
        mouthOpen: 0.35,
        tail: 4,
      };
  }
};

/** Smoothly hand over from one pose to the next. `t` is 0..1. */
export const mixPose = (a: Pose, b: Pose, t: number): Pose => {
  const k = interpolate(t, [0, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Pose>;
  const base: Record<string, number> = {squashX: 1, squashY: 1, blush: 1};
  const out: Pose = {};
  keys.forEach((key) => {
    if (key === 'eyes') {
      out.eyes = k < 0.5 ? a.eyes : b.eyes;
      return;
    }
    const av = (a[key] as number | undefined) ?? base[key] ?? 0;
    const bv = (b[key] as number | undefined) ?? base[key] ?? 0;
    (out as Record<string, number>)[key] = av + (bv - av) * k;
  });
  return out;
};
