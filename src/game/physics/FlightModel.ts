/**
 * Six-degree-of-freedom rigid-body flight dynamics.
 *
 * Owns: position, orientation, linear & angular velocity of the aircraft.
 * Forces: gravity, thrust, lift, drag, side force, landing-gear / hull /
 * float contact. Moments: static stability, damping and control derivatives.
 *
 * Deliberately independent of React, the renderer and the input device: it
 * consumes a normalised FlightInput and an Environment, nothing else.
 */
import { Quaternion, Vector3 } from 'three';
import type { AircraftState, FlightCommand, FlightInput, SurfaceKind } from '../../types';
import type { AircraftSpec, ContactPoint } from '../aircraft/specs';
import type { GroundPlane } from '../terrain/heightfield';
import { RHO0, SURFACES, speedOfSound, type Environment, type GroundProvider, type WindSample } from './environment';

export type FlightEvent =
  | { type: 'touchdown'; point: ContactPoint; sinkRate: number; speed: number; surface: SurfaceKind; first: boolean }
  | { type: 'liftoff' }
  | { type: 'damage'; amount: number; cause: string }
  | { type: 'destroyed'; cause: string }
  | { type: 'gear'; down: boolean }
  | { type: 'gearLocked'; down: boolean }
  | { type: 'flaps'; notch: number }
  | { type: 'engineStart' }
  | { type: 'engineStop'; cause: string }
  | { type: 'autopilot'; on: boolean }
  | { type: 'splash'; speed: number };

export interface ResetOptions {
  x: number;
  y: number;
  z: number;
  /** degrees true */
  heading: number;
  /** m/s along the heading */
  speed: number;
  airborne: boolean;
  fuelFraction?: number;
}

export interface AutopilotTargets {
  altitude: number;
  heading: number;
  speed: number;
  /** When true the AP was engaged automatically because hand tracking was lost. */
  assist: boolean;
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  return Math.abs(d) <= maxDelta ? target : current + Math.sign(d) * maxDelta;
}
function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

export class FlightModel {
  readonly spec: AircraftSpec;
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  readonly vel = new Vector3();
  /** Body-frame angular velocity (three.js axes). */
  readonly omega = new Vector3();
  readonly state: AircraftState;
  readonly events: FlightEvent[] = [];
  readonly ap: AutopilotTargets = { altitude: 0, heading: 0, speed: 0, assist: false };

  /** Assist: trim automatically for 1 g flight with the stick centred. */
  autoTrim = true;
  /** Assist: start the engine automatically when the throttle is advanced. */
  autoStart = true;
  /**
   * Assist: limit the elevator so that stick + trim cannot hold the wing
   * beyond its stalling angle (a "stick pusher"). The wing can still stall
   * dynamically — in a zoom climb, a gust or an abrupt pull — but simply
   * holding the stick back gives maximum lift instead of a departure.
   */
  stallProtection = true;
  /** Invulnerability for sandbox experiments. */
  invulnerable = false;

  private ground: GroundProvider;
  private plane: GroundPlane = { h: 0, nx: 0, ny: 1, nz: 0 };
  private surface: SurfaceKind = 'asphalt';
  private wind: WindSample = { x: 0, y: 0, z: 0, gp: 0, gq: 0, gr: 0 };
  private springK: number[] = [];
  private springC: number[] = [];
  private inContact: boolean[] = [];
  private trim = 0;
  private startTimer = 0;
  private everAirborne = false;
  private airborneTime = 0;
  private groundTime = 0;
  private apIntVs = 0;
  private apIntSpd = 0;
  private stallPhase = Math.random() * 10;
  private sigma = 0;
  private lastAccel = new Vector3();

  // scratch
  private qInv = new Quaternion();
  private vAir = new Vector3();
  private vBody = new Vector3();
  private force = new Vector3();
  private torque = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmp3 = new Vector3();
  private rw = new Vector3();
  private fwd = new Vector3();
  private side = new Vector3();
  private nrm = new Vector3();
  private dq = new Quaternion();

  constructor(spec: AircraftSpec, ground: GroundProvider) {
    this.spec = spec;
    this.ground = ground;
    this.state = {
      aircraftId: spec.id,
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      acceleration: { x: 0, y: 0, z: 0 },
      thrust: 0,
      lift: 0,
      drag: 0,
      weight: 0,
      wind: { x: 0, y: 0, z: 0 },
      airspeed: 0,
      indicatedAirspeed: 0,
      groundSpeed: 0,
      verticalSpeed: 0,
      altitude: 0,
      altitudeAgl: 0,
      heading: 0,
      pitch: 0,
      bank: 0,
      alpha: 0,
      beta: 0,
      gLoad: 1,
      airDensity: RHO0,
      throttle: 0,
      enginePower: 0,
      engineRunning: false,
      rpm: 0,
      fuel: spec.fuelCapacity,
      fuelFraction: 1,
      flaps: 0,
      flapsNotch: 0,
      gear: 1,
      gearDown: true,
      brake: 0,
      autopilot: false,
      elevator: 0,
      aileron: 0,
      rudder: 0,
      onGround: true,
      onWater: false,
      wheelsOnGround: 0,
      surface: 'asphalt',
      stalled: false,
      stallWarning: false,
      overspeed: false,
      damage: 0,
      destroyed: false,
      time: 0,
    };
    this.computeGear();
  }

