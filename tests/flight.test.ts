import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_ORDER, stallSpeeds } from '../src/game/aircraft/specs';
import { STILL_AIR, isaDensity, type Environment } from '../src/game/physics/environment';
import { Rig } from './helpers';

const DEG = Math.PI / 180;
const cl = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

function takeoff(r: Rig) {
  const vs = stallSpeeds(r.fm.spec);
  r.ground();
  r.run(2);
  r.input.throttle = 1;
  let liftT = -1;
  let dist = 0;
  r.run(120, (s, t) => {
    r.input.pitch = s.indicatedAirspeed > vs.clean * 1.12 ? (s.onGround ? 0.55 : cl((8 * DEG - s.pitch) * 3, -0.3, 0.5)) : 0;
    r.input.roll = cl(-s.bank * 2);
    if (!s.onGround && liftT < 0) {
      liftT = t;
      dist = Math.hypot(s.position.x, s.position.z);
    }
    return liftT > 0 && t > liftT + 15;
  });
  return { liftT, dist };
}

/** Fly a stabilised approach to a flare and full stop on flat ground. */
function land(r: Rig, opts: { gear?: boolean; sink?: number } = {}) {
  const spec = r.fm.spec;
  const vs = stallSpeeds(spec);
  const vApp = Math.max(vs.landing * 1.3, spec.vApproach);
  r.air(120 + spec.cgHeight, vApp, 0);
  if (opts.gear !== false) r.fm.command('toggleGear');
  for (let i = 1; i < spec.flapNotches.length; i++) r.fm.command('flapsDown');
  let touched = false;
  r.run(240, (s) => {
    if (s.onGround) touched = true;
    const agl = s.altitudeAgl;
    const sink = opts.sink ?? 0.5;
    const vsT = touched ? -0.5 : agl > 9 ? -3 : agl > 2 ? -1.2 : -sink;
    r.input.pitch = touched ? -0.05 : cl((vsT - s.verticalSpeed) * 0.22 * Math.min(1, 34 / vApp) - s.angularVelocity.x * 0.8, -0.6, 0.9);
    r.input.roll = cl(-s.bank * 2 + s.angularVelocity.z * 0.6);
    r.input.throttle = touched || agl < 4 ? 0 : cl(0.35 + (vApp - s.indicatedAirspeed) * 0.12, 0, 1);
    r.input.brake = touched && s.wheelsOnGround >= 2 ? 1 : 0;
    return touched && s.groundSpeed < 0.6;
  });
  return { touched, vApp };
}

