import { describe, expect, it } from 'vitest';
import { CalibrationSession, CALIBRATION_STEPS } from '../src/vision/calibration/calibration';
import { extractFeatures } from '../src/vision/landmarks/features';
import { SingleHandFlightController } from '../src/vision/SingleHandFlightController';
import type { FlightCommand, FlightInput } from '../src/types';
import { makeHand, type Pose } from './handRig';

const ASPECT = 4 / 3;
const NEUTRAL: Pose = { x: 0.5, y: 0.55 };

/** Drives a controller with a pose function at 25 fps vision / 60 Hz updates. */
class Bench {
  c = new SingleHandFlightController();
  now = 1000;
  cmds: FlightCommand[] = [];
  out!: FlightInput;
  constructor(calibrate = true) {
    this.c.onCommand = (cmd) => this.cmds.push(cmd);
    this.c.setActive(true);
    if (calibrate) {
      const cal = { ...this.c.calibration, neutral: { x: 0.5 * ASPECT, y: 0.55 } };
      const f = extractFeatures(makeHand(NEUTRAL), ASPECT);
      cal.wristNeutral = f.wristAngle;
      cal.handScale = f.handScale;
      cal.opennessOpen = f.openness;
      cal.opennessFist = extractFeatures(makeHand({ ...NEUTRAL, curl: 1, thumb: 'tucked' }), ASPECT).openness;
      cal.rollLeft = cal.rollRight = 0.2;
      cal.pitchUp = cal.pitchDown = 0.16;
      this.c.setCalibration(cal);
    }
    this.out = this.c.update(0, this.now);
  }
  run(seconds: number, pose: ((t: number) => Pose | null) | Pose | null) {
    const steps = Math.round(seconds * 60);
    let nextVision = 0;
    for (let i = 0; i < steps; i++) {
      const t = i / 60;
      if (t >= nextVision) {
        nextVision += 1 / 25;
        const p = typeof pose === 'function' ? pose(t) : pose;
        this.c.processHand(p ? makeHand(p, this.now) : null, ASPECT, this.now);
      }
      this.now += 1000 / 60;
      this.out = this.c.update(1 / 60, this.now);
    }
  }
}

describe('hand features', () => {
  it('measures openness, curl, pinch distance and wrist angle from landmarks', () => {
    const open = extractFeatures(makeHand(NEUTRAL), ASPECT);
    const fist = extractFeatures(makeHand({ ...NEUTRAL, curl: 1, thumb: 'tucked' }), ASPECT);
    const half = extractFeatures(makeHand({ ...NEUTRAL, curl: 0.5 }), ASPECT);
    expect(open.openness).toBeGreaterThan(0.85);
    expect(fist.openness).toBeLessThan(0.2);
    expect(half.openness).toBeGreaterThan(fist.openness + 0.15);
    expect(half.openness).toBeLessThan(open.openness - 0.15);
    expect(open.palmCenter.x).toBeCloseTo(0.5 * ASPECT, 2);
    expect(open.palmCenter.y).toBeCloseTo(0.55, 2);
    expect(Math.abs(open.wristAngle)).toBeLessThan(0.05);
    const cw = extractFeatures(makeHand({ ...NEUTRAL, rot: 0.5 }), ASPECT);
    const ccw = extractFeatures(makeHand({ ...NEUTRAL, rot: -0.5 }), ASPECT);
    expect(cw.wristAngle).toBeCloseTo(0.5, 1);
    expect(ccw.wristAngle).toBeCloseTo(-0.5, 1);
    const pinch = extractFeatures(makeHand({ ...NEUTRAL, curl: [0.45, 0, 0, 0], thumb: 'pinch' }), ASPECT);
    expect(pinch.thumbIndexDistance).toBeLessThan(0.15);
    expect(open.thumbIndexDistance).toBeGreaterThan(0.6);
    // pinching must not disturb the throttle measurement
    expect(Math.abs(pinch.openness - open.openness)).toBeLessThan(0.05);
    expect(fist.thumbTuck).toBeLessThan(0.5);
  });
});

