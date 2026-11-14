/**
 * Deterministic placement of every solid man-made structure in AERONA.
 * The same list feeds the renderer (instanced meshes) and the Rapier
 * collision world, so what you see is exactly what you can hit.
 */
import { heightAt } from '../terrain/heightfield';
import { makeRng, simplex2 } from '../terrain/noise';
import { AIRPORTS, BRIDGES, CITY, HIGHWAYS, LANDMARKS, VILLAGES, apronRect, fromRunwayCoords, runwayFrame, type AirportDef } from './aerona';
import { distToPolyline } from '../terrain/noise';

export type StructureStyle = 'tower' | 'office' | 'lowrise' | 'house' | 'terminal' | 'hangar' | 'control' | 'industrial' | 'pylon' | 'deck' | 'landmark';

export interface Structure {
  style: StructureStyle;
  /** Centre of the base. */
  x: number;
  y: number;
  z: number;
  /** Full width (x), height (y), depth (z) before rotation. */
  w: number;
  h: number;
  d: number;
  /** Rotation about +y, radians. */
  rot: number;
  /** 0..1 colour variation seed. */
  tint: number;
  /** Cylinder instead of box. */
  round?: boolean;
  /** Excluded from rendering by the generic building mesh (handcrafted visuals). */
  custom?: boolean;
}

let cache: Structure[] | null = null;

export const CITY_GRID = { block: 132, street: 24, rot: 0.21 };

function cityBuildings(out: Structure[]): void {
  const rnd = makeRng(9001);
  const { block, rot } = CITY_GRID;
  const lot = block - CITY_GRID.street;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const n = Math.ceil(CITY.radius / block);
  const ring = HIGHWAYS[0].points;
  const roads = HIGHWAYS.slice(1).map((h) => h.points);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const lx = i * block;
      const lz = j * block;
      const bx = CITY.x + lx * cr - lz * sr;
      const bz = CITY.z + lx * sr + lz * cr;
      const dn = Math.hypot(lx, lz) / CITY.radius;
      // consume a fixed amount of randomness per block for stability
      const r = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
      if (dn > 0.97) continue;
      const park = simplex2(bx / 700 + 3, bz / 700) * 0.5 + 0.5;
      if (park > 0.66) continue;
      if (distToPolyline(bx, bz, ring) < 95) continue;
      let nearRoad = false;
      for (const rd of roads) if (distToPolyline(bx, bz, rd) < 85) nearRoad = true;
      if (nearRoad) continue;
      const ground = heightAt(bx, bz);
      if (ground < 3) continue;
      const core = Math.max(0, 1 - dn / 0.26);
      const mid = Math.max(0, 1 - dn / 0.6);
      const place = (ox: number, oz: number, w: number, d: number, h: number, style: StructureStyle, tint: number) => {
        const x = bx + ox * cr - oz * sr;
        const z = bz + ox * sr + oz * cr;
        out.push({ style, x, y: heightAt(x, z) - 1.5, z, w, h: h + 1.5, d, rot: -rot, tint });
      };
      if (core > 0 && r[0] < 0.55 + core * 0.4) {
        // downtown: one tower per block, sometimes with a podium neighbour
        const h = 90 + core * 190 * (0.55 + r[1] * 0.75) + r[2] * 50;
        const w = 46 + r[3] * 30;
        const d = 46 + r[4] * 30;
        place((r[5] - 0.5) * (lot - w) * 0.6, (r[6] - 0.5) * (lot - d) * 0.6, w, d, h, 'tower', r[7]);
      } else if (mid > 0 && r[0] < 0.9) {
        const cnt = r[1] < 0.5 ? 2 : 4;
        const half = lot / 4;
        const cells: [number, number][] = cnt === 2 ? [[-half, 0], [half, 0]] : [[-half, -half], [half, -half], [-half, half], [half, half]];
        cells.forEach(([ox, oz], k) => {
          const rr = r[2 + k];
          if (rr < 0.12) return;
          const h = 16 + mid * 70 * (0.3 + rr) + r[6 + (k % 3)] * 14;
          const w = cnt === 2 ? lot / 2 - 8 : lot / 2 - 8;
          const d = cnt === 2 ? lot - 14 : lot / 2 - 8;
          place(ox, oz, w * (0.75 + 0.25 * r[9]), d * (0.75 + 0.25 * rr), h, h > 55 ? 'office' : 'lowrise', (rr + k * 0.37) % 1);
        });
      } else if (r[0] < 0.78) {
        const half = lot / 4;
        const cells: [number, number][] = [[-half, -half], [half, -half], [-half, half], [half, half]];
        cells.forEach(([ox, oz], k) => {
          const rr = r[2 + k];
          if (rr < 0.35) return;
          const industrial = r[8] > 0.82;
          place(ox, oz, lot / 2 - 12 - rr * 8, lot / 2 - 12 - r[9] * 8, industrial ? 9 + rr * 6 : 7 + rr * 15, industrial ? 'industrial' : 'lowrise', (rr * 3.1) % 1);
        });
      }
    }
  }
}

