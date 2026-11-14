/**
 * Turns 21 raw landmarks into the continuous measurements the flight
 * controller works with. No thresholds or gesture labels here — just geometry.
 */
import type { HandFeatures, HandLandmarks, Vec3 } from '../../types';
import { FINGERS, LM } from './handModel';

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Angle between bone a→b and bone b→c (0 = straight). */
function bend(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const vz = c.z - b.z;
  const lu = Math.hypot(ux, uy, uz);
  const lv = Math.hypot(vx, vy, vz);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  const d = (ux * vx + uy * vy + uz * vz) / (lu * lv);
  return Math.acos(d < -1 ? -1 : d > 1 ? 1 : d);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function emptyFeatures(): HandFeatures {
  return {
    palmCenter: { x: 0, y: 0 },
    wrist: { x: 0, y: 0 },
    handScale: 0,
    wristAngle: 0,
    fingerCurl: [0, 0, 0, 0, 0],
    openness: 1,
    thumbIndexDistance: 1,
    thumbTuck: 1,
    thumbDirection: { x: 0, y: -1 },
    thumbProminence: 0,
  };
}

/**
 * @param aspect video width / height, so that image x and y share one unit
 *               (fractions of the frame height).
 */
export function extractFeatures(hand: HandLandmarks, aspect: number, out: HandFeatures = emptyFeatures()): HandFeatures {
  const im = hand.image;
  const w = hand.world;
  const wrist = im[LM.WRIST];

  // ---- palm centre: wrist + the four knuckles (stable while fingers move)
  let cx = wrist.x;
  let cy = wrist.y;
  for (const i of [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]) {
    cx += im[i].x;
    cy += im[i].y;
  }
  out.palmCenter.x = (cx / 5) * aspect;
  out.palmCenter.y = cy / 5;
  out.wrist.x = wrist.x * aspect;
  out.wrist.y = wrist.y;

  // ---- wrist orientation in the image plane
  const mk = im[LM.MIDDLE_MCP];
  const dx = (mk.x - wrist.x) * aspect;
  const dy = mk.y - wrist.y;
  out.handScale = Math.hypot(dx, dy);
  out.wristAngle = Math.atan2(dx, -dy);

  // ---- finger curl from 3D joint angles + fingertip reach
  const palm = dist3(w[LM.WRIST], w[LM.MIDDLE_MCP]) || 0.09;
  const ww = w[LM.WRIST];
  let reach3 = 0;
  for (let f = 0; f < 4; f++) {
    const [mcp, pip, dip, tip] = FINGERS[f];
    const flex = bend(ww, w[mcp], w[pip]) + bend(w[mcp], w[pip], w[dip]) + bend(w[pip], w[dip], w[tip]);
    const angleCurl = clamp01(flex / 4.2);
    // fingertip distance from the wrist relative to the knuckle distance: ~1.9 straight, ~0.9 curled
    const reach = dist3(w[tip], ww) / (dist3(w[mcp], ww) || palm);
    const reachCurl = clamp01((1.9 - reach) / 1.1);
    out.fingerCurl[f + 1] = 0.5 * angleCurl + 0.5 * reachCurl;
    if (f > 0) reach3 += out.fingerCurl[f + 1];
  }
  const thumbFlex = bend(w[LM.THUMB_CMC], w[LM.THUMB_MCP], w[LM.THUMB_IP]) + bend(w[LM.THUMB_MCP], w[LM.THUMB_IP], w[LM.THUMB_TIP]);
  out.fingerCurl[0] = clamp01(thumbFlex / 1.7);

  // Throttle openness uses middle, ring and pinky only, so that pinching with
  // thumb + index does not disturb the throttle.
  out.openness = 1 - reach3 / 3;

  out.thumbIndexDistance = dist3(w[LM.THUMB_TIP], w[LM.INDEX_TIP]) / palm;
  let tuck = Infinity;
  for (const i of [LM.INDEX_PIP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.RING_PIP, LM.INDEX_DIP]) {
    const d = dist3(w[LM.THUMB_TIP], w[i]);
    if (d < tuck) tuck = d;
  }
  out.thumbTuck = tuck / palm;

  const tm = im[LM.THUMB_MCP];
  const tt = im[LM.THUMB_TIP];
  const tx = (tt.x - tm.x) * aspect;
  const ty = tt.y - tm.y;
  const tl = Math.hypot(tx, ty) || 1;
  out.thumbDirection.x = tx / tl;
  out.thumbDirection.y = ty / tl;

  // thumb sticking out above the rest of the hand (image y grows downwards)
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < 21; i++) {
    const y = im[i].y;
    if (y > bottom) bottom = y;
    if (i !== LM.THUMB_TIP && i !== LM.THUMB_IP && y < top) top = y;
  }
  const height = Math.max(bottom - Math.min(top, tt.y), 1e-4);
  out.thumbProminence = (top - tt.y) / height;
  return out;
}
