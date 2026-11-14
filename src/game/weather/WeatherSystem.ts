/**
 * Weather, atmosphere and time of day. Implements the Environment contract
 * consumed by the flight model, so every setting here has a physical effect:
 * wind moves the air mass, turbulence adds gusts and gust-induced rotation,
 * density scales lift/drag/thrust, gravity scales weight.
 */
import type { WeatherPreset, WeatherState } from '../../types';
import { isaDensity, type Environment, type WindSample } from '../physics/environment';
import { simplex2, smoothstep } from '../terrain/noise';
import { STORM_CELL, stormCellPosition } from '../world/aerona';

export const DEFAULT_WEATHER: WeatherState = {
  preset: 'clear',
  windSpeed: 3,
  windDirection: 250,
  turbulence: 0.05,
  cloudCover: 0.15,
  rain: 0,
  fog: 0,
  lightning: 0,
  timeOfDay: 10.5,
  timeScale: 30,
  airDensityScale: 1,
  gravity: 9.80665,
};

type PresetValues = Pick<WeatherState, 'windSpeed' | 'turbulence' | 'cloudCover' | 'rain' | 'fog' | 'lightning'>;

export const WEATHER_PRESETS: Record<Exclude<WeatherPreset, 'custom'>, PresetValues & { label: string; blurb: string }> = {
  clear: { label: 'Clear', blurb: 'Light winds, unlimited visibility', windSpeed: 3, turbulence: 0.05, cloudCover: 0.15, rain: 0, fog: 0, lightning: 0 },
  cloudy: { label: 'Cloudy', blurb: 'Broken cloud, moderate breeze', windSpeed: 7, turbulence: 0.2, cloudCover: 0.75, rain: 0, fog: 0.05, lightning: 0 },
  rain: { label: 'Rain', blurb: 'Steady rain, reduced visibility', windSpeed: 9, turbulence: 0.3, cloudCover: 0.95, rain: 0.65, fog: 0.3, lightning: 0 },
  fog: { label: 'Fog', blurb: 'Still air, very low visibility', windSpeed: 1.5, turbulence: 0.03, cloudCover: 0.6, rain: 0, fog: 0.88, lightning: 0 },
  storm: { label: 'Storm', blurb: 'Gale, severe turbulence, lightning', windSpeed: 18, turbulence: 0.8, cloudCover: 1, rain: 1, fog: 0.4, lightning: 1 },
};

const DEG = Math.PI / 180;

export class WeatherSystem implements Environment {
  /** Live values (smoothly follow `target`). */
  readonly state: WeatherState = { ...DEFAULT_WEATHER };
  /** Values the weather is moving towards. */
  readonly target: WeatherState = { ...DEFAULT_WEATHER };
  /** Simulation clock in seconds (drives gusts and the storm cell). */
  time = 0;
  /** 0..1 brightness of the current lightning flash. */
  flash = 0;
  /** Set when a lightning strike happened this update (consumed by audio). */
  thunder = 0;
  /** 0..1 how deep the player is inside the roaming Open Sky storm cell. */
  cell = 0;
  private nextStrike = 4;
  private px = 0;
  private pz = 0;

  get gravity(): number {
    return this.state.gravity;
  }

  densityAt(altitude: number): number {
    return isaDensity(altitude) * this.state.airDensityScale;
  }

  windAt(x: number, y: number, z: number, t: number, out: WindSample): void {
    const s = this.state;
    const dir = s.windDirection * DEG;
    // boundary-layer profile: slower near the surface, stronger aloft
    const prof = Math.min(1.45, 0.5 + 0.5 * Math.pow(Math.max(y, 0) / 350, 0.38));
    const cell = this.cellAt(x, z);
    const speed = (s.windSpeed + cell * 14) * prof;
    let wx = -Math.sin(dir) * speed;
    let wz = Math.cos(dir) * speed;
    let wy = 0;
    const turb = Math.min(1, s.turbulence + cell * 0.75);
    if (turb > 0.001) {
      const amp = turb * (2.2 + 0.32 * speed);
      const tt = this.time;
      const k = 1 / 210;
      wx += amp * simplex2(x * k + tt * 0.31, z * k - tt * 0.17);
      wz += amp * simplex2(x * k - tt * 0.23 + 40, z * k + tt * 0.29 + 13);
      const ground = Math.min(1, Math.max(y, 0) / 60 + 0.25);
      wy = amp * 0.8 * ground * simplex2(x * k * 1.7 + tt * 0.41 + 90, z * k * 1.7 - 50) - cell * 5 * ground * (0.5 + 0.5 * simplex2(x / 900, z / 900 + tt * 0.05));
      const rot = turb * 0.55;
      out.gp = rot * simplex2(tt * 1.3 + x * k, 7.1) * 0.6;
      out.gq = rot * simplex2(tt * 1.1 + 31.4, z * k) * 0.22;
      out.gr = rot * simplex2(tt * 0.9 + 77.7, x * k + 5) * 0.2;
    } else {
      out.gp = out.gq = out.gr = 0;
    }
    out.x = wx;
    out.y = wy;
    out.z = wz;
  }

