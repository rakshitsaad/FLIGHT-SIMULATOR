/**
 * Deterministic 2D simplex noise + helpers. Pure functions with no DOM or
 * three.js dependency so the exact same terrain is produced on the main
 * thread (physics queries) and inside the terrain worker (mesh generation).
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
const grad = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);

(function seed(seedValue: number) {
  let s = seedValue >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
})(20261114);

/** Simplex noise, range roughly [-1, 1]. */
export function simplex2(xin: number, yin: number): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n = 0;
  let tt = 0.5 - x0 * x0 - y0 * y0;
  if (tt > 0) {
    const g = permMod12[ii + perm[jj]] * 2;
    tt *= tt;
    n += tt * tt * (grad[g] * x0 + grad[g + 1] * y0);
  }
  tt = 0.5 - x1 * x1 - y1 * y1;
  if (tt > 0) {
    const g = permMod12[ii + i1 + perm[jj + j1]] * 2;
    tt *= tt;
    n += tt * tt * (grad[g] * x1 + grad[g + 1] * y1);
  }
  tt = 0.5 - x2 * x2 - y2 * y2;
  if (tt > 0) {
    const g = permMod12[ii + 1 + perm[jj + 1]] * 2;
    tt *= tt;
    n += tt * tt * (grad[g] * x2 + grad[g + 1] * y2);
  }
  return 70 * n;
}

/** Fractal Brownian motion, range roughly [-1, 1]. */
export function fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(x * freq + o * 17.31, y * freq - o * 9.73);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal, range [0, 1] with sharp crests. */
export function ridged(x: number, y: number, octaves: number, lacunarity = 2.05, gain = 0.5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(simplex2(x * freq + o * 31.7, y * freq + o * 11.9));
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Stable integer hash → [0, 1). */
export function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Squared distance from a point to a polyline plus the parameter along it. */
export function distToPolyline(px: number, pz: number, pts: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t - px;
    const cz = az + dz * t - pz;
    const d2 = cx * cx + cz * cz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