  /** Spring rates so the aircraft rests at its design attitude. */
  private computeGear(): void {
    const spec = this.spec;
    const m = spec.emptyMass + spec.fuelCapacity;
    const g = 9.81;
    const gear = spec.contacts.filter((c) => c.kind === 'gear');
    const nose = gear.filter((c) => c.z < 0);
    const main = gear.filter((c) => c.z >= 0);
    const zn = nose.length ? Math.abs(nose[0].z) : 1;
    const zm = main.length ? Math.abs(main[0].z) : 0;
    const noseShare = nose.length ? zm / (zn + zm) : 0;
    spec.contacts.forEach((c, i) => {
      let share: number;
      if (c.kind === 'gear') share = c.z < 0 ? noseShare / nose.length : (1 - noseShare) / main.length;
      else if (c.kind === 'float') share = 0.3;
      else share = 0.5;
      const travel = c.kind === 'gear' ? spec.gearCompression : c.kind === 'float' ? 0.22 : 0.06;
      const k = (share * m * g) / travel;
      this.springK[i] = k;
      this.springC[i] = 2 * (c.kind === 'gear' ? spec.gearDamping : c.kind === 'float' ? 0.9 : 0.8) * Math.sqrt(k * share * m);
      this.inContact[i] = false;
    });
  }

  reset(o: ResetOptions): void {
    const s = this.state;
    const h = o.heading * DEG;
    this.quat.setFromAxisAngle(Y_AXIS, -h);
    this.pos.set(o.x, o.y, o.z);
    this.vel.set(Math.sin(h) * o.speed, 0, -Math.cos(h) * o.speed);
    this.omega.set(0, 0, 0);
    this.events.length = 0;
    this.inContact.fill(false);
    s.fuel = this.spec.fuelCapacity * (o.fuelFraction ?? 1);
    s.damage = 0;
    s.destroyed = false;
    s.time = 0;
    s.autopilot = false;
    s.stalled = false;
    s.stallWarning = false;
    s.overspeed = false;
    s.flaps = 0;
    s.flapsNotch = 0;
    s.brake = 0;
    s.elevator = s.aileron = s.rudder = 0;
    this.trim = 0;
    this.apIntVs = this.apIntSpd = 0;
    this.startTimer = 0;
    this.sigma = 0;
    if (o.airborne) {
      s.gearDown = false;
      s.gear = 0;
      s.engineRunning = true;
      s.throttle = 0.7;
      s.enginePower = 0.7;
      s.onGround = false;
      this.everAirborne = true;
      this.airborneTime = 10;
      this.groundTime = 0;
    } else {
      s.gearDown = true;
      s.gear = 1;
      s.engineRunning = false;
      s.throttle = 0;
      s.enginePower = 0;
      s.onGround = true;
      this.everAirborne = false;
      this.airborneTime = 0;
      this.groundTime = 10;
    }
    this.publish(0, 0, 0, 0, RHO0);
  }

  command(cmd: FlightCommand): void {
    const s = this.state;
    if (s.destroyed) return;
    switch (cmd) {
      case 'toggleGear':
        if (s.wheelsOnGround > 0 && s.gearDown) return; // squat switch
        s.gearDown = !s.gearDown;
        this.events.push({ type: 'gear', down: s.gearDown });
        break;
      case 'flapsDown':
        if (s.flapsNotch < this.spec.flapNotches.length - 1) {
          s.flapsNotch++;
          this.events.push({ type: 'flaps', notch: s.flapsNotch });
        }
        break;
      case 'flapsUp':
        if (s.flapsNotch > 0) {
          s.flapsNotch--;
          this.events.push({ type: 'flaps', notch: s.flapsNotch });
        }
        break;
      case 'cycleFlaps':
        s.flapsNotch = (s.flapsNotch + 1) % this.spec.flapNotches.length;
        this.events.push({ type: 'flaps', notch: s.flapsNotch });
        break;
      case 'toggleAutopilot':
        this.setAutopilot(!s.autopilot || this.ap.assist, false);
        break;
      case 'toggleEngine':
        if (s.engineRunning) {
          s.engineRunning = false;
          this.events.push({ type: 'engineStop', cause: 'shutdown' });
        } else if (s.fuel > 0) this.startTimer = 1.6;
        break;
      default:
        break;
    }
  }

