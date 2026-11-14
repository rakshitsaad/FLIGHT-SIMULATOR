/**
 * Aircraft definitions. Every aircraft has its own mass properties, engine,
 * aerodynamic coefficients, stability derivatives, landing gear geometry and
 * limits — the flight model contains no per-aircraft special cases.
 *
 * Body axes: +x right wing, +y up, -z nose. Origin = centre of gravity.
 * Control derivatives are expressed per unit of normalised stick travel.
 */
import type { AircraftId, Vec3 } from '../../types';

export interface ContactPoint extends Vec3 {
  kind: 'gear' | 'hull' | 'float';
  steer?: boolean;
  brake?: boolean;
  label: string;
}

export interface AircraftSpec {
  id: AircraftId;
  name: string;
  className: string;
  description: string;
  traits: string[];

  /* mass */
  emptyMass: number; // kg incl. pilot
  fuelCapacity: number; // kg
  fuelBurnFull: number; // kg/s at full power (accelerated for gameplay)
  inertia: { pitch: number; yaw: number; roll: number }; // kg m²

  /* wing */
  wingArea: number; // m²
  wingSpan: number; // m
  chord: number; // m

  /* lift & drag */
  cl0: number;
  clAlpha: number; // per rad
  alphaStall: number; // rad, clean
  alphaStallNeg: number; // rad (positive number)
  stallSharpness: number; // sigmoid steepness: high = abrupt stall
  clPost: number; // post-stall lift scale
  clFlap: number; // ΔCL at full flap
  flapStallShift: number; // rad the stall angle drops with full flap
  cd0: number;
  inducedK: number;
  cdFlap: number;
  cdGear: number;
  machDrag: number; // extra CD approaching Mach 1 (jets)

  /* engine */
  engineType: 'piston' | 'turboprop' | 'jet';
  engineCount: number;
  maxPower: number; // W total (propeller aircraft)
  propEfficiency: number;
  staticThrust: number; // N total (prop: at standstill, jet: max)
  densityExponent: number;
  idleThrust: number; // fraction of max
  spoolTime: number; // s
  rpmIdle: number;
  rpmMax: number;
  rpmLabel: string;
  propwash: number; // extra dynamic pressure over the tail from thrust

  /* stability & control */
  cm0: number;
  cmAlpha: number;
  cmQ: number;
  cmDe: number;
  cmFlap: number;
  clBeta: number;
  clP: number;
  clR: number;
  clDa: number;
  cnBeta: number;
  cnR: number;
  cnP: number;
  cnDr: number;
  cnDa: number;
  cyBeta: number;
  /** Above this airspeed pitch/roll authority is scaled back (stick force / g-limit). */
  cornerSpeed: number;
  /** How violently a wing drops at the stall (0 = benign). */
  stallRoll: number;

  /* limits */
  maxG: number;
  vne: number; // m/s indicated
  vApproach: number; // m/s reference touchdown speed
  maxSinkRate: number; // m/s the gear tolerates

  /* systems */
  flapNotches: number[];
  flapTime: number;
  gearTime: number;
  brakeMu: number;
  maxSteer: number; // rad
  amphibious: boolean;

  /* ground contact */
  cgHeight: number; // CG above ground at rest
  gearCompression: number; // static strut compression m
  gearDamping: number; // damping ratio
  contacts: ContactPoint[];

  /* presentation */
  eye: Vec3; // pilot eye point
  chase: { distance: number; height: number };
  color: { primary: string; secondary: string; accent: string };
  stats: { speed: number; agility: number; stability: number; range: number; stol: number };
}

const DEG = Math.PI / 180;

