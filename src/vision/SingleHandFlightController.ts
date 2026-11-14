/**
 * SingleHandFlightController
 * ==========================
 * Converts the landmarks of exactly ONE hand into a normalised FlightInput.
 *
 *   palm centre (x)        → roll      hand left / right
 *   palm centre (y)        → pitch     hand up / down
 *   wrist rotation         → yaw       turn the hand like a dial
 *   finger openness        → throttle  open hand = idle, closed hand = full
 *   pinch / thumbs-up / fist-hold → gear / autopilot / emergency pause
 *
 * All control is continuous and derived from measurements (not gesture
 * labels). The controller knows nothing about the flight engine: it emits a
 * FlightInput and FlightCommands, nothing else.
 *
 * Safety properties:
 *   - inputs are measured relative to a calibrated neutral, with dead zones;
 *   - One-Euro filtering removes jitter without adding much latency;
 *   - when the hand disappears, pitch/roll/yaw decay to neutral within a
 *     fraction of a second and the throttle is held (never an extreme input);
 *   - when the hand reappears, authority ramps in instead of jumping;
 *   - gestures need a dwell time, a release and a cooldown, and the throttle
 *     is frozen while the fingers are busy forming a gesture.
 */
import type { FlightCommand, FlightInput, GestureCalibration, GestureName, GestureState, HandFeatures, HandLandmarks, Handedness, TrackingStatus } from '../types';
import { defaultCalibration } from './calibration/calibration';
import { OneEuroFilter, angleDiff, axialDeadZone, clamp, expo, radialDeadZone } from './controls/filters';
import { GestureRecognizer } from './gestures/GestureRecognizer';
import { emptyFeatures, extractFeatures } from './landmarks/features';

export interface HandControlSettings {
  hand: Handedness;
  /** Ignore the other hand if it shows up instead. */
  enforceHand: boolean;
  /** 0.4 .. 2.5 — multiplies pitch/roll deflection. */
  sensitivity: number;
  yawSensitivity: number;
  /** 0 .. 0.35 of full stick travel. */
  deadZone: number;
  yawDeadZone: number;
  /** 0 (fastest) .. 1 (smoothest). */
  smoothing: number;
  /** 0 (linear) .. 0.8 (soft centre). */
  expo: number;
  invertPitch: boolean;
  /** Seconds a tight fist must be held to pause; 0 disables. */
  fistPauseSeconds: number;
  gestures: boolean;
}

export const DEFAULT_HAND_SETTINGS: HandControlSettings = {
  hand: 'Right',
  enforceHand: true,
  sensitivity: 1,
  yawSensitivity: 1,
  deadZone: 0.1,
  yawDeadZone: 0.22,
  smoothing: 0.5,
  expo: 0.3,
  invertPitch: false,
  fistPauseSeconds: 2,
  gestures: true,
};

/** Closure (0 = calibrated open hand, 1 = calibrated fist) mapped to throttle. */
export const THROTTLE_IDLE_CLOSURE = 0.1;
export const THROTTLE_FULL_CLOSURE = 0.78;
/** Beyond this closure, with the thumb wrapped, the fist counts as the pause gesture. */
export const PAUSE_CLOSURE = 0.92;

const LOST_AFTER_MS = 240;
const STALL_AFTER_MS = 900;
const ENGAGE_SECONDS = 0.45;
const NEUTRAL_DECAY = 0.22; // s time constant back to neutral when the hand is lost
const THROTTLE_SLEW = 2.2; // per second

export interface ControllerSnapshot {
  status: TrackingStatus;
  confidence: number;
  landmarks: HandLandmarks | null;
  features: HandFeatures;
  /** Stick position before dead zone and expo, −1.3..1.3 (for the joystick display). */
  rawRoll: number;
  rawPitch: number;
  rawYaw: number;
  /** Final outputs. */
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  /** 0 open .. 1 fist (may slightly exceed 1). */
  closure: number;
  gesture: GestureState;
  /** 0..1 authority ramp after (re)acquiring the hand. */
  engage: number;
  /** Seconds since the hand was last seen. */
  lostFor: number;
  /** Framing advice for the player, or null. */
  advice: string | null;
  /** True once a hand has been seen at least once this session. */
  everTracked: boolean;
}