  setAutopilot(on: boolean, assist: boolean): void {
    const s = this.state;
    if (on && (s.onGround || s.destroyed)) {
      if (!assist) this.events.push({ type: 'autopilot', on: false });
      return;
    }
    const changed = s.autopilot !== on || this.ap.assist !== assist;
    s.autopilot = on;
    this.ap.assist = on && assist;
    if (on) {
      this.ap.altitude = s.altitude;
      this.ap.heading = s.heading;
      this.ap.speed = Math.max(s.indicatedAirspeed, this.spec.vApproach * 1.15);
      this.apIntVs = 0;
      this.apIntSpd = s.throttle;
    }
    if (changed && !assist) this.events.push({ type: 'autopilot', on });
  }

  /** Sandbox hooks. */
  setFuelFraction(f: number): void {
    this.state.fuel = clamp(f, 0, 1) * this.spec.fuelCapacity;
  }
  setDamage(d: number): void {
    this.state.damage = clamp(d, 0, 0.99);
  }

  get mass(): number {
    return this.spec.emptyMass + this.state.fuel;
  }

  /* ------------------------------------------------------------- stepping */

  step(dt: number, input: FlightInput, env: Environment): void {
    const s = this.state;
    if (s.destroyed) return;
    s.time += dt;
    const controls = this.systems(dt, input, env);

    this.ground.plane(this.pos.x, this.pos.z, this.plane);
    const terrainH = this.plane.h;
    const water = terrainH < -0.02;
    if (water) {
      this.plane.h = 0;
      this.plane.nx = 0;
      this.plane.ny = 1;
      this.plane.nz = 0;
      this.surface = 'water';
    } else {
      this.surface = this.ground.surface(this.pos.x, this.pos.z, terrainH);
    }

    const sub = 4;
    const h = dt / sub;
    const v0x = this.vel.x;
    const v0y = this.vel.y;
    const v0z = this.vel.z;
    let lift = 0;
    let drag = 0;
    let thrust = 0;
    let rho = RHO0;
    for (let i = 0; i < sub; i++) {
      const r = this.integrate(h, controls, env);
      lift = r.lift;
      drag = r.drag;
      thrust = r.thrust;
      rho = r.rho;
      if (s.destroyed) break;
    }
    this.lastAccel.set((this.vel.x - v0x) / dt, (this.vel.y - v0y) / dt, (this.vel.z - v0z) / dt);
    this.publish(dt, lift, drag, thrust, rho);
    this.limits(dt);
  }

  private controlsOut = { elevator: 0, aileron: 0, rudder: 0, brake: 0, steer: 0 };