const trainer: AircraftSpec = {
  id: 'trainer',
  name: 'AT-1 Kestrel',
  className: 'Single-engine trainer',
  description: 'Forgiving, honest and slow enough to think. The perfect aircraft for learning one-hand flight.',
  traits: ['Gentle stall', 'Short take-off', 'Stable'],
  emptyMass: 940,
  fuelCapacity: 110,
  fuelBurnFull: 0.04,
  inertia: { pitch: 1825, yaw: 2667, roll: 1285 },
  wingArea: 16.2,
  wingSpan: 10.9,
  chord: 1.49,
  cl0: 0.3,
  clAlpha: 5.0,
  alphaStall: 15.5 * DEG,
  alphaStallNeg: 12 * DEG,
  stallSharpness: 38,
  clPost: 1.02,
  clFlap: 0.55,
  flapStallShift: 2 * DEG,
  cd0: 0.031,
  inducedK: 0.054,
  cdFlap: 0.055,
  cdGear: 0.012,
  machDrag: 0,
  engineType: 'piston',
  engineCount: 1,
  maxPower: 134000,
  propEfficiency: 0.8,
  staticThrust: 2700,
  densityExponent: 1.0,
  idleThrust: 0.03,
  spoolTime: 0.55,
  rpmIdle: 750,
  rpmMax: 2700,
  rpmLabel: 'RPM',
  propwash: 0.55,
  cm0: 0.012,
  cmAlpha: -0.9,
  cmQ: -12.5,
  cmDe: 0.225,
  cmFlap: -0.02,
  clBeta: -0.09,
  clP: -0.47,
  clR: 0.096,
  clDa: 0.074,
  cnBeta: 0.07,
  cnR: -0.11,
  cnP: -0.03,
  cnDr: 0.019,
  cnDa: -0.006,
  cyBeta: -0.5,
  cornerSpeed: 50,
  stallRoll: 0.35,
  maxG: 4.4,
  vne: 84,
  vApproach: 33,
  maxSinkRate: 3.3,
  flapNotches: [0, 0.33, 0.66, 1],
  flapTime: 3.5,
  gearTime: 3.2,
  brakeMu: 0.5,
  maxSteer: 28 * DEG,
  amphibious: false,
  cgHeight: 1.18,
  gearCompression: 0.12,
  gearDamping: 0.6,
  contacts: [
    { kind: 'gear', label: 'nose', x: 0, y: -1.3, z: -1.6, steer: true },
    { kind: 'gear', label: 'left', x: -1.3, y: -1.3, z: 0.38, brake: true },
    { kind: 'gear', label: 'right', x: 1.3, y: -1.3, z: 0.38, brake: true },
    { kind: 'hull', label: 'nose', x: 0, y: -0.25, z: -2.6 },
    { kind: 'hull', label: 'belly', x: 0, y: -0.62, z: 0 },
    { kind: 'hull', label: 'tail', x: 0, y: -0.1, z: 4.4 },
    { kind: 'hull', label: 'left wing', x: -5.4, y: -0.25, z: 0.2 },
    { kind: 'hull', label: 'right wing', x: 5.4, y: -0.25, z: 0.2 },
    { kind: 'hull', label: 'fin', x: 0, y: 1.75, z: 4.2 },
    { kind: 'hull', label: 'canopy', x: 0, y: 0.95, z: -0.3 },
  ],
  eye: { x: 0, y: 0.62, z: -0.35 },
  chase: { distance: 13, height: 3.4 },
  color: { primary: '#f4f6f8', secondary: '#1f6fd6', accent: '#f2b33d' },
  stats: { speed: 0.3, agility: 0.45, stability: 0.9, range: 0.5, stol: 0.75 },
};

