/**
 * The simulation core: a fixed-timestep loop that owns the flight model, the
 * weather, collisions, landing evaluation, AI traffic and the flight recorder.
 *
 * Rendering never mutates anything here. Each rendered frame calls
 * `update(realDt)`; the sim advances in fixed 1/60 s steps and exposes an
 * interpolated `view` for the renderer, HUD and audio to read.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftId, AircraftState, FlightCommand, FlightInput, FlightRecord, LandingReport, SurfaceKind } from '../../types';
import { AIRCRAFT, stallSpeeds, type AircraftSpec } from '../aircraft/specs';
import { Traffic } from '../ai/Traffic';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { FlightModel, type FlightEvent } from '../physics/FlightModel';
import type { GroundProvider } from '../physics/environment';
import { FlightRecorder, ReplayPlayer } from '../replay/FlightRecorder';
import { groundPlaneAt, makeSample, regionAt, sampleTerrain } from '../terrain/heightfield';
import { WeatherSystem } from '../weather/WeatherSystem';
import { GATES, SPAWNS, airportSurfaceAt, getAirport, type RegionId, type SpawnPoint } from '../world/aerona';
import { Emitter } from './Emitter';
import { LandingEvaluator } from './LandingEvaluator';

export type SimEvent =
  | FlightEvent
  | { type: 'landing'; report: LandingReport }
  | { type: 'crash'; cause: string }
  | { type: 'region'; region: RegionId }
  | { type: 'gate'; index: number; passed: number }
  | { type: 'spawn'; aircraftId: AircraftId }
  | { type: 'thunder'; strength: number }
  | { type: 'flightSaved'; record: FlightRecord };

export const FIXED_DT = 1 / 60;
const NEUTRAL: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, source: 'none' };

const surfSample = makeSample();
export const terrainGround: GroundProvider = {
  plane: groundPlaneAt,
  surface(x, z, h): SurfaceKind {
    const ap = airportSurfaceAt(x, z);
    if (ap) return ap.surface;
    const s = sampleTerrain(x, z, surfSample);
    if (h < 2.6) return 'sand';
    if (s.wBad > 0.5) return 'dirt';
    if (s.wHigh > 0.4) return h > 1700 ? 'snow' : 'rough';
    return 'grass';
  },
};

/** What the renderer / HUD / audio read every frame. */
export interface SimView {
  aircraftId: AircraftId;
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  gear: number;
  flaps: number;
  elevator: number;
  aileron: number;
  rudder: number;
  rpm: number;
  power: number;
  speed: number;
  onGround: boolean;
  visible: boolean;
}

export class Simulation {
  readonly weather = new WeatherSystem();
  readonly traffic = new Traffic();
  readonly recorder = new FlightRecorder();
  readonly events = new Emitter<SimEvent>();
  model: FlightModel = new FlightModel(AIRCRAFT.trainer, terrainGround);
  landing = new LandingEvaluator(AIRCRAFT.trainer);
  collision: CollisionWorld | null = null;
  replay: ReplayPlayer | null = null;

  mode: 'idle' | 'flying' | 'crashed' | 'replay' = 'idle';
  paused = false;
  crashCause: string | null = null;
  lastLanding: LandingReport | null = null;
  lastRecord: FlightRecord | null = null;
  spawn: SpawnPoint = SPAWNS[0];
  region: RegionId = 'metropolis';
  gatesPassed = 0;
  /** Supplies the current control input each fixed step. */
  inputSource: (dt: number) => FlightInput = () => NEUTRAL;
  input: FlightInput = NEUTRAL;
  /** Physics steps executed (for diagnostics). */
  steps = 0;

  readonly view: SimView = {
    aircraftId: 'trainer',
    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    gear: 1,
    flaps: 0,
    elevator: 0,
    aileron: 0,
    rudder: 0,
    rpm: 0,
    power: 0,
    speed: 0,
    onGround: true,
    visible: true,
  };

