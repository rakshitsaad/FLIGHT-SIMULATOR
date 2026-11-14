/**
 * TEST-ONLY kinematic hand: produces 21 landmarks for a given pose so the
 * controller maths can be unit-tested deterministically. The game itself
 * never uses this — it only ever sees real MediaPipe output.
 */
import type { HandLandmarks, Vec3 } from '../src/types';

export interface Pose {
  /** Palm position in normalised mirrored image coords. */
  x: number;
  y: number;
  /** In-plane rotation, radians, + = clockwise as seen by the player. */
  rot?: number;
  /** Curl of index, middle, ring, pinky (0..1). */
  curl?: [number, number, number, number] | number;
  thumb?: 'out' | 'up' | 'tucked' | 'pinch';
  /** Apparent size: wrist→middle knuckle as a fraction of the frame height. */
  scale?: number;
  hand?: 'Left' | 'Right';
  score?: number;
}

const MCP: [number, number][] = [
  [-0.024, 0.088],
  [-0.002, 0.094],
  [0.019, 0.088],
  [0.037, 0.078],
];
const SEG: [number, number, number][] = [
  [0.042, 0.026, 0.021],
  [0.046, 0.029, 0.022],
  [0.042, 0.027, 0.021],
  [0.032, 0.02, 0.018],
];
const FLEX = [1.45, 1.75, 1.2];

export function makeHand(p: Pose, timestamp = 0, aspect = 4 / 3): HandLandmarks {
  const curl = typeof p.curl === 'number' ? [p.curl, p.curl, p.curl, p.curl] : (p.curl ?? [0, 0, 0, 0]);
  const local: Vec3[] = new Array(21);
  local[0] = { x: 0, y: 0, z: 0 };
  for (let f = 0; f < 4; f++) {
    const c = curl[f];
    let x = MCP[f][0];
    let y = MCP[f][1];
    let z = 0;
    local[5 + f * 4] = { x, y, z };
    let th = 0;
    for (let j = 0; j < 3; j++) {
      th += c * FLEX[j];
      y += Math.cos(th) * SEG[f][j];
      z -= Math.sin(th) * SEG[f][j];
      local[6 + f * 4 + j] = { x, y, z };
    }
  }
  const thumb = p.thumb ?? 'out';
  if (thumb === 'out') {
    local[1] = { x: -0.03, y: 0.02, z: -0.005 };
    local[2] = { x: -0.056, y: 0.044, z: -0.01 };
    local[3] = { x: -0.078, y: 0.066, z: -0.012 };
    local[4] = { x: -0.096, y: 0.086, z: -0.014 };
  } else if (thumb === 'up') {
    local[1] = { x: -0.03, y: 0.022, z: -0.01 };
    local[2] = { x: -0.046, y: 0.055, z: -0.02 };
    local[3] = { x: -0.05, y: 0.09, z: -0.024 };
    local[4] = { x: -0.052, y: 0.122, z: -0.026 };
  } else if (thumb === 'tucked') {
    // wrapped over the curled index / middle fingers
    const a = local[6];
    const b = local[10];
    local[1] = { x: -0.028, y: 0.02, z: -0.012 };
    local[2] = { x: -0.04, y: 0.045, z: -0.03 };
    local[3] = { x: -0.03, y: 0.065, z: -0.05 };
    local[4] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: Math.min(a.z, b.z) - 0.012 };
  } else {
    // pinch: thumb tip meets the index tip
    const tip = local[8];
    local[1] = { x: -0.03, y: 0.02, z: -0.01 };
    local[2] = { x: -0.05, y: 0.045, z: -0.025 };
    local[3] = { x: tip.x - 0.022, y: tip.y - 0.03, z: tip.z - 0.004 };
    local[4] = { x: tip.x - 0.004, y: tip.y - 0.004, z: tip.z - 0.002 };
  }
  const rot = p.rot ?? 0;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const scale = (p.scale ?? 0.2) / 0.094; // image height units per metre
  // palm centre offset so that p.x/p.y is the palm centre, not the wrist
  const pc = { x: (0 + MCP[0][0] + MCP[1][0] + MCP[2][0] + MCP[3][0]) / 5, y: (0 + MCP[0][1] + MCP[1][1] + MCP[2][1] + MCP[3][1]) / 5 };
  const image: Vec3[] = [];
  const world: Vec3[] = [];
  for (let i = 0; i < 21; i++) {
    const l = local[i];
    const lx = l.x - pc.x;
    const ly = l.y - pc.y;
    // rotate clockwise (as seen in the mirrored image, y up) by `rot`
    const rx = lx * cr + ly * sr;
    const ry = -lx * sr + ly * cr;
    image.push({ x: p.x + (rx * scale) / aspect, y: p.y - ry * scale, z: l.z * scale });
    world.push({ x: l.x * cr + l.y * sr, y: -(-l.x * sr + l.y * cr), z: l.z });
  }
  return { image, world, handedness: p.hand ?? 'Right', score: p.score ?? 0.95, timestamp };
}
