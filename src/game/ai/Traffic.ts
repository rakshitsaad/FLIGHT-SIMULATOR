/**
 * Lightweight living world: AI aircraft flying fixed routes between the
 * airports of AERONA. Purely kinematic (a closed spline per aircraft), so
 * the cost is a handful of spline evaluations per frame.
 */
import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three';
import type { AircraftId } from '../../types';
import { AIRPORTS, fromRunwayCoords, getAirport, type AirportDef } from '../world/aerona';

export interface AiAircraft {
  id: number;
  model: AircraftId;
  curve: CatmullRomCurve3;
  length: number;
  speed: number;
  /** 0..1 along the route. */
  u: number;
  position: Vector3;
  quaternion: Quaternion;
  color: number;
}

function pattern(a: AirportDef, alt: number, out: Vector3[], dir: 1 | -1): void {
  // final approach → low pass along the runway → climb out
  for (const [along, h] of [[-4200, alt * 0.6], [-1800, 120], [-a.length / 2, 25], [a.length / 2, 30], [2400, alt * 0.5]] as [number, number][]) {
    const p = fromRunwayCoords(a, along * dir, 0);
    out.push(new Vector3(p.x, a.elevation + h, p.z));
  }
}

function route(ids: string[], alt: number): CatmullRomCurve3 {
  const pts: Vector3[] = [];
  ids.forEach((id, i) => {
    const a = getAirport(id)!;
    pattern(a, alt, pts, i % 2 === 0 ? 1 : -1);
    const b = getAirport(ids[(i + 1) % ids.length])!;
    pts.push(new Vector3((a.x + b.x) / 2 + (i % 2 ? 2500 : -2500), Math.max(a.elevation, b.elevation) + alt + 600, (a.z + b.z) / 2 + 1500));
  });
  return new CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

const m = new Matrix4();
const fwd = new Vector3();
const up = new Vector3();
const right = new Vector3();
const ahead = new Vector3();
const roll = new Quaternion();
const Z = new Vector3(0, 0, 1);

export class Traffic {
  readonly aircraft: AiAircraft[] = [];

  constructor() {
    const defs: { ids: string[]; alt: number; model: AircraftId; speed: number; u: number; color: number }[] = [
      { ids: ['aia', 'greenbelt'], alt: 900, model: 'turboprop', speed: 95, u: 0.1, color: 0x2f6fd0 },
      { ids: ['aia', 'coral', 'zephyr'], alt: 1400, model: 'turboprop', speed: 105, u: 0.55, color: 0xd04b2f },
      { ids: ['greenbelt', 'willowbrook', 'stonegate'], alt: 700, model: 'trainer', speed: 52, u: 0.3, color: 0x2fae6a },
      { ids: ['aia', 'drygulch', 'eagle'], alt: 1700, model: 'trainer', speed: 55, u: 0.75, color: 0xe0a020 },
      { ids: ['coral', 'aia'], alt: 600, model: 'sport', speed: 44, u: 0.45, color: 0xffb21a },
      { ids: ['zephyr', 'aia', 'greenbelt'], alt: 2600, model: 'jet', speed: 190, u: 0.2, color: 0x8d99a6 },
    ];
    defs.forEach((d, i) => {
      const curve = route(d.ids, d.alt);
      curve.arcLengthDivisions = 400;
      this.aircraft.push({ id: i, model: d.model, curve, length: curve.getLength(), speed: d.speed, u: d.u, position: new Vector3(), quaternion: new Quaternion(), color: d.color });
    });
    this.update(0);
  }

  update(dt: number): void {
    for (const a of this.aircraft) {
      a.u = (a.u + (a.speed * dt) / a.length) % 1;
      a.curve.getPointAt(a.u, a.position);
      a.curve.getTangentAt(a.u, fwd);
      a.curve.getTangentAt((a.u + 60 / a.length) % 1, ahead);
      // bank into the turn in proportion to the heading change ahead
      const turn = fwd.x * ahead.z - fwd.z * ahead.x;
      up.set(0, 1, 0);
      right.crossVectors(fwd, up).normalize();
      up.crossVectors(right, fwd).normalize();
      m.makeBasis(right, up, fwd.clone().negate());
      a.quaternion.setFromRotationMatrix(m);
      roll.setFromAxisAngle(Z, Math.max(-0.7, Math.min(0.7, -turn * 3.2)));
      a.quaternion.multiply(roll);
    }
  }
}

export const AIRPORT_COUNT = AIRPORTS.length;
