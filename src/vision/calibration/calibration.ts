/**
 * Calibration: the measurements that map *this* player's hand, camera and
 * seating position onto the normalised control ranges.
 */
import type { GestureCalibration, HandFeatures, Handedness } from '../../types';

export const CALIBRATION_VERSION = 3;

/** Reasonable values for a hand ~50 cm from a laptop webcam. */
export function defaultCalibration(hand: Handedness, aspect = 4 / 3): GestureCalibration {
  return {
    version: CALIBRATION_VERSION,
    hand,
    createdAt: 0,
    neutral: { x: aspect * 0.5, y: 0.55 },
    rollLeft: 0.2,
    rollRight: 0.2,
    pitchUp: 0.16,
    pitchDown: 0.16,
    wristNeutral: 0,
    wristCcw: 0.5,
    wristCw: 0.5,
    opennessOpen: 0.9,
    opennessFist: 0.12,
    handScale: 0.2,
    pinchOpen: 1.1,
  };
}

export function isValidCalibration(c: unknown): c is GestureCalibration {
  if (!c || typeof c !== 'object') return false;
  const k = c as GestureCalibration;
  return k.version === CALIBRATION_VERSION && typeof k.neutral?.x === 'number' && k.rollLeft > 0 && k.pitchUp > 0 && k.opennessOpen > k.opennessFist;
}

export type CalibrationStepId = 'neutral' | 'roll' | 'pitch' | 'wrist' | 'open' | 'fist' | 'gestures' | 'done';

export interface CalibrationStep {
  id: CalibrationStepId;
  title: string;
  instruction: string;
}

export const CALIBRATION_STEPS: CalibrationStep[] = [
  { id: 'neutral', title: 'Neutral position', instruction: 'Hold your open hand upright in a comfortable spot, palm facing the camera, and keep it still.' },
  { id: 'roll', title: 'Roll range', instruction: 'Move your whole hand LEFT, then RIGHT, as far as is comfortable. Then return to the centre.' },
  { id: 'pitch', title: 'Pitch range', instruction: 'Move your hand UP, then DOWN, as far as is comfortable. Then return to the centre.' },
  { id: 'wrist', title: 'Wrist rotation', instruction: 'Keep your hand in place and rotate your wrist like turning a dial — anticlockwise, then clockwise.' },
  { id: 'open', title: 'Throttle idle', instruction: 'Open your hand flat with fingers extended and hold it still.' },
  { id: 'fist', title: 'Throttle full', instruction: 'Close your hand into a firm fist and hold it still.' },
  { id: 'gestures', title: 'Gesture check', instruction: 'Try each gesture once: pinch thumb and index, then give a thumbs up.' },
  { id: 'done', title: 'Calibration complete', instruction: 'Your hand is calibrated.' },
];

const HOLD_SECONDS = 1.3;
/** Fraction of the measured extreme that counts as full deflection. */
const REACH = 0.82;

function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
}
function spread(v: number[]): number {
  if (!v.length) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of v) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi - lo;
}

interface Sample {
  t: number;
  x: number;
  y: number;
  angle: number;
  open: number;
  scale: number;
  pinch: number;
}

/**
 * Drives the step-by-step calibration. Feed it features at the vision rate;
 * read `progress`, `hint` and the live extents for the UI.
 */
export class CalibrationSession {
  readonly result: GestureCalibration;
  stepIndex = 0;
  /** 0..1 progress of the current step. */
  progress = 0;
  hint = '';
  /** Live extents captured during a range step (for the UI bars), 0..1 of what is needed. */
  extentA = 0;
  extentB = 0;
  gesturesSeen: { pinch: boolean; thumbsUp: boolean; victory: boolean } = { pinch: false, thumbsUp: false, victory: false };

  private window: Sample[] = [];
  private min = 0;
  private max = 0;
  private settle = 0;
  private aspect: number;

  constructor(hand: Handedness, aspect: number) {
    this.aspect = aspect;
    this.result = defaultCalibration(hand, aspect);
    this.result.createdAt = Date.now();
  }

  get step(): CalibrationStep {
    return CALIBRATION_STEPS[this.stepIndex];
  }
  get finished(): boolean {
    return this.step.id === 'done';
  }

  next(): void {
    if (this.stepIndex < CALIBRATION_STEPS.length - 1) this.stepIndex++;
    this.window = [];
    this.progress = 0;
    this.min = this.max = 0;
    this.settle = 0;
    this.extentA = this.extentB = 0;
    this.hint = '';
  }

  back(): void {
    if (this.stepIndex > 0) this.stepIndex -= 2;
    if (this.stepIndex < -1) this.stepIndex = -1;
    this.next();
  }

  noteGesture(g: 'pinch' | 'thumbsUp' | 'victory' | 'fist'): void {
    if (this.step.id !== 'gestures') return;
    if (g === 'pinch') this.gesturesSeen.pinch = true;
    if (g === 'thumbsUp') this.gesturesSeen.thumbsUp = true;
    if (g === 'victory') this.gesturesSeen.victory = true;
  }