const sport: AircraftSpec = {
  id: 'sport',
  name: 'SR-2 Marlin',
  className: 'Amphibious sport aircraft',
  description: 'A featherweight pusher with a boat hull. Lands on runways, lagoons and anything in between.',
  traits: ['Water landings', 'Very agile', 'Slow & light'],
  emptyMass: 560,
  fuelCapacity: 62,
  fuelBurnFull: 0.026,
  inertia: { pitch: 900, yaw: 1500, roll: 760 },
  wingArea: 12.6,
  wingSpan: 10.4,
  chord: 1.21,
  cl0: 0.34,
  clAlpha: 5.1,
  alphaStall: 16.5 * DEG,
  alphaStallNeg: 12 * DEG,
  stallSharpness: 30,
  clPost: 1.05,
  clFlap: 0.5,
  flapStallShift: 2 * DEG,
  cd0: 0.04,
  inducedK: 0.05,
  cdFlap: 0.05,
  cdGear: 0.01,
  machDrag: 0,
  engineType: 'piston',
  engineCount: 1,
  maxPower: 78000,
  propEfficiency: 0.78,
  staticThrust: 1750,
  densityExponent: 1.0,
  idleThrust: 0.03,
  spoolTime: 0.45,
  rpmIdle: 1400,
  rpmMax: 5500,
  rpmLabel: 'RPM',
  propwash: 0.2,
  cm0: 0.01,
  cmAlpha: -0.8,
  cmQ: -10.5,
  cmDe: 0.22,
  cmFlap: -0.02,
  clBeta: -0.1,
  clP: -0.44,
  clR: 0.09,
  clDa: 0.09,
  cnBeta: 0.075,
  cnR: -0.12,
  cnP: -0.028,
  cnDr: 0.022,
  cnDa: -0.005,
  cyBeta: -0.55,
  cornerSpeed: 42,
  stallRoll: 0.2,
  maxG: 4.8,
  vne: 68,
  vApproach: 28,
  maxSinkRate: 3.6,
  flapNotches: [0, 0.5, 1],
  flapTime: 2.5,
  gearTime: 2.6,
  brakeMu: 0.5,
  maxSteer: 30 * DEG,
  amphibious: true,
  cgHeight: 0.98,
  gearCompression: 0.1,
  gearDamping: 0.6,
  contacts: [
    { kind: 'gear', label: 'nose', x: 0, y: -1.08, z: -1.45, steer: true },
    { kind: 'gear', label: 'left', x: -0.95, y: -1.08, z: 0.3, brake: true },
    { kind: 'gear', label: 'right', x: 0.95, y: -1.08, z: 0.3, brake: true },
    { kind: 'float', label: 'bow', x: 0, y: -0.72, z: -1.7 },
    { kind: 'float', label: 'step', x: 0, y: -0.82, z: 0.1 },
    { kind: 'float', label: 'stern', x: 0, y: -0.6, z: 1.6 },
    { kind: 'float', label: 'left sponson', x: -1.5, y: -0.66, z: 0.1 },
    { kind: 'float', label: 'right sponson', x: 1.5, y: -0.66, z: 0.1 },
    { kind: 'hull', label: 'nose', x: 0, y: -0.2, z: -2.5 },
    { kind: 'hull', label: 'belly', x: 0, y: -0.7, z: 0 },
    { kind: 'hull', label: 'tail', x: 0, y: 0.3, z: 4.1 },
    { kind: 'hull', label: 'left wing', x: -5.2, y: 0.55, z: 0.2 },
    { kind: 'hull', label: 'right wing', x: 5.2, y: 0.55, z: 0.2 },
    { kind: 'hull', label: 'fin', x: 0, y: 1.9, z: 4.0 },
  ],
  eye: { x: 0, y: 0.5, z: -0.75 },
  chase: { distance: 12, height: 3.2 },
  color: { primary: '#ffb21a', secondary: '#1b2530', accent: '#ffffff' },
  stats: { speed: 0.2, agility: 0.7, stability: 0.7, range: 0.35, stol: 0.9 },
};