function airportBuildings(a: AirportDef, out: Structure[]): void {
  const ap = apronRect(a);
  const f = runwayFrame(a);
  const rot = -Math.atan2(f.ax, -f.az); // align box depth with runway axis
  const put = (along: number, across: number, w: number, h: number, d: number, style: StructureStyle, tint = 0.5, round = false) => {
    const p = fromRunwayCoords(a, along, across);
    out.push({ style, x: p.x, y: a.elevation - 0.5, z: p.z, w, h: h + 0.5, d, rot, tint, round });
  };
  const back = ap.across1 + 22;
  if (a.kind === 'international') {
    put(0, back + 30, 96, 26, 620, 'terminal', 0.2);
    put(-240, back - 40, 60, 14, 130, 'terminal', 0.4);
    put(240, back - 40, 60, 14, 130, 'terminal', 0.4);
    put(0, back - 40, 60, 14, 130, 'terminal', 0.4);
    put(520, back + 10, 20, 78, 20, 'control', 0.3, true);
    put(-640, back + 20, 90, 24, 110, 'hangar', 0.6);
    put(-780, back + 20, 90, 24, 110, 'hangar', 0.7);
    put(700, back + 30, 70, 18, 90, 'hangar', 0.5);
    put(860, back + 30, 120, 12, 60, 'industrial', 0.3);
  } else if (a.kind === 'regional') {
    put(0, back + 6, 30, 9, 90, 'terminal', 0.3);
    put(110, back + 4, 9, 26, 9, 'control', 0.3, true);
    put(-120, back + 8, 38, 11, 44, 'hangar', 0.6);
    put(-180, back + 8, 38, 11, 44, 'hangar', 0.8);
  } else if (a.kind === 'mountain' || a.kind === 'island') {
    put(0, back, 18, 6, 30, 'terminal', 0.5);
    put(-50, back + 2, 26, 8, 30, 'hangar', 0.7);
    put(45, back, 6, 15, 6, 'control', 0.3, true);
  } else {
    put(0, back, 22, 7, 26, 'hangar', a.kind === 'dirt' ? 0.9 : 0.75);
    put(34, back - 2, 10, 4, 12, 'house', 0.4);
  }
}

function villages(out: Structure[]): void {
  for (const v of VILLAGES) {
    const rnd = makeRng(Math.abs(Math.round(v.x * 7 + v.z * 13)) + 5);
    let placed = 0;
    let guard = 0;
    while (placed < v.houses && guard++ < v.houses * 12) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * v.radius;
      const x = v.x + Math.cos(a) * rr;
      const z = v.z + Math.sin(a) * rr;
      const g = heightAt(x, z);
      if (g < 3) continue;
      // keep airfields clear
      let blocked = false;
      for (const ap of AIRPORTS) {
        if (Math.hypot(x - ap.x, z - ap.z) < ap.length / 2 + ap.pad + 60) {
          const f = runwayFrame(ap);
          const across = Math.abs((x - ap.x) * f.rx + (z - ap.z) * f.rz);
          if (across < ap.pad + 20) blocked = true;
        }
      }
      if (blocked) continue;
      const w = 8 + rnd() * 6;
      const d = 9 + rnd() * 8;
      out.push({ style: 'house', x, y: g - 0.6, z, w, h: 5.5 + rnd() * 3 + 0.6, d, rot: rnd() * Math.PI, tint: rnd() });
      placed++;
    }
    // a church / hall as the village landmark
    const g = heightAt(v.x, v.z);
    if (g > 3) {
      out.push({ style: 'lowrise', x: v.x, y: g - 0.6, z: v.z, w: 12, h: 11, d: 26, rot: 0.4, tint: 0.95 });
      out.push({ style: 'lowrise', x: v.x + 4, y: g - 0.6, z: v.z - 14, w: 6, h: 27, d: 6, rot: 0.4, tint: 0.95 });
    }
  }
}