export class SingleHandFlightController {
  settings: HandControlSettings = { ...DEFAULT_HAND_SETTINGS };
  calibration: GestureCalibration;
  /** True when the calibration came from the calibration wizard (not defaults). */
  calibrated = false;
  readonly gestures = new GestureRecognizer();
  /** Edge-triggered commands from gestures. */
  onCommand: (cmd: FlightCommand) => void = () => {};
  /** Raw gesture notifications (used by the calibration screen and the HUD). */
  onGesture: (g: GestureName) => void = () => {};

  readonly snapshot: ControllerSnapshot = {
    status: 'off',
    confidence: 0,
    landmarks: null,
    features: emptyFeatures(),
    rawRoll: 0,
    rawPitch: 0,
    rawYaw: 0,
    roll: 0,
    pitch: 0,
    yaw: 0,
    throttle: 0,
    closure: 0,
    gesture: this.gestures.state,
    engage: 0,
    lostFor: Infinity,
    advice: null,
    everTracked: false,
  };

  private fx = new OneEuroFilter();
  private fy = new OneEuroFilter();
  private fa = new OneEuroFilter();
  private fo = new OneEuroFilter();
  private lastSeen = -Infinity;
  /** Time of the last frame in which the detector reported no (usable) hand. */
  private lastMiss = -Infinity;
  /** The hand this controller is locked to (see processHand). */
  private lockedHand: Handedness | null = null;
  private lockVotes = { Left: 0, Right: 0 };
  private lastFrameT = 0;
  private tracking = false;
  private mismatch = 0;
  private wrongHand = false;
  private targetRoll = 0;
  private targetPitch = 0;
  private targetYaw = 0;
  private throttleTarget = 0;
  private throttleHistory: { t: number; v: number }[] = [];
  private frozenThrottle: number | null = null;
  private autoNeutral: { t0: number; n: number; x: number; y: number; a: number; s: number } | null = null;
  private stick = { x: 0, y: 0 };
  private active = false;
  private aspect = 4 / 3;
  private readonly out: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, source: 'hand' };

  constructor() {
    this.calibration = defaultCalibration('Right');
    this.gestures.onGesture = (g) => this.handleGesture(g);
    this.applySettings();
  }

  /** Call after changing `settings`. */
  applySettings(): void {
    const s = this.settings;
    // smoothing 0 → 3.2 Hz cutoff at rest, 1 → 0.5 Hz; beta keeps fast moves responsive
    const cut = 3.2 * Math.pow(0.5 / 3.2, clamp(s.smoothing, 0, 1));
    this.fx.minCutoff = this.fy.minCutoff = cut;
    this.fx.beta = this.fy.beta = 9;
    this.fa.minCutoff = cut * 0.9;
    this.fa.beta = 2.5;
    this.fo.minCutoff = cut * 1.3;
    this.fo.beta = 3;
    this.gestures.config.fistHold = s.fistPauseSeconds;
    this.gestures.config.fistClosure = PAUSE_CLOSURE;
    this.gestures.config.enabled = s.gestures;
  }

  setCalibration(c: GestureCalibration, fromWizard = true): void {
    this.calibration = { ...c, neutral: { ...c.neutral } };
    this.calibrated = fromWizard;
    this.autoNeutral = null;
    this.lockHand(fromWizard ? c.hand : null);
  }

  /** Lock to a specific observed hand, or pass null to re-learn it from the next hand shown. */
  lockHand(hand: Handedness | null): void {
    this.lockedHand = hand;
    this.lockVotes.Left = this.lockVotes.Right = 0;
    this.mismatch = 0;
    this.wrongHand = false;
  }
  get trackedHand(): Handedness | null {
    return this.lockedHand;
  }

  /** Controller is switched on (camera running). */
  setActive(on: boolean): void {
    this.active = on;
    if (!on) {
      this.tracking = false;
      this.snapshot.status = 'off';
      this.snapshot.landmarks = null;
      this.gestures.reset();
    } else if (this.snapshot.status === 'off') {
      this.snapshot.status = 'searching';
    }
  }

  /** Make the current hand position the new neutral (quick re-centre). */
  recenter(): boolean {
    if (!this.tracking) return false;
    const f = this.snapshot.features;
    this.calibration.neutral.x = this.fx.value;
    this.calibration.neutral.y = this.fy.value;
    this.calibration.wristNeutral = f.wristAngle;
    return true;
  }

  /** Sync the throttle when another device (keyboard) has been driving it. */
  syncThrottle(v: number): void {
    if (!this.tracking) {
      this.out.throttle = clamp(v, 0, 1);
      this.throttleTarget = this.out.throttle;
    }
  }

  private handleGesture(g: GestureName): void {
    this.onGesture(g);
    switch (g) {
      case 'pinch':
        this.onCommand('toggleGear');
        break;
      case 'thumbsUp':
        this.onCommand('toggleAutopilot');
        break;
      case 'victory':
        this.onCommand('cycleFlaps');
        break;
      case 'fist':
        this.onCommand('pause');
        break;
    }
  }

  /**
   * Feed one vision result. Call at the inference rate with the detected hand
   * or null when no hand was found in the frame.
   * @param now performance.now() in ms
   */
  processHand(hand: HandLandmarks | null, aspect: number, now: number): void {
    const snap = this.snapshot;
    const s = this.settings;
    this.aspect = aspect;
    if (!this.active) return;

    // ---- one hand only, and it must be the selected one
    if (hand) {
      // "Selected hand" is enforced against the hand that was actually
      // observed during calibration (or first acquisition), so a camera that
      // mirrors its image cannot make the player's own hand look "wrong".
      const other = s.enforceHand && this.lockedHand !== null && hand.handedness !== this.lockedHand && hand.score > 0.8;
      this.mismatch = other ? Math.min(this.mismatch + 1, 12) : Math.max(0, this.mismatch - 2);
      const live = this.tracking && now - this.lastSeen <= LOST_AFTER_MS * 2;
      this.wrongHand = live ? this.mismatch >= 6 : other || this.mismatch >= 6;
      if (this.wrongHand) hand = null;
    } else {
      this.wrongHand = false;
      this.mismatch = Math.max(0, this.mismatch - 1);
    }

    if (!hand) {
      this.lastMiss = now;
      snap.landmarks = null;
      snap.confidence = 0;
      this.gestures.update(null, 0, 0, now / 1000);
      return;
    }

    const t = now / 1000;
    const dt = this.lastFrameT > 0 ? clamp(t - this.lastFrameT, 0.005, 0.25) : 1 / 24;
    this.lastFrameT = t;
    const f = extractFeatures(hand, aspect, snap.features);
    snap.landmarks = hand;
    snap.confidence = hand.score;

    // ---- (re)acquisition
    if (!this.tracking) {
      this.fx.reset();
      this.fy.reset();
      this.fa.reset();
      this.fo.reset();
      snap.engage = 0;
      this.tracking = true;
      this.gestures.reset();
      this.frozenThrottle = null;
      this.throttleHistory.length = 0;
      if (!this.calibrated && !snap.everTracked) this.autoNeutral = { t0: t, n: 0, x: 0, y: 0, a: 0, s: 0 };
    }
    this.lastSeen = now;
    snap.everTracked = true;
    if (this.lockedHand === null && hand.score > 0.8) {
      this.lockVotes[hand.handedness]++;
      if (this.lockVotes.Left + this.lockVotes.Right >= 8) this.lockedHand = this.lockVotes.Left > this.lockVotes.Right ? 'Left' : 'Right';
    }

    const px = this.fx.filter(f.palmCenter.x, t);
    const py = this.fy.filter(f.palmCenter.y, t);
    const ang = this.fa.filter(f.wristAngle, t);
    const open = this.fo.filter(f.openness, t);
    const c = this.calibration;

    // ---- without a wizard calibration: adopt the first steady pose as neutral
    if (this.autoNeutral) {
      const a = this.autoNeutral;
      a.n++;
      a.x += px;
      a.y += py;
      a.a += f.wristAngle;
      a.s += f.handScale;
      if (t - a.t0 > 0.5 && a.n >= 4) {
        c.neutral.x = a.x / a.n;
        c.neutral.y = a.y / a.n;
        c.wristNeutral = a.a / a.n;
        c.handScale = a.s / a.n;
        c.rollLeft = c.rollRight = clamp(c.handScale * 1.0, 0.1, 0.3);
        c.pitchUp = c.pitchDown = clamp(c.handScale * 0.8, 0.08, 0.24);
        this.autoNeutral = null;
      }
    }

    // ---- pitch / roll from palm displacement
    const dx = px - c.neutral.x;
    const dy = c.neutral.y - py; // image y grows downwards
    let rr = dx >= 0 ? dx / c.rollRight : dx / c.rollLeft;
    let rp = dy >= 0 ? dy / c.pitchUp : dy / c.pitchDown;
    if (s.invertPitch) rp = -rp;
    rr *= s.sensitivity;
    rp *= s.sensitivity;
    snap.rawRoll = clamp(rr, -1.3, 1.3);
    snap.rawPitch = clamp(rp, -1.3, 1.3);
    // A thumbs-up turns the whole fist: while that pose is being formed the
    // stick is held where it was and the rudder is centred.
    const posing = this.gestures.state.active === 'thumbsUp';
    if (!posing) {
      radialDeadZone(clamp(rr, -1.5, 1.5), clamp(rp, -1.5, 1.5), s.deadZone, this.stick);
      this.targetRoll = clamp(expo(clamp(this.stick.x, -1, 1), s.expo), -1, 1);
      this.targetPitch = clamp(expo(clamp(this.stick.y, -1, 1), s.expo), -1, 1);
    }

    // ---- yaw from wrist rotation
    const da = angleDiff(ang, c.wristNeutral);
    let ry = (da >= 0 ? da / c.wristCw : da / c.wristCcw) * s.yawSensitivity;
    // the wrist angle is only trustworthy while the palm faces the camera:
    // fade the rudder out as the palm foreshortens (hand tipping forwards/back)
    const facing = clamp((f.handScale / (c.handScale || 0.2) - 0.5) / 0.25, 0, 1);
    ry *= facing;
    if (posing) ry = 0;
    snap.rawYaw = clamp(ry, -1.3, 1.3);
    ry = axialDeadZone(clamp(ry, -1.5, 1.5), s.yawDeadZone);
    this.targetYaw = clamp(expo(ry, s.expo), -1, 1);

    // ---- throttle from finger openness
    const closure = clamp((c.opennessOpen - open) / (c.opennessOpen - c.opennessFist), 0, 1.2);
    snap.closure = closure;
    const g = this.gestures.update(f, closure, dt, t);
    const live = clamp((closure - THROTTLE_IDLE_CLOSURE) / (THROTTLE_FULL_CLOSURE - THROTTLE_IDLE_CLOSURE), 0, 1);
    if (g.throttleFrozen) {
      if (this.frozenThrottle === null) {
        // go back to what the throttle was before the fingers started moving
        let v = this.out.throttle;
        for (const h of this.throttleHistory) {
          if (t - h.t >= 0.55) v = h.v;
          else break;
        }
        this.frozenThrottle = v;
      }
      this.throttleTarget = this.frozenThrottle;
    } else {
      this.frozenThrottle = null;
      this.throttleTarget = live;
    }
    this.throttleHistory.push({ t, v: this.throttleTarget });
    while (this.throttleHistory.length && t - this.throttleHistory[0].t > 1.2) this.throttleHistory.shift();

    // ---- framing advice
    const nx = f.palmCenter.x / aspect;
    snap.advice =
      nx < 0.1 || nx > 0.9 || f.palmCenter.y < 0.1 || f.palmCenter.y > 0.92
        ? 'Hand near the edge of the camera view'
        : f.handScale < 0.07
          ? 'Hand is far from the camera'
          : f.handScale > 0.5
            ? 'Hand is very close to the camera'
            : null;
  }

  /**
   * Advance time-based behaviour and return the current FlightInput.
   * Call every simulation step (independent of the vision frame rate).
   * @param dt seconds  @param now performance.now() in ms
   */
  update(dt: number, now: number): FlightInput {
    const snap = this.snapshot;
    const out = this.out;
    if (!this.active) {
      snap.status = 'off';
      out.pitch = out.roll = out.yaw = 0;
      out.source = 'none';
      return out;
    }
    const since = now - this.lastSeen;
    snap.lostFor = since / 1000;
    // "lost" needs evidence: the detector saw no hand after the last sighting,
    // or nothing at all has arrived for a long time (stalled camera / tracker)
    const missed = this.lastMiss > this.lastSeen && since > LOST_AFTER_MS;
    if (this.tracking && (missed || since > STALL_AFTER_MS)) {
      this.tracking = false;
      snap.landmarks = null;
      this.gestures.reset();
    }

    if (this.tracking) {
      snap.status = 'tracking';
      snap.engage = Math.min(1, snap.engage + dt / ENGAGE_SECONDS);
      const k = 1 - Math.exp(-dt / 0.04);
      const e = snap.engage;
      out.roll += (this.targetRoll * e - out.roll) * k;
      out.pitch += (this.targetPitch * e - out.pitch) * k;
      out.yaw += (this.targetYaw * e - out.yaw) * k;
      if (this.targetRoll === 0 && Math.abs(out.roll) < 1e-3) out.roll = 0;
      if (this.targetPitch === 0 && Math.abs(out.pitch) < 1e-3) out.pitch = 0;
      if (this.targetYaw === 0 && Math.abs(out.yaw) < 1e-3) out.yaw = 0;
      // throttle: slew-rate limited, only once authority has ramped in
      if (e >= 1) {
        const d = this.throttleTarget - out.throttle;
        const step = THROTTLE_SLEW * dt;
        out.throttle += clamp(d, -step, step);
      }
      out.source = 'hand';
    } else {
      snap.status = this.wrongHand ? 'wrong-hand' : snap.everTracked ? 'lost' : 'searching';
      snap.engage = 0;
      // never keep a deflection without a hand: bleed back to neutral
      const k = Math.exp(-dt / NEUTRAL_DECAY);
      out.roll *= k;
      out.pitch *= k;
      out.yaw *= k;
      if (Math.abs(out.roll) < 0.002) out.roll = 0;
      if (Math.abs(out.pitch) < 0.002) out.pitch = 0;
      if (Math.abs(out.yaw) < 0.002) out.yaw = 0;
      // throttle is held where it was
      out.source = 'hand';
      snap.rawRoll *= k;
      snap.rawPitch *= k;
      snap.rawYaw *= k;
    }
    out.brake = 0;
    snap.roll = out.roll;
    snap.pitch = out.pitch;
    snap.yaw = out.yaw;
    snap.throttle = out.throttle;
    return out;
  }

  get isTracking(): boolean {
    return this.tracking;
  }
  get currentAspect(): number {
    return this.aspect;
  }
}
