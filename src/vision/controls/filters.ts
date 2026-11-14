/** Signal conditioning for hand measurements. */

/**
 * One Euro filter (Casiez et al.): heavy smoothing while the hand is still
 * (kills landmark jitter), light smoothing while it moves (keeps latency low).
 */
export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  private x = 0;
  private dx = 0;
  private t = -1;

  constructor(minCutoff = 1.2, beta = 0.05, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.t = -1;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param t seconds */
  filter(value: number, t: number): number {
    if (this.t < 0 || t <= this.t) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = Math.min(t - this.t, 0.25);
    this.t = t;
    const dRaw = (value - this.x) / dt;
    this.dx += OneEuroFilter.alpha(this.dCutoff, dt) * (dRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuroFilter.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  get value(): number {
    return this.x;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Radial dead zone for a 2-axis stick; rescaled so output still reaches 1. */
export function radialDeadZone(x: number, y: number, dz: number, out: { x: number; y: number }): void {
  const m = Math.hypot(x, y);
  if (m <= dz || m < 1e-6) {
    out.x = 0;
    out.y = 0;
    return;
  }
  // square gate: each axis can still reach full travel on a diagonal
  const k = (m - dz) / (1 - dz) / m;
  out.x = x * k;
  out.y = y * k;
}

export function axialDeadZone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** Blend of linear and cubic response: finer control around the centre. */
export function expo(v: number, amount: number): number {
  return v * (1 - amount) + v * v * v * amount;
}

/** Wrap an angle difference into (-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