describe('flight model', () => {
  it('rests on its gear without moving', () => {
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      r.ground();
      r.run(5);
      expect(r.s.position.y).toBeCloseTo(r.fm.spec.cgHeight, 1);
      expect(r.s.groundSpeed).toBeLessThan(0.05);
      expect(r.s.wheelsOnGround).toBe(3);
      expect(Math.abs(r.s.pitch)).toBeLessThan(2 * DEG);
      expect(r.s.damage).toBe(0);
    }
  });

  it('takes off under its own power — each aircraft differently', () => {
    const dist: Record<string, number> = {};
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      const t = takeoff(r);
      dist[id] = t.dist;
      expect(t.liftT, `${id} lifts off`).toBeGreaterThan(0);
      expect(r.s.altitude, `${id} climbs`).toBeGreaterThan(25);
      expect(r.s.verticalSpeed).toBeGreaterThan(1);
      expect(r.s.damage).toBe(0);
      expect(r.events.some((e) => e.type === 'liftoff')).toBe(true);
      expect(r.events.some((e) => e.type === 'engineStart')).toBe(true);
    }
    expect(dist.sport).toBeLessThan(dist.trainer);
    expect(dist.trainer).toBeLessThan(450);
    expect(dist.turboprop).toBeGreaterThan(dist.trainer * 1.5);
    expect(dist.jet).toBeGreaterThan(dist.trainer * 2);
  });

  it('flies level hands-off (auto-trim) and has distinct top speeds', () => {
    const top: Record<string, number> = {};
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      const vs = stallSpeeds(r.fm.spec);
      r.air(1000, vs.clean * 2);
      r.input.throttle = 1;
      r.run(120);
      top[id] = r.s.indicatedAirspeed;
      expect(Math.abs(r.s.bank)).toBeLessThan(3 * DEG);
      expect(Math.abs(r.s.gLoad - 1)).toBeLessThan(0.1);
      expect(r.s.indicatedAirspeed).toBeLessThan(r.fm.spec.vne);
    }
    expect(top.sport).toBeLessThan(top.trainer);
    expect(top.trainer).toBeLessThan(top.turboprop);
    expect(top.turboprop).toBeLessThan(top.jet);
    expect(top.jet).toBeGreaterThan(200);
  });

  it('banks and turns towards the stick; roll rates differ by aircraft', () => {
    const rate: Record<string, number> = {};
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      const vs = stallSpeeds(r.fm.spec);
      r.air(1000, vs.clean * 2);
      r.input.throttle = 0.75;
      r.run(3);
      r.input.roll = 1;
      r.run(0.8);
      rate[id] = -r.s.angularVelocity.z / DEG;
      expect(r.s.bank).toBeGreaterThan(15 * DEG);
      // hold 30° of bank: heading must increase (right turn)
      r.air(1000, vs.clean * 2);
      r.run(2);
      r.run(10, (s) => {
        r.input.roll = cl((30 * DEG - s.bank) * 3);
        r.input.pitch = 0.1;
      });
      expect(r.s.heading).toBeGreaterThan(10);
      expect(r.s.heading).toBeLessThan(180);
      // and left
      r.air(1000, vs.clean * 2);
      r.run(8, (s) => {
        r.input.roll = cl((-30 * DEG - s.bank) * 3);
      });
      expect(r.s.heading).toBeGreaterThan(200);
    }
    expect(rate.jet).toBeGreaterThan(rate.sport);
    expect(rate.sport).toBeGreaterThan(rate.trainer);
    expect(rate.trainer).toBeGreaterThan(rate.turboprop);
  });

  it('pitches with the stick and yaws with the rudder', () => {
    const r = new Rig('trainer');
    r.air(1000, 50);
    r.input.throttle = 0.7;
    r.run(3);
    const p0 = r.s.pitch;
    r.input.pitch = 0.5;
    r.run(1.5);
    expect(r.s.pitch).toBeGreaterThan(p0 + 5 * DEG);
    r.air(1000, 50);
    r.input.pitch = 0;
    r.run(3);
    r.input.pitch = -0.5;
    r.run(1.5);
    expect(r.s.pitch).toBeLessThan(p0 - 5 * DEG);
    r.air(1000, 50);
    r.input.pitch = 0;
    r.run(3);
    r.input.yaw = 1;
    r.run(3);
    expect(r.s.heading).toBeGreaterThan(3);
    expect(r.s.heading).toBeLessThan(120);
    r.air(1000, 50);
    r.input.yaw = 0;
    r.run(3);
    r.input.yaw = -1;
    r.run(3);
    expect(r.s.heading).toBeLessThan(357);
    expect(r.s.heading).toBeGreaterThan(240);
  });

  it('stalls near the published stall speed and recovers', () => {
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      r.fm.stallProtection = false; // raw aerodynamics
      const vs = stallSpeeds(r.fm.spec);
      r.air(2000, vs.clean * 1.5);
      r.input.throttle = 0;
      let stallIas = -1;
      let warned = false;
      r.run(90, (s, t) => {
        r.input.pitch = Math.min(1, t / 25);
        r.input.roll = cl(-s.bank * 2);
        if (s.stallWarning) warned = true;
        if (s.stalled && stallIas < 0) stallIas = s.indicatedAirspeed;
        return stallIas > 0;
      });
      expect(warned, `${id} stall warning`).toBe(true);
      expect(stallIas, `${id} stalls`).toBeGreaterThan(0);
      expect(stallIas).toBeGreaterThan(vs.clean * 0.8);
      expect(stallIas).toBeLessThan(vs.clean * 1.35);
      // recovery: release, add power
      r.input.pitch = -0.15;
      r.input.throttle = 1;
      r.run(7, (s) => {
        r.input.roll = cl(-s.bank * 2);
      });
      r.input.pitch = 0;
      r.run(12, (s) => {
        r.input.roll = cl(-s.bank * 2);
      });
      expect(r.s.stalled, `${id} recovers`).toBe(false);
      expect(r.s.indicatedAirspeed).toBeGreaterThan(vs.clean);
      expect(r.s.altitude).toBeGreaterThan(1200);
    }
  });

  it('lands, brakes to a stop and reports gentle touchdowns as undamaged', () => {
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      const res = land(r);
      expect(res.touched, `${id} touches down`).toBe(true);
      const td = r.events.filter((e) => e.type === 'touchdown');
      expect(td.length).toBeGreaterThan(0);
      expect(r.s.destroyed).toBe(false);
      expect(r.s.damage, `${id} undamaged`).toBeLessThan(0.05);
      expect(r.s.groundSpeed).toBeLessThan(1);
      expect(r.s.wheelsOnGround).toBe(3);
    }
  });

  it('damages the aircraft in a hard landing, a gear-up landing and destroys it in a crash', () => {
    const hard = new Rig('trainer');
    hard.air(4, 34);
    hard.fm.command('toggleGear');
    hard.run(4);
    hard.fm.reset({ x: 0, y: hard.fm.spec.cgHeight + 0.25, z: 0, heading: 0, speed: 34, airborne: false });
    hard.fm.vel.y = -5.5;
    hard.run(3);
    expect(hard.s.damage).toBeGreaterThan(0.1);
    expect(hard.s.destroyed).toBe(false);
    expect(hard.events.some((e) => e.type === 'damage' && e.cause.startsWith('hard landing'))).toBe(true);

    const belly = new Rig('trainer');
    land(belly, { gear: false });
    expect(belly.s.damage).toBeGreaterThan(0.1);
    expect(belly.events.some((e) => e.type === 'damage' && e.cause === 'belly landing')).toBe(true);

    const crash = new Rig('trainer');
    crash.air(300, 60);
    crash.input.pitch = -1;
    crash.run(30);
    expect(crash.s.destroyed).toBe(true);
    expect(crash.events.some((e) => e.type === 'destroyed')).toBe(true);
  });

  it('responds to air density, gravity and wind', () => {
    const thin: Environment = { ...STILL_AIR, densityAt: (h) => isaDensity(h) * 0.5 };
    const a = new Rig('trainer');
    const b = new Rig('trainer', undefined, thin);
    const ta = takeoff(a);
    const tb = takeoff(b);
    expect(tb.dist).toBeGreaterThan(ta.dist * 1.4);

    const moon: Environment = { ...STILL_AIR, gravity: 1.62 };
    const c = new Rig('trainer', undefined, moon);
    const tc = takeoff(c);
    expect(tc.dist).toBeLessThan(ta.dist * 0.6);

    // a 15 m/s crosswind from the west pushes a hands-off aircraft east and weathercocks it
    const cross: Environment = {
      ...STILL_AIR,
      windAt(_x, _y, _z, _t, out) {
        out.x = 15;
        out.y = out.z = out.gp = out.gq = out.gr = 0;
      },
    };
    const d = new Rig('trainer', undefined, cross);
    d.air(1000, 50);
    d.fm.vel.x += 15; // start in equilibrium with the moving air mass
    d.input.throttle = 0.7;
    d.run(20, (s) => {
      d.input.roll = cl(-s.bank * 2);
    });
    expect(d.s.position.x).toBeGreaterThan(250);
    expect(Math.abs(d.s.beta)).toBeLessThan(2 * DEG);
    // headwind on the ground produces lift-relevant airspeed while stationary
    const head: Environment = {
      ...STILL_AIR,
      windAt(_x, _y, _z, _t, out) {
        out.z = 12;
        out.x = out.y = out.gp = out.gq = out.gr = 0;
      },
    };
    const e = new Rig('trainer', undefined, head);
    e.ground(0);
    e.input.brake = 1;
    e.run(3);
    expect(e.s.indicatedAirspeed).toBeGreaterThan(10);
    expect(e.s.groundSpeed).toBeLessThan(1.5);
  });

  it('burns fuel, and the engine stops when the tanks are empty', () => {
    const r = new Rig('trainer');
    r.air(1500, 50);
    r.input.throttle = 1;
    r.run(5);
    const f0 = r.s.fuel;
    r.run(30);
    expect(r.s.fuel).toBeLessThan(f0);
    r.fm.setFuelFraction(0.0001);
    r.run(5);
    expect(r.s.engineRunning).toBe(false);
    expect(r.s.thrust).toBeLessThanOrEqual(0);
  });

  it('autopilot holds altitude and heading', () => {
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      const vs = stallSpeeds(r.fm.spec);
      r.air(1200, vs.clean * 1.9, 45);
      r.input.throttle = 0.6;
      r.run(4);
      r.fm.command('toggleAutopilot');
      expect(r.s.autopilot).toBe(true);
      const alt = r.fm.ap.altitude;
      r.run(60);
      expect(Math.abs(r.s.altitude - alt), `${id} alt hold`).toBeLessThan(25);
      expect(Math.abs(r.s.heading - 45), `${id} hdg hold`).toBeLessThan(4);
      expect(Math.abs(r.s.bank)).toBeLessThan(5 * DEG);
    }
  });

  it('the amphibian lands on water; the trainer does not', () => {
    const water = {
      plane: (_x: number, _z: number, out: { h: number; nx: number; ny: number; nz: number }) => {
        out.h = -20;
        out.nx = 0;
        out.ny = 1;
        out.nz = 0;
        return out;
      },
      surface: () => 'water' as const,
    };
    const m = new Rig('sport', water);
    land(m, { gear: false });
    expect(m.s.destroyed).toBe(false);
    expect(m.s.onWater).toBe(true);
    expect(m.s.damage).toBeLessThan(0.05);
    expect(m.s.position.y).toBeGreaterThan(0.2);
    expect(m.s.groundSpeed).toBeLessThan(2);
    // and can take off again from the water
    m.input.brake = 0;
    m.input.throttle = 1;
    m.run(60, (s) => {
      m.input.pitch = s.indicatedAirspeed > 23 ? cl((7 * DEG - s.pitch) * 3, -0.3, 0.5) : 0.1;
      m.input.roll = cl(-s.bank * 2);
    });
    expect(m.s.altitude).toBeGreaterThan(15);

    const t = new Rig('trainer', water);
    land(t);
    expect(t.s.damage).toBeGreaterThan(0.2);
  });
});

describe('ham-fisted take-off', () => {
  it('survives full back stick held from brake release (tail skid, no stall on the ground)', () => {
    for (const id of AIRCRAFT_ORDER) {
      const r = new Rig(id);
      r.ground();
      r.input.throttle = 1;
      r.input.pitch = 1;
      let airborne = false;
      r.run(120, (s) => {
        // the pull is never released and no roll correction is made
        if (!s.onGround) airborne = true;
        return s.destroyed || s.altitudeAgl > 60;
      });
      expect(r.s.destroyed, `${id} not destroyed`).toBe(false);
      expect(airborne, `${id} lifts off`).toBe(true);
      expect(r.s.altitudeAgl, `${id} climbs away`).toBeGreaterThan(50);
      expect(r.s.damage, `${id} damage`).toBeLessThan(0.2);
    }
  });
});