  /** Engine, fuel, actuators, autopilot, trim. Runs once per fixed step. */
  private systems(dt: number, input: FlightInput, env: Environment) {
    const s = this.state;
    const spec = this.spec;
    let pitchCmd = clamp(input.pitch, -1, 1);
    let rollCmd = clamp(input.roll, -1, 1);
    let yawCmd = clamp(input.yaw, -1, 1);
    let throttleCmd = clamp(input.throttle, 0, 1);

    // ---- autopilot / level assist
    if (s.autopilot) {
      if (s.onGround || s.stalled) {
        this.setAutopilot(false, false);
      } else {
        // control-wheel steering: the stick nudges the targets
        if (!this.ap.assist) {
          this.ap.heading = (this.ap.heading + rollCmd * 6 * dt + 360) % 360;
          this.ap.altitude += pitchCmd * 8 * dt;
        }
        const hdgErr = wrapDeg(this.ap.heading - s.heading);
        const bankTarget = clamp(hdgErr * 1.6, -25, 25) * DEG;
        const p = -this.omega.z;
        rollCmd = clamp((bankTarget - s.bank) * 2.2 - p * 0.9, -1, 1);
        const vsTarget = clamp((this.ap.altitude - s.altitude) * 0.22, -6, 6);
        const vsErr = vsTarget - s.verticalSpeed;
        this.apIntVs = clamp(this.apIntVs + vsErr * 0.035 * dt, -0.5, 0.5);
        pitchCmd = clamp(vsErr * 0.085 + this.apIntVs - this.omega.x * 1.4, -0.8, 0.8);
        yawCmd = clamp(-s.beta * 3, -0.5, 0.5);
        const spdErr = this.ap.speed - s.indicatedAirspeed;
        this.apIntSpd = clamp(this.apIntSpd + spdErr * 0.02 * dt, 0, 1);
        throttleCmd = clamp(this.apIntSpd + spdErr * 0.06, 0.05, 1);
      }
    }

    // ---- engine
    if (this.startTimer > 0) {
      this.startTimer -= dt;
      if (this.startTimer <= 0 && s.fuel > 0) {
        s.engineRunning = true;
        this.events.push({ type: 'engineStart' });
      }
    } else if (!s.engineRunning && this.autoStart && throttleCmd > 0.08 && s.fuel > 0 && s.damage < 0.95) {
      this.startTimer = 1.6;
    }
    if (s.engineRunning && s.fuel <= 0) {
      s.engineRunning = false;
      s.fuel = 0;
      this.events.push({ type: 'engineStop', cause: 'fuel exhausted' });
    }
    s.throttle = throttleCmd;
    const powerTarget = s.engineRunning ? throttleCmd : 0;
    const tau = spec.spoolTime * (powerTarget > s.enginePower ? 1 : 0.8);
    s.enginePower += (powerTarget - s.enginePower) * Math.min(1, dt / tau);
    if (s.engineRunning) {
      s.fuel = Math.max(0, s.fuel - spec.fuelBurnFull * (0.07 + 0.93 * Math.pow(s.enginePower, 1.25)) * dt);
    }
    const rpmTarget = s.engineRunning
      ? spec.rpmIdle + (spec.rpmMax - spec.rpmIdle) * Math.pow(s.enginePower, 0.8)
      : this.startTimer > 0
        ? spec.rpmIdle * 0.35
        : spec.engineType === 'jet'
          ? Math.min(18, s.airspeed * 0.09)
          : Math.min(spec.rpmIdle * 0.9, s.airspeed * (spec.rpmMax / 140));
    s.rpm += (rpmTarget - s.rpm) * Math.min(1, dt * 4);

    // ---- configuration
    const flapTarget = spec.flapNotches[s.flapsNotch];
    s.flaps = approach(s.flaps, flapTarget, dt / spec.flapTime);
    const gearTarget = s.gearDown ? 1 : 0;
    if (s.gear !== gearTarget) {
      s.gear = approach(s.gear, gearTarget, dt / spec.gearTime);
      if (s.gear === gearTarget) this.events.push({ type: 'gearLocked', down: s.gearDown });
    }

    // ---- auto trim: centre stick = 1 g at the current speed
    const rho = env.densityAt(this.pos.y);
    const V = Math.max(s.airspeed, 12);
    const qbar = 0.5 * rho * V * V;
    let trimTarget = 0;
    if (this.autoTrim && !s.onGround) {
      const clNeeded = clamp((this.mass * env.gravity) / (qbar * spec.wingArea), -1, spec.cl0 + spec.clAlpha * spec.alphaStall * 0.78 + spec.clFlap * s.flaps);
      const alpha1g = (clNeeded - spec.cl0 - spec.clFlap * s.flaps) / spec.clAlpha;
      trimTarget = clamp(-(spec.cm0 + spec.cmAlpha * alpha1g + spec.cmFlap * s.flaps) / spec.cmDe, -0.75, 0.75);
    }
    // slow enough that the aircraft keeps its natural short-term speed stability
    this.trim += (trimTarget - this.trim) * Math.min(1, dt / 4);

    // ---- control surfaces (rate limited actuators, authority fades with q)
    const vc = spec.cornerSpeed;
    const pitchAuth = s.airspeed > vc ? (vc * vc) / (s.airspeed * s.airspeed) : 1;
    const rollAuth = s.airspeed > vc ? vc / s.airspeed : 1;
    const rate = 7 * dt;
    s.elevator = approach(s.elevator, pitchCmd, rate);
    s.aileron = approach(s.aileron, rollCmd, rate);
    s.rudder = approach(s.rudder, yawCmd, rate);
    s.brake = clamp(input.brake, 0, 1);

    const c = this.controlsOut;
    c.elevator = s.elevator * pitchAuth + this.trim;
    c.aileron = s.aileron * rollAuth;
    c.rudder = s.rudder * Math.min(1, rollAuth * 1.3);
    c.brake = s.brake;
    c.steer = -s.rudder * spec.maxSteer / (1 + Math.pow(s.groundSpeed / 22, 2));
    return c;
  }

  private result = { lift: 0, drag: 0, thrust: 0, rho: RHO0 };