describe('SingleHandFlightController', () => {
  it('is neutral with the hand at the calibrated neutral position', () => {
    const b = new Bench();
    b.run(2, NEUTRAL);
    expect(b.c.snapshot.status).toBe('tracking');
    expect(b.out.roll).toBe(0);
    expect(b.out.pitch).toBe(0);
    expect(b.out.yaw).toBe(0);
    expect(b.out.throttle).toBeLessThan(0.02);
  });

  it('maps hand left/right to roll and up/down to pitch, continuously', () => {
    const b = new Bench();
    b.run(1, NEUTRAL);
    b.run(1, { ...NEUTRAL, x: 0.5 + 0.2 / ASPECT });
    expect(b.out.roll).toBeGreaterThan(0.9);
    expect(Math.abs(b.out.pitch)).toBeLessThan(0.05);
    b.run(1, { ...NEUTRAL, x: 0.5 - 0.2 / ASPECT });
    expect(b.out.roll).toBeLessThan(-0.9);
    b.run(1, { ...NEUTRAL, y: 0.55 - 0.16 });
    expect(b.out.pitch).toBeGreaterThan(0.9); // hand up = nose up
    expect(Math.abs(b.out.roll)).toBeLessThan(0.05);
    b.run(1, { ...NEUTRAL, y: 0.55 + 0.16 });
    expect(b.out.pitch).toBeLessThan(-0.9);
    // proportional: half travel gives a partial deflection, monotonic in between
    let last = -1;
    for (const frac of [0.2, 0.4, 0.6, 0.8, 1]) {
      b.run(0.8, { ...NEUTRAL, x: 0.5 + (0.2 * frac) / ASPECT });
      expect(b.out.roll).toBeGreaterThan(last);
      last = b.out.roll;
    }
    b.run(0.8, { ...NEUTRAL, x: 0.5 + (0.2 * 0.5) / ASPECT });
    expect(b.out.roll).toBeGreaterThan(0.15);
    expect(b.out.roll).toBeLessThan(0.6);
  });

  it('ignores jitter inside the dead zone', () => {
    const b = new Bench();
    let max = 0;
    b.run(4, (t) => {
      max = Math.max(max, Math.abs(b.out.roll), Math.abs(b.out.pitch), Math.abs(b.out.yaw));
      return { ...NEUTRAL, x: 0.5 + Math.sin(t * 40) * 0.006, y: 0.55 + Math.cos(t * 33) * 0.006, rot: Math.sin(t * 20) * 0.04 };
    });
    expect(max).toBe(0);
  });

  it('maps wrist rotation to yaw', () => {
    const b = new Bench();
    b.run(1, NEUTRAL);
    b.run(1, { ...NEUTRAL, rot: 0.5 });
    expect(b.out.yaw).toBeGreaterThan(0.85);
    expect(Math.abs(b.out.roll)).toBeLessThan(0.08);
    b.run(1, { ...NEUTRAL, rot: -0.5 });
    expect(b.out.yaw).toBeLessThan(-0.85);
    b.run(1, { ...NEUTRAL, rot: 0.06 });
    expect(b.out.yaw).toBe(0);
  });

  it('maps finger openness to a continuous throttle', () => {
    const b = new Bench();
    b.run(1.5, NEUTRAL);
    expect(b.out.throttle).toBeLessThan(0.02);
    b.run(1.5, { ...NEUTRAL, curl: 0.45 });
    const mid = b.out.throttle;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.85);
    b.run(1.5, { ...NEUTRAL, curl: 0.85 });
    expect(b.out.throttle).toBeGreaterThan(0.97);
    b.run(1.5, NEUTRAL);
    expect(b.out.throttle).toBeLessThan(0.02);
    // throttle is independent of where the hand is
    b.run(1.5, { x: 0.62, y: 0.45, curl: 0.45 });
    expect(Math.abs(b.out.throttle - mid)).toBeLessThan(0.06);
  });

  it('never keeps a deflection when the hand disappears, and holds the throttle', () => {
    const b = new Bench();
    b.run(1.5, { x: 0.5 + 0.2 / ASPECT, y: 0.55 - 0.16, rot: 0.5, curl: 0.5 });
    expect(b.out.roll).toBeGreaterThan(0.8);
    expect(b.out.pitch).toBeGreaterThan(0.8);
    const thr = b.out.throttle;
    b.run(0.3, null);
    expect(b.c.snapshot.status).toBe('lost');
    b.run(1.2, null);
    expect(Math.abs(b.out.roll)).toBeLessThan(0.02);
    expect(Math.abs(b.out.pitch)).toBeLessThan(0.02);
    expect(Math.abs(b.out.yaw)).toBeLessThan(0.02);
    expect(b.out.throttle).toBeCloseTo(thr, 5);
    b.run(3, null);
    expect(b.out.roll).toBe(0);
    expect(b.out.pitch).toBe(0);
    // re-acquiring at an extreme ramps in instead of jumping
    b.run(0.1, { x: 0.5 + 0.2 / ASPECT, y: 0.55 });
    expect(b.out.roll).toBeLessThan(0.45);
    b.run(1, { x: 0.5 + 0.2 / ASPECT, y: 0.55 });
    expect(b.out.roll).toBeGreaterThan(0.9);
  });

  it('fires pinch → gear exactly once per pinch, without touching the throttle', () => {
    const b = new Bench();
    b.run(1.5, { ...NEUTRAL, curl: 0.45 });
    const thr = b.out.throttle;
    b.run(0.6, { ...NEUTRAL, curl: [0.45, 0.45, 0.45, 0.45], thumb: 'pinch' });
    expect(b.cmds).toEqual(['toggleGear']);
    b.run(1.5, { ...NEUTRAL, curl: [0.45, 0.45, 0.45, 0.45], thumb: 'pinch' });
    expect(b.cmds).toEqual(['toggleGear']); // held: no repeat
    expect(Math.abs(b.out.throttle - thr)).toBeLessThan(0.05);
    b.run(1.2, { ...NEUTRAL, curl: 0.45 });
    b.run(0.6, { ...NEUTRAL, curl: [0.45, 0.45, 0.45, 0.45], thumb: 'pinch' });
    expect(b.cmds).toEqual(['toggleGear', 'toggleGear']);
    // a flicker shorter than the dwell time does nothing
    const b2 = new Bench();
    b2.run(1, NEUTRAL);
    b2.run(0.08, { ...NEUTRAL, curl: [0.45, 0, 0, 0], thumb: 'pinch' });
    b2.run(1, NEUTRAL);
    expect(b2.cmds).toEqual([]);
  });

  it('fires thumbs-up → autopilot and freezes the throttle while the fist forms', () => {
    const b = new Bench();
    b.run(1.5, { ...NEUTRAL, curl: 0.3 });
    const thr = b.out.throttle;
    expect(thr).toBeLessThan(0.5);
    let peak = 0;
    b.run(1.2, () => {
      peak = Math.max(peak, b.out.throttle);
      return { ...NEUTRAL, curl: 1, thumb: 'up' };
    });
    expect(b.cmds).toEqual(['toggleAutopilot']);
    expect(peak).toBeLessThan(thr + 0.3);
    expect(Math.abs(b.out.throttle - thr)).toBeLessThan(0.08);
    b.run(1.5, { ...NEUTRAL, curl: 0.3 });
    expect(Math.abs(b.out.throttle - thr)).toBeLessThan(0.05);
    expect(b.cmds).toEqual(['toggleAutopilot']);
  });

  it('pauses only after a tight fist is held for two seconds; a throttle fist does not pause', () => {
    const b = new Bench();
    b.run(1, NEUTRAL);
    // flying at full throttle with a relaxed fist (thumb out): no pause
    b.run(6, { ...NEUTRAL, curl: 0.84 });
    expect(b.out.throttle).toBeGreaterThan(0.95);
    expect(b.cmds).toEqual([]);
    // tight fist, thumb wrapped: counts down, fires once at 2 s
    b.run(1.7, { ...NEUTRAL, curl: 1, thumb: 'tucked' });
    expect(b.cmds).toEqual([]);
    expect(b.c.snapshot.gesture.fistHold).toBeGreaterThan(0.6);
    b.run(0.6, { ...NEUTRAL, curl: 1, thumb: 'tucked' });
    expect(b.cmds).toEqual(['pause']);
    b.run(3, { ...NEUTRAL, curl: 1, thumb: 'tucked' });
    expect(b.cmds).toEqual(['pause']);
    // released early: nothing happens
    const b2 = new Bench();
    b2.run(1, NEUTRAL);
    b2.run(1.5, { ...NEUTRAL, curl: 1, thumb: 'tucked' });
    b2.run(1, NEUTRAL);
    expect(b2.cmds).toEqual([]);
  });

  it('rejects the wrong hand when a specific hand is selected', () => {
    const b = new Bench();
    b.run(1.5, { x: 0.5 + 0.2 / ASPECT, y: 0.55, hand: 'Left' });
    expect(b.c.snapshot.status).toBe('wrong-hand');
    expect(b.out.roll).toBe(0);
    b.c.settings.hand = 'Left';
    b.run(1.5, { x: 0.5 + 0.2 / ASPECT, y: 0.55, hand: 'Left' });
    expect(b.c.snapshot.status).toBe('tracking');
    expect(b.out.roll).toBeGreaterThan(0.9);
  });

  it('auto-centres on the first steady pose when no calibration exists', () => {
    const b = new Bench(false);
    b.run(1.5, { x: 0.4, y: 0.6 });
    expect(b.out.roll).toBe(0);
    expect(b.out.pitch).toBe(0);
    b.run(1, { x: 0.4 + 0.25 / ASPECT, y: 0.6 });
    expect(b.out.roll).toBeGreaterThan(0.8);
  });

  it('sensitivity scales the response', () => {
    const lo = new Bench();
    const hi = new Bench();
    lo.c.settings.sensitivity = 0.6;
    hi.c.settings.sensitivity = 1.8;
    const p = { ...NEUTRAL, x: 0.5 + 0.1 / ASPECT };
    lo.run(1.5, p);
    hi.run(1.5, p);
    expect(hi.out.roll).toBeGreaterThan(lo.out.roll * 2);
  });
});

