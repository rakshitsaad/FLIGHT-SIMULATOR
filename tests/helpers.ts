import { AIRCRAFT } from '../src/game/aircraft/specs';
import { FlightModel, type FlightEvent } from '../src/game/physics/FlightModel';
import { FLAT_GROUND, STILL_AIR, type Environment, type GroundProvider } from '../src/game/physics/environment';
import type { AircraftId, AircraftState, FlightInput } from '../src/types';

export const DT = 1 / 60;

export class Rig {
  fm: FlightModel;
  input: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, source: 'keyboard' };
  env: Environment;
  events: FlightEvent[] = [];
  constructor(id: AircraftId, ground: GroundProvider = FLAT_GROUND, env: Environment = STILL_AIR) {
    this.fm = new FlightModel(AIRCRAFT[id], ground);
    this.env = env;
  }
  get s(): AircraftState {
    return this.fm.state;
  }
  ground(heading = 0) {
    this.fm.reset({ x: 0, y: this.fm.spec.cgHeight, z: 0, heading, speed: 0, airborne: false });
  }
  air(alt: number, speed: number, heading = 0) {
    this.fm.reset({ x: 0, y: alt, z: 0, heading, speed, airborne: true });
  }
  /** Run for `seconds`, calling pilot() before each step. Returns false if pilot returns true (stop). */
  run(seconds: number, pilot?: (s: AircraftState, t: number) => boolean | void): void {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      if (pilot && pilot(this.s, i * DT)) break;
      this.fm.step(DT, this.input, this.env);
      if (this.fm.events.length) this.events.push(...this.fm.events.splice(0));
    }
  }
}
