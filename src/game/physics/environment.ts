/**
 * What the flight model needs to know about the outside world. The weather
 * system and the terrain implement these; unit tests substitute simple ones.
 */
import type { SurfaceKind } from '../../types';
import type { GroundPlane } from '../terrain/heightfield';

export interface WindSample {
  x: number;
  y: number;
  z: number;
  /** Gust-induced rotation rates (rad/s) about roll / pitch / yaw. */
  gp: number;
  gq: number;
  gr: number;
}

export interface Environment {
  gravity: number;
  /** Air density (kg/m³) at an altitude in metres MSL. */
  densityAt(altitude: number): number;
  /** Wind velocity (world frame) and gust rates at a point. */
  windAt(x: number, y: number, z: number, t: number, out: WindSample): void;
}

export interface GroundProvider {
  plane(x: number, z: number, out: GroundPlane): GroundPlane;
  surface(x: number, z: number, h: number): SurfaceKind;
}

export const RHO0 = 1.225;

/** International Standard Atmosphere density (troposphere). */
export function isaDensity(altitude: number): number {
  const h = altitude < -500 ? -500 : altitude > 18000 ? 18000 : altitude;
  return RHO0 * Math.pow(1 - 2.25577e-5 * h, 4.2559);
}

export function speedOfSound(altitude: number): number {
  const t = 288.15 - 0.0065 * Math.min(Math.max(altitude, 0), 11000);
  return Math.sqrt(1.4 * 287.05 * t);
}

export interface SurfaceProps {
  rollMu: number;
  sideMu: number;
  brakeScale: number;
  /** Roughness: amplitude (m) of bumps felt through the gear. */
  bump: number;
  landable: boolean;
}

export const SURFACES: Record<SurfaceKind, SurfaceProps> = {
  asphalt: { rollMu: 0.02, sideMu: 0.8, brakeScale: 1, bump: 0, landable: true },
  grass: { rollMu: 0.055, sideMu: 0.6, brakeScale: 0.7, bump: 0.015, landable: true },
  dirt: { rollMu: 0.045, sideMu: 0.6, brakeScale: 0.75, bump: 0.02, landable: true },
  sand: { rollMu: 0.13, sideMu: 0.55, brakeScale: 0.7, bump: 0.02, landable: true },
  snow: { rollMu: 0.09, sideMu: 0.35, brakeScale: 0.4, bump: 0.02, landable: true },
  rough: { rollMu: 0.11, sideMu: 0.6, brakeScale: 0.7, bump: 0.05, landable: false },
  water: { rollMu: 0.1, sideMu: 0.45, brakeScale: 0, bump: 0, landable: false },
};

/** Calm standard-day environment (used by tests and as a fallback). */
export const STILL_AIR: Environment = {
  gravity: 9.80665,
  densityAt: isaDensity,
  windAt(_x, _y, _z, _t, out) {
    out.x = out.y = out.z = out.gp = out.gq = out.gr = 0;
  },
};

export const FLAT_GROUND: GroundProvider = {
  plane(_x, _z, out) {
    out.h = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    return out;
  },
  surface: () => 'asphalt',
};