  private acc = 0;
  private prevPos = new Vector3();
  private prevQuat = new Quaternion();
  private commands: FlightCommand[] = [];
  private regionTimer = 0;
  private lastGate = -1;
  private gatePrev = new Vector3();
  private tmp = new Vector3();
  private recordSaved = false;

  get state(): AircraftState {
    return this.model.state;
  }
  get spec(): AircraftSpec {
    return this.model.spec;
  }

  async initCollision(): Promise<void> {
    if (this.collision) return;
    const { CollisionWorld } = await import('../physics/CollisionWorld');
    this.collision = await CollisionWorld.create();
    this.collision.setAircraft(this.model.spec);
  }

  /** Begin a new flight. */
  start(aircraftId: AircraftId, spawnId: string, assists?: { autoTrim: boolean; autoStart: boolean; stallProtection?: boolean }): void {
    this.finishFlight();
    const spec = AIRCRAFT[aircraftId];
    const spawn = SPAWNS.find((s) => s.id === spawnId) ?? SPAWNS[0];
    this.spawn = spawn;
    this.model = new FlightModel(spec, terrainGround);
    if (assists) {
      this.model.autoTrim = assists.autoTrim;
      this.model.autoStart = assists.autoStart;
      this.model.stallProtection = assists.stallProtection ?? true;
    }
    this.landing = new LandingEvaluator(spec);
    this.replay = null;
    this.placeAtSpawn();
    this.collision?.setAircraft(spec);
    this.collision?.clearDebris();
    this.mode = 'flying';
    this.paused = false;
    this.events.emit({ type: 'spawn', aircraftId });
  }

  private placeAtSpawn(): void {
    const spec = this.model.spec;
    const spawn = this.spawn;
    const ground = Math.max(0, groundPlaneAt(spawn.x, spawn.z).h);
    if (spawn.airborne) {
      const vs = stallSpeeds(spec);
      const alt = Math.max(spawn.altitude ?? 800, ground + 250);
      this.model.reset({ x: spawn.x, y: alt, z: spawn.z, heading: spawn.heading, speed: Math.min(vs.clean * 2.1, spec.vne * 0.7), airborne: true });
      if (spawn.id === 'air-final') {
        // set up for landing
        this.model.command('toggleGear');
        this.model.command('flapsDown');
        this.model.reset({ x: spawn.x, y: alt, z: spawn.z, heading: spawn.heading, speed: spec.vApproach * 1.1, airborne: true });
        this.model.state.gearDown = true;
        this.model.state.gear = 1;
        this.model.state.flapsNotch = 1;
      }
    } else {
      const ap = spawn.airportId ? getAirport(spawn.airportId) : undefined;
      const y = (ap ? ap.elevation : ground) + spec.cgHeight + 0.02;
      this.model.reset({ x: spawn.x, y, z: spawn.z, heading: spawn.heading, speed: 0, airborne: false });
    }
    this.acc = 0;
    this.crashCause = null;
    this.lastLanding = null;
    this.gatesPassed = 0;
    this.lastGate = -1;
    this.recordSaved = false;
    this.prevPos.copy(this.model.pos);
    this.prevQuat.copy(this.model.quat);
    this.gatePrev.copy(this.model.pos);
    this.landing.reset(spawn.airborne);
    this.recorder.start(spec.id, spawn.label, this.model.state);
    this.region = regionAt(spawn.x, spawn.z);
    this.syncView(1);
  }

  /** Park an aircraft at a spawn point without flying it (menu / hangar backdrop). */
  preview(aircraftId: AircraftId, spawnId: string): void {
    this.finishFlight();
    this.collision?.clearDebris();
    const spawn = SPAWNS.find((s) => s.id === spawnId && !s.airborne) ?? SPAWNS[0];
    this.spawn = spawn;
    this.model = new FlightModel(AIRCRAFT[aircraftId], terrainGround);
    this.replay = null;
    this.placeAtSpawn();
    this.mode = 'idle';
    this.paused = false;
  }