  private integrate(h: number, c: { elevator: number; aileron: number; rudder: number; brake: number; steer: number }, env: Environment) {
    const s = this.state;
    const spec = this.spec;
    const mass = this.mass;
    const force = this.force.set(0, -mass * env.gravity, 0);
    const torque = this.torque.set(0, 0, 0); // body frame
    const qInv = this.qInv.copy(this.quat).invert();

    // ---- air data
    env.windAt(this.pos.x, this.pos.y, this.pos.z, s.time, this.wind);
    const w = this.wind;
    const vBody = this.vBody.set(this.vel.x - w.x, this.vel.y - w.y, this.vel.z - w.z).applyQuaternion(qInv);
    const V = vBody.length();
    const rho = env.densityAt(this.pos.y);
    const qbar = 0.5 * rho * V * V;
    const u = -vBody.z;
    const alpha = V > 0.5 ? Math.atan2(-vBody.y, Math.abs(u) < 1e-4 ? 1e-4 : u) : 0;
    const beta = V > 0.5 ? Math.asin(clamp(vBody.x / V, -1, 1)) : 0;
    const S = spec.wingArea;
    const dmg = s.damage;

    // ---- lift & drag with a smooth stall
    const flap = s.flaps;
    const aStall = spec.alphaStall - spec.flapStallShift * flap;
    const M = spec.stallSharpness;
    const e1 = Math.exp(-M * (alpha - aStall));
    const e2 = Math.exp(M * (alpha + spec.alphaStallNeg));
    const sigma = (1 + e1 + e2) / ((1 + e1) * (1 + e2));
    this.sigma = sigma;
    const clLin = spec.cl0 + spec.clFlap * flap + spec.clAlpha * alpha;
    const clPost = spec.clPost * Math.sin(2 * alpha);
    let CL = (1 - sigma) * clLin + sigma * clPost;
    CL *= 1 - 0.3 * dmg;
    const agl = this.pos.y - this.plane.h - spec.cgHeight;
    const ge = 1 - 0.45 * Math.exp(-Math.pow(Math.max(agl, 0) / (0.35 * spec.wingSpan), 2));
    const sa = Math.sin(alpha);
    const sb = Math.sin(beta);
    let CD = (1 - sigma) * (spec.cd0 + spec.inducedK * ge * clLin * clLin) + sigma * (spec.cd0 + 1.7 * sa * sa);
    CD += spec.cdGear * s.gear + spec.cdFlap * flap + 0.7 * sb * sb + 0.06 * dmg;
    if (spec.machDrag > 0) {
      const mach = V / speedOfSound(this.pos.y);
      const t = clamp((mach - 0.82) / 0.3, 0, 1);
      CD += spec.machDrag * t * t * (3 - 2 * t) + (mach > 1.12 ? (mach - 1.12) * 0.25 : 0);
    }
    const lift = qbar * S * CL;
    const drag = qbar * S * CD;
    const sideF = qbar * S * spec.cyBeta * beta;

    const bodyF = this.tmp.set(0, 0, 0);
    if (V > 0.5) {
      const inv = 1 / V;
      const vx = vBody.x * inv;
      const vy = vBody.y * inv;
      const vz = vBody.z * inv;
      // lift ⟂ airflow in the plane of symmetry: X × v̂
      const ll = Math.hypot(vz, vy) || 1;
      bodyF.set(-vx * drag + sideF, (-vz / ll) * lift - vy * drag, (vy / ll) * lift - vz * drag);
    }

    // ---- thrust
    const dens = Math.pow(rho / RHO0, spec.densityExponent);
    const power = s.engineRunning ? spec.idleThrust + (1 - spec.idleThrust) * s.enginePower : 0;
    const health = dmg > 0.5 ? 1 - (dmg - 0.5) * 1.6 : 1;
    let thrust: number;
    if (spec.engineType === 'jet') {
      thrust = spec.staticThrust * power * dens * health;
    } else {
      const pAvail = spec.maxPower * spec.propEfficiency * power * dens * health;
      const v0 = (spec.maxPower * spec.propEfficiency) / spec.staticThrust;
      const uf = Math.max(u, 0);
      thrust = pAvail / Math.cbrt(uf * uf * uf + v0 * v0 * v0);
      if (!s.engineRunning) thrust = -0.02 * qbar * S; // windmilling propeller drag
    }
    bodyF.z -= thrust;
    force.add(bodyF.applyQuaternion(this.quat));

    // ---- aerodynamic moments (aero convention: p roll right, q pitch up, r yaw right)
    const Vd = Math.max(V, 9);
    const b = spec.wingSpan;
    const ch = spec.chord;
    const p = -this.omega.z + w.gp;
    const q = this.omega.x + w.gq;
    const r = -this.omega.y + w.gr;
    const ph = (p * b) / (2 * Vd);
    const qh = (q * ch) / (2 * Vd);
    const rh = (r * b) / (2 * Vd);
    const qTail = qbar + spec.propwash * Math.max(thrust, 0) / S;
    const aM = clamp(alpha, -0.6, 0.6);
    const stallAuth = 1 - 0.6 * sigma;
    let elevator = c.elevator;
    if (this.stallProtection && V > 8) {
      // stick pusher: the elevator may only hold the wing just below its stall
      // angle, accounting for propwash over the tail, and pushes when alpha
      // (or its trend) goes past it
      const margin = 1.5 * DEG;
      const aMax = spec.alphaStall - spec.flapStallShift * flap - margin;
      const aMin = -(spec.alphaStallNeg - margin);
      const ratio = qbar / Math.max(qTail, 1);
      const aPred = alpha + q * 0.25;
      const eMax = (-(spec.cm0 + spec.cmAlpha * aMax + spec.cmFlap * flap) / spec.cmDe) * ratio - 10 * Math.max(0, aPred - aMax);
      const eMin = (-(spec.cm0 + spec.cmAlpha * aMin + spec.cmFlap * flap) / spec.cmDe) * ratio + 10 * Math.max(0, aMin - aPred);
      if (elevator > eMax) elevator = eMax;
      if (elevator < eMin) elevator = eMin;
    }
    const Mp = qbar * S * ch * (spec.cm0 + spec.cmAlpha * aM + spec.cmFlap * flap + spec.cmQ * qh) + qTail * S * ch * spec.cmDe * elevator;
    const wobble = sigma * spec.stallRoll * (0.045 * Math.sin(s.time * 2.3 + this.stallPhase) + 0.5 * rh + 0.02 * Math.sign(beta || 1));
    const Lr = qbar * S * b * (spec.clBeta * beta + spec.clP * ph + spec.clR * rh + spec.clDa * c.aileron * stallAuth + wobble + 0.02 * dmg);
    const Ny = qbar * S * b * (spec.cnBeta * beta + spec.cnR * rh + spec.cnP * ph + spec.cnDa * c.aileron) + qTail * S * b * spec.cnDr * c.rudder;
    torque.set(Mp, -Ny, -Lr);
    // residual rotational drag so tumbling at zero airspeed still decays
    torque.x -= this.omega.x * Math.abs(this.omega.x) * spec.inertia.pitch * 0.4;
    torque.y -= this.omega.y * Math.abs(this.omega.y) * spec.inertia.yaw * 0.4;
    torque.z -= this.omega.z * Math.abs(this.omega.z) * spec.inertia.roll * 0.15;

    // ---- ground / water contact
    this.contact(force, torque, c, mass);

    // ---- integrate (semi-implicit Euler)
    const I = spec.inertia;
    const ox = this.omega.x;
    const oy = this.omega.y;
    const oz = this.omega.z;
    // Euler's equations, principal axes: Ix = pitch, Iy = yaw, Iz = roll
    const ax = (torque.x - (I.roll - I.yaw) * oy * oz) / I.pitch;
    const ay = (torque.y - (I.pitch - I.roll) * oz * ox) / I.yaw;
    const az = (torque.z - (I.yaw - I.pitch) * ox * oy) / I.roll;
    this.omega.set(clamp(ox + ax * h, -12, 12), clamp(oy + ay * h, -12, 12), clamp(oz + az * h, -12, 12));
    this.vel.addScaledVector(force, h / mass);
    this.pos.addScaledVector(this.vel, h);
    const ang = this.omega.length() * h;
    if (ang > 1e-9) {
      this.dq.setFromAxisAngle(this.tmp2.copy(this.omega).normalize(), ang);
      this.quat.multiply(this.dq).normalize();
    }

    const res = this.result;
    res.lift = lift;
    res.drag = drag;
    res.thrust = thrust;
    res.rho = rho;
    s.alpha = alpha;
    s.beta = beta;
    s.airspeed = V;
    return res;
  }