describe('calibration session', () => {
  it('walks through every step from landmark measurements and produces usable ranges', () => {
    const s = new CalibrationSession('Right', ASPECT);
    let t = 0;
    const feed = (seconds: number, pose: (tt: number) => Pose | null) => {
      const start = s.stepIndex;
      for (let i = 0; i < seconds * 25 && s.stepIndex === start; i++) {
        const p = pose(i / 25);
        s.update(p ? extractFeatures(makeHand(p), ASPECT) : null, t, 1 / 25);
        t += 1 / 25;
      }
    };
    expect(s.step.id).toBe('neutral');
    feed(1, () => null);
    expect(s.step.id).toBe('neutral');
    expect(s.hint).toContain('Show one hand');
    feed(3, () => NEUTRAL);
    expect(s.step.id).toBe('roll');
    feed(8, (tt) => ({ ...NEUTRAL, x: 0.5 + (Math.sin(tt * 1.5) * 0.22 * Math.min(1, 4 / (tt + 0.01) > 1 ? 1 : 0)) / ASPECT }));
    feed(2, () => NEUTRAL);
    expect(s.step.id).toBe('pitch');
    feed(4.2, (tt) => ({ ...NEUTRAL, y: 0.55 + Math.sin(tt * 1.5) * 0.17 }));
    feed(2, () => NEUTRAL);
    expect(s.step.id).toBe('wrist');
    feed(4.2, (tt) => ({ ...NEUTRAL, rot: Math.sin(tt * 1.5) * 0.6 }));
    feed(2, () => NEUTRAL);
    expect(s.step.id).toBe('open');
    feed(3, () => NEUTRAL);
    expect(s.step.id).toBe('fist');
    feed(1, () => NEUTRAL);
    expect(s.step.id).toBe('fist');
    feed(3, () => ({ ...NEUTRAL, curl: 1, thumb: 'tucked' }));
    expect(s.step.id).toBe('gestures');
    s.noteGesture('pinch');
    s.noteGesture('thumbsUp');
    feed(2, () => NEUTRAL);
    expect(s.finished).toBe(true);
    const c = s.result;
    expect(c.neutral.x).toBeCloseTo(0.5 * ASPECT, 2);
    expect(c.neutral.y).toBeCloseTo(0.55, 2);
    expect(c.rollLeft).toBeGreaterThan(0.12);
    expect(c.rollRight).toBeGreaterThan(0.12);
    expect(c.pitchUp).toBeGreaterThan(0.1);
    expect(c.pitchDown).toBeGreaterThan(0.1);
    expect(c.wristCw).toBeGreaterThan(0.35);
    expect(c.wristCcw).toBeGreaterThan(0.35);
    expect(c.opennessOpen - c.opennessFist).toBeGreaterThan(0.5);
    expect(CALIBRATION_STEPS.length).toBe(8);
  });
});