  /** Put the same aircraft back at its spawn point (after a crash, or on request). */
  respawn(): void {
    if (this.mode === 'replay') return;
    this.finishFlight();
    this.collision?.clearDebris();
    this.placeAtSpawn();
    this.mode = 'flying';
    this.paused = false;
    this.events.emit({ type: 'spawn', aircraftId: this.model.spec.id });
  }

  /** Close out the current recording and hand it to whoever persists flights. */
  finishFlight(): FlightRecord | null {
    if (this.mode !== 'flying' && this.mode !== 'crashed') return null;
    if (this.recordSaved || !this.recorder.meaningful) return null;
    this.recordSaved = true;
    const rec = this.recorder.finish();
    this.lastRecord = rec;
    this.events.emit({ type: 'flightSaved', record: rec });
    return rec;
  }

  stop(): void {
    this.finishFlight();
    this.mode = 'idle';
    this.replay = null;
  }

  command(cmd: FlightCommand): void {
    this.commands.push(cmd);
  }

  startReplay(record: FlightRecord): void {
    this.finishFlight();
    this.collision?.clearDebris();
    this.replay = new ReplayPlayer(record);
    this.mode = 'replay';
    this.paused = false;
    this.view.aircraftId = record.aircraftId;
    this.view.visible = true;
    this.syncReplayView();
  }

  /* ---------------------------------------------------------------- loop */

  update(realDt: number): void {
    // up to 0.25 s per frame keeps the sim in real time down to 4 fps
    const dt = Math.min(realDt, 0.25);
    if (this.paused) return;
    if (this.mode === 'replay') {
      if (this.replay) {
        this.replay.update(dt);
        this.syncReplayView();
      }
      this.weather.update(dt, this.view.position.x, this.view.position.z);
      this.traffic.update(dt);
      return;
    }
    if (this.mode === 'idle') {
      this.weather.update(dt, this.view.position.x, this.view.position.z);
      this.traffic.update(dt);
      return;
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED_DT && n < 15) {
      this.step(FIXED_DT);
      this.acc -= FIXED_DT;
      n++;
    }
    if (n === 15) this.acc = 0; // spiral-of-death guard
    this.syncView(this.acc / FIXED_DT);
  }

  private step(dt: number): void {
    this.steps++;
    const m = this.model;
    this.weather.update(dt, m.pos.x, m.pos.z);
    this.traffic.update(dt);
    if (this.weather.thunder > 0) this.events.emit({ type: 'thunder', strength: this.weather.thunder });

    if (this.mode === 'crashed') {
      this.collision?.step(dt);
      return;
    }

    this.prevPos.copy(m.pos);
    this.prevQuat.copy(m.quat);

    this.input = this.inputSource(dt);
    while (this.commands.length) {
      const c = this.commands.shift()!;
      if (c === 'resetAircraft') {
        this.respawn();
        return;
      }
      m.command(c);
    }

    m.step(dt, this.input, this.weather);

    // structures (Rapier) — only worth asking near the ground
    if (this.collision && !m.state.destroyed && m.state.altitudeAgl < 520) {
      const hit = this.collision.test(m.pos, m.quat);
      if (hit && m.vel.length() > 3) m.collide(structureName(hit.style));
    }
    this.checkGates();

    const evs = m.events;
    const report = this.landing.update(dt, m.state, evs);
    for (let i = 0; i < evs.length; i++) this.events.emit(evs[i]);
    const destroyed = evs.find((e) => e.type === 'destroyed');
    evs.length = 0;

    this.recorder.update(dt, m.state, this.input.source);

    if (report) {
      this.lastLanding = report;
      this.recorder.landing = report;
      this.events.emit({ type: 'landing', report });
    }
    if (destroyed && destroyed.type === 'destroyed') {
      this.mode = 'crashed';
      this.crashCause = destroyed.cause;
      this.recorder.crashed = true;
      const ground = Math.max(0, groundPlaneAt(m.pos.x, m.pos.z).h);
      this.collision?.spawnDebris(m.spec, m.pos, m.quat, m.vel, ground, this.weather.gravity);
      this.events.emit({ type: 'crash', cause: destroyed.cause });
      this.finishFlight();
    }

    this.regionTimer += dt;
    if (this.regionTimer > 1.5) {
      this.regionTimer = 0;
      const r = regionAt(m.pos.x, m.pos.z);
      if (r !== this.region) {
        this.region = r;
        this.events.emit({ type: 'region', region: r });
      }
    }
  }