  private contactCount = 0;
  private gearCount = 0;

  private contact(force: Vector3, torque: Vector3, c: { brake: number; steer: number }, mass: number): void {
    const s = this.state;
    const spec = this.spec;
    const plane = this.plane;
    const n = this.nrm.set(plane.nx, plane.ny, plane.nz);
    const water = this.surface === 'water';
    const props = SURFACES[this.surface];
    this.contactCount = 0;
    this.gearCount = 0;
    const lowest = this.pos.y - plane.h;
    if (lowest > 14) {
      // far above the ground: nothing can touch
      for (let i = 0; i < this.inContact.length; i++) this.inContact[i] = false;
      return;
    }
    const speed = this.vel.length();
    for (let i = 0; i < spec.contacts.length; i++) {
      const cp = spec.contacts[i];
      let py = cp.y;
      if (cp.kind === 'gear') {
        if (s.gear < 0.02) {
          this.inContact[i] = false;
          continue;
        }
        py = -0.55 + (cp.y + 0.55) * s.gear; // retracting legs shorten
      }
      if (cp.kind === 'float' && !water) {
        this.inContact[i] = false;
        continue;
      }
      // a boat hull rides on its floats: wheels and the keel line pass through the water
      if (water && spec.amphibious && (cp.kind === 'gear' || cp.label === 'belly' || cp.label === 'nose' || cp.label === 'tail')) {
        this.inContact[i] = false;
        continue;
      }
      const rw = this.rw.set(cp.x, py, cp.z).applyQuaternion(this.quat);
      const wx = this.pos.x + rw.x;
      const wy = this.pos.y + rw.y;
      const wz = this.pos.z + rw.z;
      // ground height under this point from the local plane
      const gh = plane.h - (plane.nx * rw.x + plane.nz * rw.z) / plane.ny;
      let pen = (gh - wy) * plane.ny;
      if (pen <= 0) {
        this.inContact[i] = false;
        continue;
      }
      // velocity of the contact point
      const vp = this.tmp2.copy(this.omega).cross(this.tmp3.set(cp.x, py, cp.z)).applyQuaternion(this.quat).add(this.vel);
      const vn = vp.dot(n);
      const isGear = cp.kind === 'gear' && s.gear > 0.9 && !water;
      const isFloat = cp.kind === 'float';

      // ---- first touch: events, damage
      if (!this.inContact[i]) {
        this.inContact[i] = true;
        const sink = -vn;
        if (isGear || isFloat) {
          const first = this.contactCount === 0 && !s.onGround;
          if (sink > 0.25 || first) this.events.push({ type: 'touchdown', point: cp, sinkRate: Math.max(sink, 0), speed, surface: this.surface, first });
          if (isFloat && speed > 6) this.events.push({ type: 'splash', speed });
          if (isFloat && first && s.gear > 0.5 && speed > 10) this.hurt(0.35, 'water landing with the wheels down', false);
          if (sink > spec.maxSinkRate) this.hurt((sink - spec.maxSinkRate) * (first ? 0.2 : 0.07), `hard ${isFloat ? 'water ' : ''}landing (${sink.toFixed(1)} m/s)`, sink > spec.maxSinkRate + 5.5);
          if (isGear && !props.landable && speed > 18) this.hurt(0.012 * (speed - 18) * 0.25, 'rough terrain', false);
        } else if (water) {
          if (speed > 14 || sink > 4) this.hurt(1, 'ditched in the water', true);
          else {
            this.events.push({ type: 'splash', speed });
            this.hurt(0.25, 'ditched in the water', false);
          }
        } else {
          // structure hitting the ground
          const lethal = sink > 7 || (speed > 38 && cp.label !== 'belly' && cp.label !== 'tail') || (speed > 70 && cp.label !== 'tail');
          const amount = cp.label === 'belly' ? 0.12 + sink * 0.08 : cp.label === 'tail' ? (sink > 1.2 ? 0.02 + sink * 0.04 : 0) : 0.18 + sink * 0.1 + speed * 0.004;
          this.hurt(amount, cp.label === 'belly' ? 'belly landing' : `${cp.label} strike`, lethal);
          if (cp.label === 'belly' && !this.inContact.some((v, j) => v && j !== i)) {
            this.events.push({ type: 'touchdown', point: cp, sinkRate: Math.max(sink, 0), speed, surface: this.surface, first: !s.onGround });
          }
        }
        if (s.destroyed) return;
      }
      this.contactCount++;
      if (isGear) this.gearCount++;

      // ---- normal force
      const maxPen = isFloat ? 0.9 : 0.6;
      if (pen > maxPen) pen = maxPen;
      let fn = this.springK[i] * pen - this.springC[i] * vn;
      if (isFloat) fn = this.springK[i] * pen * (1 + speed * 0.02) - this.springC[i] * vn;
      if (fn < 0) fn = 0;
      const fnMax = mass * 9.81 * 6;
      if (fn > fnMax) fn = fnMax;

      // ---- tangential force
      const vt = vp.addScaledVector(n, -vn); // tangential velocity (vp is scratch)
      const f = this.tmp3.set(0, 0, 0);
      if (isGear) {
        const fwd = this.fwd.set(0, 0, -1);
        if (cp.steer) fwd.applyAxisAngle(Y_AXIS, c.steer);
        fwd.applyQuaternion(this.quat).addScaledVector(n, -fwd.dot(n)).normalize();
        const side = this.side.crossVectors(fwd, n).normalize();
        const vl = vt.dot(fwd);
        const vs = vt.dot(side);
        const mu = props.rollMu + (cp.brake ? c.brake * spec.brakeMu * props.brakeScale : 0);
        f.addScaledVector(fwd, -mu * fn * Math.tanh(vl / 0.35));
        f.addScaledVector(side, -props.sideMu * fn * Math.tanh(vs / 0.9));
      } else if (isFloat) {
        // hull drag: strong sideways, speed-dependent forwards (planing)
        const fwd = this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
        fwd.addScaledVector(n, -fwd.dot(n)).normalize();
        const side = this.side.crossVectors(fwd, n).normalize();
        const vl = vt.dot(fwd);
        const vs = vt.dot(side);
        const wet = pen / maxPen;
        f.addScaledVector(fwd, -(0.05 * fn * Math.tanh(vl / 0.5) + 1.3 * wet * vl * Math.abs(vl)));
        f.addScaledVector(side, -(0.5 * fn * Math.tanh(vs / 0.6) + 60 * wet * vs * Math.abs(vs)));
      } else {
        const vtl = vt.length();
        const mu = water ? 1.4 : 0.55;
        if (vtl > 1e-4) f.addScaledVector(vt, (-mu * fn * Math.tanh(vtl / 0.5)) / vtl);
        // sliding on the nose or a wingtip keeps tearing the airframe; a tail skid or belly just grinds
        if (!water && vtl > 12 && cp.label !== 'tail' && cp.label !== 'belly') this.hurt(0.00001 * vtl, 'ground scrape', false);
      }
      f.addScaledVector(n, fn);
      force.add(f);
      torque.add(this.tmp2.crossVectors(rw, f).applyQuaternion(this.qInv));
    }
    // non-amphibious aircraft cannot float
    if (water && !spec.amphibious && this.contactCount > 0 && !this.invulnerable) {
      this.vel.multiplyScalar(0.985);
    }
  }

