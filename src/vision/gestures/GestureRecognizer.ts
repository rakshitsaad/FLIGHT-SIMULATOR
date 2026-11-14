/**
 * Secondary gestures. Every gesture needs (a) a pose that is geometrically
 * unambiguous, (b) to be held for a dwell time, (c) to be released before it
 * can fire again and (d) a cooldown — so normal flying never triggers one.
 *
 *   pinch (thumb tip ↔ index tip)            → landing gear
 *   thumbs up                                → autopilot
 *   victory / peace sign                     → flaps (extra, optional)
 *   tight fist with wrapped thumb, held 2 s  → emergency pause
 */
import type { GestureName, GestureState, HandFeatures } from '../../types';

export interface GestureConfig {
  /** Seconds a tight fist must be held to pause. 0 disables. */
  fistHold: number;
  /** Closure (0 open .. 1 calibrated fist) above which a fist counts as "tight". */
  fistClosure: number;
  enabled: boolean;
}

const DWELL: Record<GestureName, number> = { pinch: 0.2, thumbsUp: 0.45, victory: 0.4, fist: 2 };
const COOLDOWN: Record<GestureName, number> = { pinch: 0.9, thumbsUp: 1.3, victory: 1.1, fist: 2.5 };
/** Grace period: a pose may flicker for this long without resetting its dwell. */
const GRACE = 0.14;

export function createGestureState(): GestureState {
  return { active: null, progress: 0, fistHold: 0, throttleFrozen: false, lastFired: {} };
}

export class GestureRecognizer {
  readonly state: GestureState = createGestureState();
  config: GestureConfig = { fistHold: 2, fistClosure: 0.93, enabled: true };
  /** Called exactly once per confirmed gesture. */
  onGesture: (g: GestureName) => void = () => {};

  private candidate: GestureName | null = null;
  private held = 0;
  private missing = 0;
  private fired = false;
  private releaseTimer = 0;
  private cooldownUntil: Partial<Record<GestureName, number>> = {};
  private pinchLatched = false;

  reset(): void {
    this.candidate = null;
    this.held = 0;
    this.missing = 0;
    this.fired = false;
    this.releaseTimer = 0;
    this.pinchLatched = false;
    const s = this.state;
    s.active = null;
    s.progress = 0;
    s.fistHold = 0;
    s.throttleFrozen = false;
  }

  /** Which pose (if any) the hand is currently forming. Pure geometry. */
  classify(f: HandFeatures, closure: number): GestureName | null {
    const [thumb, index, middle, ring, pinky] = f.fingerCurl;

    // Pinch: thumb and index tips touching while the index is not buried in a fist.
    const pinchOn = this.pinchLatched ? 0.3 : 0.2;
    if (f.thumbIndexDistance < pinchOn && index < 0.8) {
      this.pinchLatched = true;
      return 'pinch';
    }
    this.pinchLatched = false;

    const curled = (c: number) => c > 0.62;
    const straight = (c: number) => c < 0.32;

    // Thumbs up: four fingers curled, thumb straight, pointing up and standing
    // clearly above the rest of the hand (a throttle fist with a resting thumb does not qualify).
    if (curled(index) && curled(middle) && curled(ring) && curled(pinky) && thumb < 0.45 && f.thumbDirection.y < -0.8 && f.thumbProminence > 0.16 && f.thumbTuck > 0.4) {
      return 'thumbsUp';
    }

    // Victory: index + middle straight, ring + pinky curled.
    if (straight(index) && straight(middle) && curled(ring) && curled(pinky)) return 'victory';

    // Tight fist: everything curled past the calibrated fist, thumb wrapped over the fingers.
    if (this.config.fistHold > 0 && closure >= this.config.fistClosure && index > 0.7 && middle > 0.7 && ring > 0.7 && pinky > 0.7 && f.thumbTuck < 0.62) {
      return 'fist';
    }
    return null;
  }

  /**
   * @param closure 0 (calibrated open hand) .. 1 (calibrated fist)
   * @param now seconds
   */
  update(f: HandFeatures | null, closure: number, dt: number, now: number): GestureState {
    const s = this.state;
    if (!this.config.enabled || !f) {
      this.reset();
      return s;
    }
    const pose = this.classify(f, closure);

    if (pose && pose === this.candidate) {
      this.held += dt;
      this.missing = 0;
    } else if (pose && pose !== this.candidate) {
      // a different pose appeared: start over
      this.candidate = pose;
      this.held = 0;
      this.missing = 0;
      this.fired = false;
    } else if (this.candidate) {
      this.missing += dt;
      if (this.missing > GRACE) {
        if (this.candidate === 'thumbsUp' || this.candidate === 'victory') this.releaseTimer = 0.4;
        this.candidate = null;
        this.held = 0;
        this.fired = false;
      }
    }

    const c = this.candidate;
    const dwell = c === 'fist' ? this.config.fistHold : c ? DWELL[c] : 1;
    const cooling = c ? (this.cooldownUntil[c] ?? 0) > now : false;
    if (c && !this.fired && !cooling && this.held >= dwell) {
      this.fired = true;
      this.cooldownUntil[c] = now + COOLDOWN[c];
      s.lastFired[c] = now * 1000;
      this.onGesture(c);
    }

    s.active = c;
    s.progress = c ? Math.min(1, this.held / dwell) : 0;
    s.fistHold = c === 'fist' && !this.fired ? Math.min(1, this.held / dwell) : 0;

    // The throttle must not follow the fingers while they are busy forming a
    // pose (thumbs-up and victory curl the throttle fingers), nor for a moment after.
    if (this.releaseTimer > 0 && !c) this.releaseTimer -= dt;
    s.throttleFrozen = c === 'thumbsUp' || c === 'victory' || (this.releaseTimer > 0 && !c);
    return s;
  }
}