  /** Zephyr Gates: fly through the rings; clip the rim and you crash. */
  private checkGates(): void {
    const p = this.model.pos;
    for (let i = 0; i < GATES.length; i++) {
      const g = GATES[i];
      const dx = p.x - g.x;
      const dz = p.z - g.z;
      if (dx * dx + dz * dz > 250 * 250) continue;
      const h = (g.heading * Math.PI) / 180;
      const nx = Math.sin(h);
      const nz = -Math.cos(h);
      const d1 = dx * nx + dz * nz;
      const d0 = (this.gatePrev.x - g.x) * nx + (this.gatePrev.z - g.z) * nz;
      if (d0 * d1 < 0) {
        // crossed the ring plane this step
        const lx = dx - nx * d1;
        const lz = dz - nz * d1;
        const radial = Math.hypot(lx, lz, p.y - g.y);
        if (radial < g.radius - 4) {
          if (this.lastGate !== i) {
            this.lastGate = i;
            this.gatesPassed++;
            this.events.emit({ type: 'gate', index: i, passed: this.gatesPassed });
          }
        } else if (radial < g.radius + 7) {
          this.model.collide('clipped a Zephyr gate');
        }
      }
    }
    this.gatePrev.copy(p);
  }

  private syncView(alpha: number): void {
    const m = this.model;
    const s = m.state;
    const v = this.view;
    v.aircraftId = m.spec.id;
    if (this.mode === 'crashed') {
      v.position.copy(m.pos);
      v.quaternion.copy(m.quat);
      v.visible = false;
    } else {
      v.position.lerpVectors(this.prevPos, m.pos, alpha);
      v.quaternion.slerpQuaternions(this.prevQuat, m.quat, alpha);
      v.visible = true;
    }
    v.velocity.copy(m.vel);
    v.gear = s.gear;
    v.flaps = s.flaps;
    v.elevator = s.elevator;
    v.aileron = s.aileron;
    v.rudder = s.rudder;
    v.rpm = s.rpm;
    v.power = s.enginePower;
    v.speed = s.airspeed;
    v.onGround = s.onGround;
  }

  private syncReplayView(): void {
    const r = this.replay;
    if (!r) return;
    const v = this.view;
    const f = r.frame;
    const last = this.tmp.copy(v.position);
    v.position.copy(r.position);
    v.quaternion.copy(r.quaternion);
    v.velocity.copy(v.position).sub(last);
    v.gear = f.gear;
    v.flaps = f.flaps;
    v.elevator = f.elevator;
    v.aileron = f.aileron;
    v.rudder = f.rudder;
    v.rpm = f.rpm;
    v.power = f.throttle;
    v.speed = f.speed;
    v.onGround = f.onGround;
    v.visible = true;
  }
}

function structureName(style: string): string {
  switch (style) {
    case 'tower':
    case 'office':
      return 'collided with a skyscraper';
    case 'pylon':
    case 'deck':
      return 'collided with a bridge';
    case 'terminal':
    case 'hangar':
    case 'control':
      return 'collided with an airport building';
    case 'landmark':
      return 'collided with a landmark';
    default:
      return 'collided with a building';
  }
}

/** The single simulation instance shared by the whole app. */
export const sim = new Simulation();