  private hurt(amount: number, cause: string, lethal: boolean): void {
    const s = this.state;
    if (this.invulnerable || amount <= 0) return;
    s.damage = Math.min(1, s.damage + amount);
    if (lethal || s.damage >= 1) {
      s.damage = 1;
      s.destroyed = true;
      s.engineRunning = false;
      s.autopilot = false;
      this.events.push({ type: 'destroyed', cause });
    } else if (amount > 0.005) {
      this.events.push({ type: 'damage', amount, cause });
    }
  }

  /** External collision (buildings etc., detected by Rapier). */
  collide(cause: string): void {
    this.hurt(1, cause, true);
  }

  private overG = 0;

  private limits(dt: number): void {
    const s = this.state;
    const spec = this.spec;
    if (s.destroyed) return;
    s.overspeed = s.indicatedAirspeed > spec.vne;
    if (s.overspeed) this.hurt(((s.indicatedAirspeed - spec.vne) / spec.vne) * 0.6 * dt, 'overspeed', false);
    const g = Math.abs(s.gLoad);
    if (g > spec.maxG * 1.12 && !s.onGround) {
      this.overG += dt;
      if (this.overG > 0.4) this.hurt((g - spec.maxG) * 0.12 * dt, 'structural overload', false);
    } else this.overG = 0;
    // gear/flap overspeed
    if (s.flaps > 0.5 && s.indicatedAirspeed > spec.vne * 0.62) this.hurt(0.01 * dt, 'flap overspeed', false);
  }

