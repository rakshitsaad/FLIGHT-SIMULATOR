import type { PerspectiveCamera, Vector3 } from 'three';
import type { GraphicsConfig } from '../../stores/settingsStore';
import type { WeatherSystem } from '../weather/WeatherSystem';
import type { SimView } from './Simulation';

/** Per-frame context handed to every scene subsystem. */
export interface FrameContext {
  dt: number;
  /** Seconds since the scene started (render clock). */
  time: number;
  camera: PerspectiveCamera;
  weather: WeatherSystem;
  view: SimView;
  cfg: GraphicsConfig;
  /** 0 = day, 1 = night. */
  night: number;
  sun: Vector3;
  /** Far clip distance in metres. */
  far: number;
}

export interface Subsystem {
  update(ctx: FrameContext): void;
  dispose(): void;
}