  /** Storm-cell intensity at a point, 0..1. */
  cellAt(x: number, z: number): number {
    const d = Math.hypot(x - this.px, z - this.pz);
    return d > STORM_CELL.radius ? 0 : smoothstep(STORM_CELL.radius, STORM_CELL.radius * 0.45, d);
  }

  get stormCell(): { x: number; z: number; radius: number } {
    return { x: this.px, z: this.pz, radius: STORM_CELL.radius };
  }

  setPreset(p: Exclude<WeatherPreset, 'custom'>): void {
    const v = WEATHER_PRESETS[p];
    Object.assign(this.target, { windSpeed: v.windSpeed, turbulence: v.turbulence, cloudCover: v.cloudCover, rain: v.rain, fog: v.fog, lightning: v.lightning, preset: p });
    this.state.preset = p;
  }

  /** Directly set one or more values (sliders). */
  set(patch: Partial<WeatherState>, immediate = false): void {
    Object.assign(this.target, patch);
    if ('preset' in patch === false) this.target.preset = this.state.preset = 'custom';
    if (immediate) Object.assign(this.state, patch);
    // these never glide
    for (const k of ['timeOfDay', 'timeScale', 'gravity', 'airDensityScale', 'windDirection'] as const) {
      if (patch[k] !== undefined) this.state[k] = patch[k] as number;
    }
  }

  reset(): void {
    Object.assign(this.target, DEFAULT_WEATHER);
    Object.assign(this.state, DEFAULT_WEATHER);
  }

  update(dt: number, px: number, pz: number): void {
    this.time += dt;
    const s = this.state;
    const t = this.target;
    const k = Math.min(1, dt / 2.5);
    s.windSpeed += (t.windSpeed - s.windSpeed) * k;
    s.turbulence += (t.turbulence - s.turbulence) * k;
    s.cloudCover += (t.cloudCover - s.cloudCover) * k;
    s.rain += (t.rain - s.rain) * k;
    s.fog += (t.fog - s.fog) * k;
    s.lightning += (t.lightning - s.lightning) * k;
    s.timeOfDay = (s.timeOfDay + (dt * s.timeScale) / 3600 + 24) % 24;
    t.timeOfDay = s.timeOfDay;

    const c = stormCellPosition(this.time);
    this.px = c.x;
    this.pz = c.z;
    this.cell = this.cellAt(px, pz);

    // lightning
    this.flash = Math.max(0, this.flash - dt * 5);
    this.thunder = 0;
    const activity = Math.max(s.lightning, this.cell);
    if (activity > 0.15) {
      this.nextStrike -= dt * activity;
      if (this.nextStrike <= 0) {
        this.nextStrike = 2.5 + Math.random() * 9;
        this.flash = 1;
        this.thunder = 0.4 + Math.random() * 0.6;
      }
    }
  }

  /* ----------------------------------------------------- derived visuals */

  /** Rain intensity at the player including the storm cell. */
  get localRain(): number {
    return Math.min(1, this.state.rain + this.cell);
  }
  get localCloud(): number {
    return Math.min(1, this.state.cloudCover + this.cell * 0.8);
  }
  get localTurbulence(): number {
    return Math.min(1, this.state.turbulence + this.cell * 0.75);
  }

  /** Unit vector pointing at the sun. */
  sunDirection(out: { x: number; y: number; z: number }): void {
    const a = (this.state.timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a);
    const y = Math.sin(a);
    const z = 0.38;
    const l = Math.hypot(x, y, z);
    out.x = x / l;
    out.y = y / l;
    out.z = z / l;
  }

  /** 0 = full day, 1 = night. */
  get night(): number {
    const a = (this.state.timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
    return smoothstep(0.1, -0.2, Math.sin(a));
  }

  /** Meteorological visibility in metres. */
  get visibility(): number {
    const s = this.state;
    const fog = Math.min(1, s.fog + this.cell * 0.35);
    const clearVis = 52000 * (1 - 0.72 * this.localRain) * (1 - 0.35 * s.cloudCover);
    return 260 + clearVis * Math.pow(1 - fog, 3.2);
  }
}