  /** Copy internal state into the public AircraftState snapshot. */
  private publish(dt: number, lift: number, drag: number, thrust: number, rho: number): void {
    const s = this.state;
    const spec = this.spec;
    s.position.x = this.pos.x;
    s.position.y = this.pos.y;
    s.position.z = this.pos.z;
    s.orientation.x = this.quat.x;
    s.orientation.y = this.quat.y;
    s.orientation.z = this.quat.z;
    s.orientation.w = this.quat.w;
    s.velocity.x = this.vel.x;
    s.velocity.y = this.vel.y;
    s.velocity.z = this.vel.z;
    s.angularVelocity.x = this.omega.x;
    s.angularVelocity.y = this.omega.y;
    s.angularVelocity.z = this.omega.z;
    s.acceleration.x = this.lastAccel.x;
    s.acceleration.y = this.lastAccel.y;
    s.acceleration.z = this.lastAccel.z;
    s.wind.x = this.wind.x;
    s.wind.y = this.wind.y;
    s.wind.z = this.wind.z;
    s.lift = lift;
    s.drag = drag;
    s.thrust = thrust;
    s.weight = this.mass * 9.80665;
    s.airDensity = rho;
    s.indicatedAirspeed = s.airspeed * Math.sqrt(rho / RHO0);
    s.groundSpeed = Math.hypot(this.vel.x, this.vel.z);
    s.verticalSpeed = this.vel.y;
    s.altitude = this.pos.y - spec.cgHeight;
    s.altitudeAgl = Math.max(0, this.pos.y - spec.cgHeight - this.plane.h);
    const f = this.tmp.set(0, 0, -1).applyQuaternion(this.quat);
    s.pitch = Math.asin(clamp(f.y, -1, 1));
    s.heading = ((Math.atan2(f.x, -f.z) / DEG) + 360) % 360;
    const r = this.tmp2.set(1, 0, 0).applyQuaternion(this.quat);
    const up = this.tmp3.set(0, 1, 0).applyQuaternion(this.quat);
    s.bank = Math.atan2(-r.y, up.y);
    // load factor: specific force along body up
    s.gLoad = (this.lastAccel.dot(up) + 9.80665 * up.y) / 9.80665;
    s.fuelFraction = s.fuel / spec.fuelCapacity;
    s.wheelsOnGround = this.gearCount;
    const touching = this.contactCount > 0;
    if (touching) {
      this.groundTime += dt;
      this.airborneTime = 0;
    } else {
      this.airborneTime += dt;
      this.groundTime = 0;
    }
    const wasOnGround = s.onGround;
    if (touching) s.onGround = true;
    else if (this.airborneTime > 0.35) s.onGround = false;
    if (wasOnGround && !s.onGround) {
      this.everAirborne = true;
      this.events.push({ type: 'liftoff' });
    }
    s.onWater = s.onGround && this.surface === 'water';
    s.surface = this.surface;
    const aStall = spec.alphaStall - spec.flapStallShift * s.flaps;
    const flying = !s.onGround && s.airspeed > 6;
    s.stalled = flying && this.sigma > 0.5;
    s.stallWarning = flying && s.alpha > aStall - 3.5 * DEG;
  }

  get hasFlown(): boolean {
    return this.everAirborne;
  }
  get stallSigma(): number {
    return this.sigma;
  }
  get trimPosition(): number {
    return this.trim;
  }
  /** Seconds continuously in contact with the ground. */
  get timeOnGround(): number {
    return this.groundTime;
  }
  get timeAirborne(): number {
    return this.airborneTime;
  }

  /** Used by the replay system to pose the aircraft without simulating. */
  pose(px: number, py: number, pz: number, q: Quaternion): void {
    this.pos.set(px, py, pz);
    this.quat.copy(q);
  }
}

export { X_AXIS };