const turboprop: AircraftSpec = {
  id: 'turboprop',
  name: 'TT-6 Albatross',
  className: 'Twin-engine turboprop',
  description: 'Heavy, powerful and smooth. Needs planning, long runways and respect for its momentum.',
  traits: ['High cruise', 'Heavy handling', 'Long landing roll'],
  emptyMass: 4350,
  fuelCapacity: 950,
  fuelBurnFull: 0.36,
  inertia: { pitch: 30500, yaw: 50000, roll: 24500 },
  wingArea: 28.2,
  wingSpan: 16.6,
  chord: 1.7,
  cl0: 0.26,
  clAlpha: 5.4,
  alphaStall: 14.5 * DEG,
  alphaStallNeg: 11 * DEG,
  stallSharpness: 55,
  clPost: 0.95,
  clFlap: 0.75,
  flapStallShift: 2.5 * DEG,
  cd0: 0.025,
  inducedK: 0.041,
  cdFlap: 0.07,
  cdGear: 0.016,
  machDrag: 0.01,
  engineType: 'turboprop',
  engineCount: 2,
  maxPower: 1270000,
  propEfficiency: 0.83,
  staticThrust: 18500,
  densityExponent: 0.72,
  idleThrust: 0.04,
  spoolTime: 1.7,
  rpmIdle: 1050,
  rpmMax: 2000,
  rpmLabel: 'PROP RPM',
  propwash: 0.3,
  cm0: 0.01,
  cmAlpha: -1.15,
  cmQ: -17,
  cmDe: 0.275,
  cmFlap: -0.03,
  clBeta: -0.075,
  clP: -0.52,
  clR: 0.1,
  clDa: 0.05,
  cnBeta: 0.095,
  cnR: -0.16,
  cnP: -0.03,
  cnDr: 0.024,
  cnDa: -0.006,
  cyBeta: -0.6,
  cornerSpeed: 82,
  stallRoll: 0.7,
  maxG: 3.4,
  vne: 148,
  vApproach: 54,
  maxSinkRate: 3.0,
  flapNotches: [0, 0.33, 0.66, 1],
  flapTime: 5,
  gearTime: 5,
  brakeMu: 0.45,
  maxSteer: 22 * DEG,
  amphibious: false,
  cgHeight: 1.75,
  gearCompression: 0.16,
  gearDamping: 0.65,
  contacts: [
    { kind: 'gear', label: 'nose', x: 0, y: -1.91, z: -4.1, steer: true },
    { kind: 'gear', label: 'left', x: -2.6, y: -1.91, z: 0.55, brake: true },
    { kind: 'gear', label: 'right', x: 2.6, y: -1.91, z: 0.55, brake: true },
    { kind: 'hull', label: 'nose', x: 0, y: -0.3, z: -6.0 },
    { kind: 'hull', label: 'belly', x: 0, y: -0.95, z: 0 },
    { kind: 'hull', label: 'tail', x: 0, y: 0.2, z: 7.4 },
    { kind: 'hull', label: 'left wing', x: -8.3, y: 0.2, z: 0.4 },
    { kind: 'hull', label: 'right wing', x: 8.3, y: 0.2, z: 0.4 },
    { kind: 'hull', label: 'fin', x: 0, y: 3.6, z: 7.2 },
    { kind: 'hull', label: 'left engine', x: -2.6, y: -0.55, z: -1.9 },
    { kind: 'hull', label: 'right engine', x: 2.6, y: -0.55, z: -1.9 },
  ],
  eye: { x: -0.38, y: 0.75, z: -3.55 },
  chase: { distance: 24, height: 6 },
  color: { primary: '#f1f3f5', secondary: '#c62d2d', accent: '#20303f' },
  stats: { speed: 0.62, agility: 0.25, stability: 0.85, range: 0.9, stol: 0.3 },
};