function bridges(out: Structure[]): void {
  for (const b of BRIDGES) {
    const h = (b.heading * Math.PI) / 180;
    const ax = Math.sin(h);
    const az = -Math.cos(h);
    const rot = -h;
    out.push({ style: 'deck', x: b.x, y: b.deck - 4, z: b.z, w: b.width, h: 4, d: b.length, rot, tint: 0, custom: true });
    if (b.kind === 'suspension') {
      for (const s of [-1, 1]) {
        const x = b.x + ax * s * b.length * 0.27;
        const z = b.z + az * s * b.length * 0.27;
        for (const side of [-1, 1]) {
          const px = x + Math.cos(h) * side * (b.width / 2 + 2);
          const pz = z + Math.sin(h) * side * (b.width / 2 + 2);
          out.push({ style: 'pylon', x: px, y: -8, z: pz, w: 7, h: b.tower + 8, d: 9, rot, tint: 0, custom: true });
        }
      }
    } else {
      for (let k = -3; k <= 3; k++) {
        out.push({ style: 'pylon', x: b.x + ax * k * (b.length / 8), y: -8, z: b.z + az * k * (b.length / 8), w: 4, h: b.deck + 4, d: 5, rot, tint: 0, custom: true });
      }
    }
  }
}

function landmarks(out: Structure[]): void {
  for (const l of LANDMARKS) {
    const g = Math.max(0, heightAt(l.x, l.z));
    switch (l.kind) {
      case 'spire':
        out.push({ style: 'landmark', x: l.x, y: g - 2, z: l.z, w: 44, h: 430, d: 44, rot: 0, tint: 0, round: true, custom: true });
        break;
      case 'stadium':
        out.push({ style: 'landmark', x: l.x, y: g - 2, z: l.z, w: 250, h: 42, d: 250, rot: 0, tint: 0, round: true, custom: true });
        break;
      case 'lighthouse':
        out.push({ style: 'landmark', x: l.x, y: g - 1, z: l.z, w: 9, h: 46, d: 9, rot: 0, tint: 0, round: true, custom: true });
        break;
      case 'observatory':
        out.push({ style: 'landmark', x: l.x, y: g - 2, z: l.z, w: 34, h: 26, d: 34, rot: 0, tint: 0, round: true, custom: true });
        break;
      case 'radiotower':
        out.push({ style: 'landmark', x: l.x, y: g - 2, z: l.z, w: 6, h: 190, d: 6, rot: 0, tint: 0, custom: true });
        break;
      case 'turbines':
        for (const t of turbinePositions()) out.push({ style: 'landmark', x: t.x, y: t.y - 1, z: t.z, w: 4.5, h: 92, d: 4.5, rot: 0, tint: 0, round: true, custom: true });
        break;
      case 'arch':
        for (const s of [-1, 1]) out.push({ style: 'landmark', x: l.x + s * 95, y: g - 4, z: l.z, w: 46, h: 120, d: 50, rot: 0, tint: 0, custom: true });
        out.push({ style: 'landmark', x: l.x, y: g + 92, z: l.z, w: 236, h: 30, d: 44, rot: 0, tint: 0, custom: true });
        break;
      default:
        break;
    }
  }
}

export function turbinePositions(): { x: number; y: number; z: number; phase: number }[] {
  const lm = LANDMARKS.find((l) => l.kind === 'turbines')!;
  const res: { x: number; y: number; z: number; phase: number }[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = lm.x + (i - 1.5) * 420 + (j % 2) * 160;
      const z = lm.z + (j - 1.5) * 380;
      res.push({ x, y: heightAt(x, z), z, phase: (i * 4 + j) * 1.37 });
    }
  }
  return res;
}

/** All solid structures in the world (memoised). */
export function getStructures(): Structure[] {
  if (cache) return cache;
  const out: Structure[] = [];
  cityBuildings(out);
  for (const a of AIRPORTS) airportBuildings(a, out);
  villages(out);
  bridges(out);
  landmarks(out);
  cache = out;
  return out;
}