  /** @param f features, or null when no hand is visible. @param t seconds */
  update(f: HandFeatures | null, t: number, dt: number): void {
    const id = this.step.id;
    if (id === 'done') return;
    if (!f) {
      this.hint = 'Show one hand to the camera';
      if (id === 'neutral' || id === 'open' || id === 'fist') {
        this.window = [];
        this.progress = 0;
      }
      return;
    }
    const c = this.result;
    const s: Sample = { t, x: f.palmCenter.x, y: f.palmCenter.y, angle: f.wristAngle, open: f.openness, scale: f.handScale, pinch: f.thumbIndexDistance };

    if (id === 'neutral' || id === 'open' || id === 'fist') {
      this.window.push(s);
      while (this.window.length && t - this.window[0].t > HOLD_SECONDS) this.window.shift();
      const xs = this.window.map((w) => w.x);
      const ys = this.window.map((w) => w.y);
      const steady = spread(xs) < 0.035 && spread(ys) < 0.035;
      const span = this.window.length > 1 ? t - this.window[0].t : 0;
      let ok = steady;
      this.hint = steady ? 'Hold still…' : 'Keep your hand still';
      if (id === 'neutral') {
        // usable neutral: hand fully in frame with room to move in every direction
        const mx = f.palmCenter.x / this.aspect;
        if (mx < 0.2 || mx > 0.8 || f.palmCenter.y < 0.25 || f.palmCenter.y > 0.8) {
          ok = false;
          this.hint = 'Move your hand closer to the middle of the picture';
        } else if (f.handScale < 0.09) {
          ok = false;
          this.hint = 'Move your hand closer to the camera';
        } else if (f.handScale > 0.42) {
          ok = false;
          this.hint = 'Move your hand further from the camera';
        } else if (f.openness < 0.55) {
          ok = false;
          this.hint = 'Open your hand';
        }
      } else if (id === 'open') {
        if (f.openness < 0.6) {
          ok = false;
          this.hint = 'Open your hand flat';
        }
      } else if (id === 'fist') {
        if (f.openness > c.opennessOpen - 0.3) {
          ok = false;
          this.hint = 'Close your hand into a fist';
        }
      }
      if (!ok) {
        this.window = [];
        this.progress = 0;
        return;
      }
      this.progress = Math.min(1, span / (HOLD_SECONDS * 0.9));
      if (this.progress >= 1) {
        if (id === 'neutral') {
          c.neutral.x = median(xs);
          c.neutral.y = median(ys);
          c.wristNeutral = median(this.window.map((w) => w.angle));
          c.handScale = median(this.window.map((w) => w.scale));
          c.opennessOpen = median(this.window.map((w) => w.open));
          c.pinchOpen = median(this.window.map((w) => w.pinch));
          // provisional ranges scaled to the apparent hand size
          const k = c.handScale;
          c.rollLeft = c.rollRight = Math.max(0.1, k * 1.0);
          c.pitchUp = c.pitchDown = Math.max(0.08, k * 0.8);
        } else if (id === 'open') {
          c.opennessOpen = median(this.window.map((w) => w.open));
          c.pinchOpen = median(this.window.map((w) => w.pinch));
        } else {
          c.opennessFist = Math.min(median(this.window.map((w) => w.open)), c.opennessOpen - 0.3);
        }
        this.next();
      }
      return;
    }

    if (id === 'roll' || id === 'pitch' || id === 'wrist') {
      let v: number;
      let need: number;
      if (id === 'roll') {
        v = s.x - c.neutral.x;
        need = Math.max(0.07, c.handScale * 0.5);
      } else if (id === 'pitch') {
        v = c.neutral.y - s.y;
        need = Math.max(0.06, c.handScale * 0.4);
      } else {
        v = s.angle - c.wristNeutral;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        need = 0.2;
      }
      if (v < this.min) this.min = v;
      if (v > this.max) this.max = v;
      this.extentA = Math.min(1, -this.min / need);
      this.extentB = Math.min(1, this.max / need);
      const both = this.extentA >= 1 && this.extentB >= 1;
      const centred = Math.abs(v) < need * 0.45;
      if (both && centred) this.settle += dt;
      else this.settle = 0;
      this.progress = (this.extentA + this.extentB) * 0.4 + Math.min(1, this.settle / 0.5) * 0.2;
      this.hint = !both
        ? id === 'wrist'
          ? this.extentA < 1 ? 'Rotate anticlockwise ↺' : 'Now rotate clockwise ↻'
          : id === 'roll'
            ? this.extentA < 1 ? 'Move LEFT ←' : 'Now move RIGHT →'
            : this.extentB < 1 ? 'Move UP ↑' : 'Now move DOWN ↓'
        : 'Return to the centre';
      if (both && this.settle >= 0.5) {
        if (id === 'roll') {
          c.rollLeft = Math.max(0.06, -this.min * REACH);
          c.rollRight = Math.max(0.06, this.max * REACH);
        } else if (id === 'pitch') {
          c.pitchDown = Math.max(0.05, -this.min * REACH);
          c.pitchUp = Math.max(0.05, this.max * REACH);
        } else {
          c.wristCcw = Math.max(0.18, -this.min * REACH);
          c.wristCw = Math.max(0.18, this.max * REACH);
        }
        this.next();
      }
      return;
    }

    if (id === 'gestures') {
      const g = this.gesturesSeen;
      this.progress = ((g.pinch ? 1 : 0) + (g.thumbsUp ? 1 : 0)) / 2;
      this.hint = !g.pinch ? 'Pinch: touch thumb and index fingertip' : !g.thumbsUp ? 'Thumbs up: fist with the thumb pointing up' : 'All gestures recognised';
      if (g.pinch && g.thumbsUp) {
        this.settle += dt;
        if (this.settle > 0.8) this.next();
      }
    }
  }
}