const jet: AircraftSpec = {
  id: 'jet',
  name: 'FX-9 Peregrine',
  className: 'Fighter-style jet',
  description: 'Violent thrust and a razor roll rate. Small hand movements only — it does exactly what you ask.',
  traits: ['Near-sonic', 'High roll rate', 'Fast approach'],
  emptyMass: 8600,
  fuelCapacity: 2900,
  fuelBurnFull: 3.4,
  inertia: { pitch: 76000, yaw: 86000, roll: 12500 },
  wingArea: 28,
  wingSpan: 9.6,
  chord: 3.3,
  cl0: 0.08,
  clAlpha: 3.6,
  alphaStall: 24 * DEG,
  alphaStallNeg: 16 * DEG,
  stallSharpness: 18,
  clPost: 1.1,
  clFlap: 0.5,
  flapStallShift: 1.5 * DEG,
  cd0: 0.02,
  inducedK: 0.135,
  cdFlap: 0.05,
  cdGear: 0.02,
  machDrag: 0.05,
  engineType: 'jet',
  engineCount: 2,
  maxPower: 0,
  propEfficiency: 0,
  staticThrust: 92000,
  densityExponent: 0.78,
  idleThrust: 0.05,
  spoolTime: 2.6,
  rpmIdle: 28,
  rpmMax: 100,
  rpmLabel: 'N1 %',
  propwash: 0,
  cm0: 0.005,
  cmAlpha: -0.55,
  cmQ: -15,
  cmDe: 0.225,
  cmFlap: -0.01,
  clBeta: -0.06,
  clP: -0.34,
  clR: 0.06,
  clDa: 0.058,
  cnBeta: 0.11,
  cnR: -0.22,
  cnP: -0.02,
  cnDr: 0.022,
  cnDa: -0.003,
  cyBeta: -0.75,
  cornerSpeed: 150,
  stallRoll: 0.25,
  maxG: 8.5,
  vne: 345,
  vApproach: 82,
  maxSinkRate: 4.2,
  flapNotches: [0, 0.5, 1],
  flapTime: 3,
  gearTime: 3.5,
  brakeMu: 0.5,
  maxSteer: 20 * DEG,
  amphibious: false,
  cgHeight: 1.55,
  gearCompression: 0.14,
  gearDamping: 0.65,
  contacts: [
    { kind: 'gear', label: 'nose', x: 0, y: -1.69, z: -4.3, steer: true },
    { kind: 'gear', label: 'left', x: -1.45, y: -1.69, z: 0.75, brake: true },
    { kind: 'gear', label: 'right', x: 1.45, y: -1.69, z: 0.75, brake: true },
    { kind: 'hull', label: 'nose', x: 0, y: -0.15, z: -8.2 },
    { kind: 'hull', label: 'belly', x: 0, y: -0.75, z: 0 },
    { kind: 'hull', label: 'tail', x: 0, y: 0.3, z: 6.2 },
    { kind: 'hull', label: 'left wing', x: -4.8, y: -0.1, z: 2.2 },
    { kind: 'hull', label: 'right wing', x: 4.8, y: -0.1, z: 2.2 },
    { kind: 'hull', label: 'left fin', x: -1.3, y: 2.6, z: 5.6 },
    { kind: 'hull', label: 'right fin', x: 1.3, y: 2.6, z: 5.6 },
    { kind: 'hull', label: 'canopy', x: 0, y: 1.15, z: -3.2 },
  ],
  eye: { x: 0, y: 0.92, z: -3.75 },
  chase: { distance: 22, height: 5 },
  color: { primary: '#8d99a6', secondary: '#4a5663', accent: '#ff7a1a' },
  stats: { speed: 1, agility: 0.95, stability: 0.5, range: 0.6, stol: 0.1 },
};

export const AIRCRAFT: Record<AircraftId, AircraftSpec> = { trainer, sport, turboprop, jet };
export const AIRCRAFT_ORDER: AircraftId[] = ['trainer', 'sport', 'turboprop', 'jet'];

/** Clean and landing-configuration stall speeds at max weight, sea level (m/s). */
export function stallSpeeds(spec: AircraftSpec): { clean: number; landing: number } {
  const m = spec.emptyMass + spec.fuelCapacity;
  const clMax = spec.cl0 + spec.clAlpha * spec.alphaStall;
  const clMaxF = spec.cl0 + spec.clFlap + spec.clAlpha * (spec.alphaStall - spec.flapStallShift);
  const v = (cl: number) => Math.sqrt((2 * m * 9.81) / (1.225 * spec.wingArea * cl));
  return { clean: v(clMax), landing: v(clMaxF) };
}
