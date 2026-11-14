/**
 * Flight data recorder + replay sampler. Frames are plain numbers so a flight
 * can be stored in IndexedDB and replayed without re-running the physics.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftId, AircraftState, FlightRecord, LandingReport, ReplayFrame } from '../../types';

export const RECORD_INTERVAL = 0.1;
const MAX_FRAMES = 12000;

export class FlightRecorder {
  frames: ReplayFrame[] = [];
  private acc = 0;
  private interval = RECORD_INTERVAL;
  private distance = 0;
  private maxAlt = 0;
  private maxSpeed = 0;
  private lastX = 0;
  private lastZ = 0;
  private aircraftId: AircraftId = 'trainer';
  private origin = '';
  private startedAt = 0;
  private handTime = 0;
  private keyTime = 0;
  landing: LandingReport | null = null;
  crashed = false;

  start(aircraftId: AircraftId, origin: string, s: AircraftState): void {
    this.frames = [];
    this.acc = 0;
    this.interval = RECORD_INTERVAL;
    this.distance = 0;
    this.maxAlt = s.altitude;
    this.maxSpeed = 0;
    this.lastX = s.position.x;
    this.lastZ = s.position.z;
    this.aircraftId = aircraftId;
    this.origin = origin;
    this.startedAt = Date.now();
    this.handTime = this.keyTime = 0;
    this.landing = null;
    this.crashed = false;
    this.push(s);
  }

  update(dt: number, s: AircraftState, source: string): void {
    if (source === 'hand' || source === 'mixed') this.handTime += dt;
    else this.keyTime += dt;
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc -= this.interval;
    this.distance += Math.hypot(s.position.x - this.lastX, s.position.z - this.lastZ);
    this.lastX = s.position.x;
    this.lastZ = s.position.z;
    if (s.altitude > this.maxAlt) this.maxAlt = s.altitude;
    if (s.indicatedAirspeed > this.maxSpeed) this.maxSpeed = s.indicatedAirspeed;
    this.push(s);
    if (this.frames.length > MAX_FRAMES) {
      // long flight: halve the sample rate instead of dropping the beginning
      this.frames = this.frames.filter((_, i) => i % 2 === 0);
      this.interval *= 2;
    }
  }

  private push(s: AircraftState): void {
    this.frames.push({
      t: s.time,
      px: s.position.x,
      py: s.position.y,
      pz: s.position.z,
      qx: s.orientation.x,
      qy: s.orientation.y,
      qz: s.orientation.z,
      qw: s.orientation.w,
      speed: s.indicatedAirspeed,
      altitude: s.altitude,
      verticalSpeed: s.verticalSpeed,
      throttle: s.enginePower,
      gear: s.gear,
      flaps: s.flaps,
      elevator: s.elevator,
      aileron: s.aileron,
      rudder: s.rudder,
      rpm: s.rpm,
      onGround: s.onGround,
    });
  }

  get duration(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0;
  }

  /** Whether this flight is worth keeping in the history. */
  get meaningful(): boolean {
    return this.duration > 12 && (this.distance > 150 || this.maxAlt > 30);
  }

  finish(): FlightRecord {
    const total = this.handTime + this.keyTime || 1;
    const share = this.handTime / total;
    return {
      id: `${this.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: this.startedAt,
      aircraftId: this.aircraftId,
      origin: this.origin,
      duration: this.duration,
      distance: this.distance,
      maxAltitude: this.maxAlt,
      maxSpeed: this.maxSpeed,
      landing: this.landing,
      crashed: this.crashed,
      saved: false,
      controlMode: share > 0.8 ? 'hand' : share < 0.2 ? 'keyboard' : 'mixed',
      frames: this.frames.slice(),
    };
  }
}

const qa = new Quaternion();
const qb = new Quaternion();

/** Interpolated playback of a recorded flight. */
export class ReplayPlayer {
  record: FlightRecord;
  time = 0;
  playing = true;
  rate = 1;
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  /** Interpolated frame values for the HUD. */
  frame: ReplayFrame;
  private index = 0;

  constructor(record: FlightRecord) {
    this.record = record;
    this.frame = { ...record.frames[0] };
    this.seek(0);
  }

  get start(): number {
    return this.record.frames[0].t;
  }
  get end(): number {
    return this.record.frames[this.record.frames.length - 1].t;
  }
  get duration(): number {
    return this.end - this.start;
  }

  update(dt: number): void {
    if (!this.playing) return;
    let t = this.time + dt * this.rate;
    if (t >= this.duration) {
      t = this.duration;
      this.playing = false;
    }
    this.seek(t);
  }

  seek(t: number): void {
    const f = this.record.frames;
    this.time = Math.max(0, Math.min(this.duration, t));
    const abs = this.start + this.time;
    let i = this.index;
    if (i >= f.length - 1 || f[i].t > abs) i = 0;
    while (i < f.length - 2 && f[i + 1].t <= abs) i++;
    this.index = i;
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const span = b.t - a.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (abs - a.t) / span)) : 0;
    this.position.set(a.px + (b.px - a.px) * k, a.py + (b.py - a.py) * k, a.pz + (b.pz - a.pz) * k);
    qa.set(a.qx, a.qy, a.qz, a.qw);
    qb.set(b.qx, b.qy, b.qz, b.qw);
    this.quaternion.slerpQuaternions(qa, qb, k);
    const o = this.frame;
    const l = (x: number, y: number) => x + (y - x) * k;
    o.t = abs;
    o.px = this.position.x;
    o.py = this.position.y;
    o.pz = this.position.z;
    o.speed = l(a.speed, b.speed);
    o.altitude = l(a.altitude, b.altitude);
    o.verticalSpeed = l(a.verticalSpeed, b.verticalSpeed);
    o.throttle = l(a.throttle, b.throttle);
    o.gear = l(a.gear, b.gear);
    o.flaps = l(a.flaps, b.flaps);
    o.elevator = l(a.elevator, b.elevator);
    o.aileron = l(a.aileron, b.aileron);
    o.rudder = l(a.rudder, b.rudder);
    o.rpm = l(a.rpm, b.rpm);
    o.onGround = a.onGround;
  }
}
