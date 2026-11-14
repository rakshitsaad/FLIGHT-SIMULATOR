import { describe, expect, it } from 'vitest';
import { Vector3, Quaternion } from 'three';
import { Simulation } from '../src/game/engine/Simulation';
import { getStructures } from '../src/game/world/structures';
import { AIRPORTS, fromRunwayCoords, getAirport } from '../src/game/world/aerona';
import { ReplayPlayer } from '../src/game/replay/FlightRecorder';
import type { FlightInput } from '../src/types';

const DEG = Math.PI / 180;
const cl = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

describe('simulation engine', () => {
  it('generates a city, airports and villages without blocking any runway', () => {
    const s = getStructures();
    expect(s.filter((b) => b.style === 'tower').length).toBeGreaterThan(40);
    expect(s.length).toBeGreaterThan(2500);
    expect(s.length).toBeLessThan(9000);
    for (const a of AIRPORTS) {
      for (let t = -0.5; t <= 0.5; t += 0.05) {
        const p = fromRunwayCoords(a, a.length * t, 0);
        for (const b of s) {
          const d = Math.hypot(b.x - p.x, b.z - p.z);
          expect(d, `${a.name} runway clear of ${b.style}`).toBeGreaterThan(Math.max(b.w, b.d) / 2 + a.width / 2 + 5);
        }
      }
    }
  });

  it('flies a full circuit at Aerona International on real terrain: takeoff → pattern → graded landing → replay', () => {
    const sim = new Simulation();
    const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, source: 'keyboard' };
    sim.inputSource = () => input;
    const events: string[] = [];
    let report: any = null;
    sim.events.on((e) => {
      events.push(e.type);
      if (e.type === 'landing') report = e.report;
    });
    sim.start('trainer', 'aia');
    const s = () => sim.state;
    const a = getAirport('aia')!;
    const run = (sec: number, pilot: () => boolean | void) => {
      for (let i = 0; i < sec * 60; i++) {
        if (pilot()) return;
        sim.update(1 / 60);
      }
    };
    const hdgHold = (target: number, bankLimit = 25) => {
      const err = ((target - s().heading + 540) % 360) - 180;
      const bankT = cl(err * 1.5, -bankLimit, bankLimit) * DEG;
      input.roll = cl((bankT - s().bank) * 2.5 + s().angularVelocity.z * 0.5);
    };
    const altHold = (alt: number, vsMax = 4) => {
      const vsT = cl((alt - s().altitude) * 0.2, -vsMax, vsMax);
      input.pitch = cl((vsT - s().verticalSpeed) * 0.15 - s().angularVelocity.x * 0.8, -0.5, 0.6);
    };
    expect(s().altitude).toBeCloseTo(a.elevation, 0);
    // takeoff on runway 09
    input.throttle = 1;
    run(100, () => {
      input.pitch = s().indicatedAirspeed > 29 ? (s().onGround ? 0.5 : cl((8 * DEG - s().pitch) * 3, -0.3, 0.5)) : 0;
      hdgHold(90, 10);
      input.yaw = s().onGround ? cl((((90 - s().heading + 540) % 360) - 180) * 0.2) : 0;
      return s().altitude > a.elevation + 150;
    });
    expect(s().altitude).toBeGreaterThan(a.elevation + 140);
    expect(events).toContain('liftoff');
    sim.command('toggleGear');
    // left-hand pattern: crosswind (north), downwind (west), base, final
    run(40, () => { altHold(a.elevation + 300); hdgHold(0); input.throttle = 0.8; return Math.abs(s().heading - 0) < 4 || s().heading > 356; });
    run(30, () => { altHold(a.elevation + 300); hdgHold(0); return s().position.z < a.z - 1800; });
    run(200, () => { altHold(a.elevation + 300); hdgHold(270); input.throttle = 0.6; return s().position.x < a.x - a.length / 2 - 3200; });
    sim.command('toggleGear');
    sim.command('flapsDown');
    run(60, () => { altHold(a.elevation + 220); hdgHold(180); input.throttle = 0.45; return s().position.z > a.z - 420; });
    sim.command('flapsDown');
    sim.command('flapsDown');
    expect(s().gearDown).toBe(true);
    // final: track the centreline, 3° glide path to the threshold, flare
    const thr = fromRunwayCoords(a, -a.length / 2 + 200, 0);
    let touched = false;
    run(240, () => {
      const st = s();
      if (st.onGround) touched = true;
      const cross = st.position.z - a.z; // + = south of centreline
      hdgHold(90 - cl(cross * 0.12, -30, 30), 20);
      const dist = thr.x - st.position.x;
      const agl = st.altitude - a.elevation;
      const pathAlt = Math.max(0, dist) * Math.tan(3.2 * DEG);
      const vsT = touched ? -0.3 : agl < 2.5 ? -0.5 : agl < 8 ? -1.2 : cl((pathAlt - agl) * 0.3 - 2.2, -5, 1);
      input.pitch = touched ? -0.05 : cl((vsT - st.verticalSpeed) * 0.2 - st.angularVelocity.x * 0.8, -0.5, 0.8);
      input.throttle = touched || agl < 4 ? 0 : cl(0.3 + (31 - st.indicatedAirspeed) * 0.12, 0, 1);
      input.brake = touched && st.wheelsOnGround >= 2 ? 1 : 0;
      input.yaw = touched ? cl((((90 - st.heading + 540) % 360) - 180) * 0.15) : 0;
      return report !== null;
    });
    if (!report) console.log('DEBUG', JSON.stringify({ mode: sim.mode, crash: sim.crashCause, pos: s().position, gs: s().groundSpeed, hdg: s().heading, dmg: s().damage, onG: s().onGround, t: s().time, surf: s().surface, ev: events.filter((e) => e !== 'touchdown').join(',') }));
    expect(touched).toBe(true);
    expect(report, 'landing was graded').not.toBeNull();
    expect(report.airport).toBe('Aerona International');
    expect(report.runway).toBe('09');
    expect(report.gearDown).toBe(true);
    expect(report.total).toBeGreaterThan(55);
    expect(s().damage).toBeLessThan(0.05);
    expect(Math.abs(s().position.z - a.z)).toBeLessThan(a.width / 2);

    // the flight was recorded and can be replayed
    const rec = sim.finishFlight()!;
    expect(rec).not.toBeNull();
    expect(rec.frames.length).toBeGreaterThan(500);
    expect(rec.maxAltitude).toBeGreaterThan(a.elevation + 250);
    expect(rec.landing?.total).toBe(report.total);
    const player = new ReplayPlayer(rec);
    player.seek(player.duration * 0.5);
    expect(player.position.y).toBeGreaterThan(a.elevation + 100);
    player.seek(player.duration);
    expect(player.position.distanceTo(new Vector3(s().position.x, s().position.y, s().position.z))).toBeLessThan(5);
    sim.startReplay(rec);
    sim.update(0.5);
    expect(sim.mode).toBe('replay');
    expect(sim.view.position.distanceTo(new Vector3(rec.frames[0].px, rec.frames[0].py, rec.frames[0].pz))).toBeLessThan(30);
  }, 30000);

  it('uses Rapier to detect structure collisions and to simulate crash debris', async () => {
    const sim = new Simulation();
    await sim.initCollision();
    const cw = sim.collision!;
    expect(cw.structureCount).toBe(getStructures().length);
    const tower = getStructures().find((b) => b.style === 'tower')!;
    const q = new Quaternion();
    expect(cw.test(new Vector3(tower.x, tower.y + tower.h * 0.5, tower.z), q)).not.toBeNull();
    expect(cw.test(new Vector3(tower.x, tower.y + tower.h + 80, tower.z), q)).toBeNull();

    // fly straight into the tower
    const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, brake: 0, source: 'keyboard' };
    sim.inputSource = () => input;
    sim.start('trainer', 'air-city');
    sim.model.reset({ x: tower.x, y: tower.y + tower.h * 0.6, z: tower.z + 500, heading: 0, speed: 55, airborne: true });
    let crash = '';
    sim.events.on((e) => {
      if (e.type === 'crash') crash = e.cause;
    });
    for (let i = 0; i < 60 * 20 && !crash; i++) sim.update(1 / 60);
    expect(crash).toContain('skyscraper');
    expect(sim.mode).toBe('crashed');
    expect(cw.debris.length).toBeGreaterThan(8);
    const y0 = cw.debris[0].body.translation().y;
    for (let i = 0; i < 120; i++) sim.update(1 / 60);
    expect(cw.debris[0].body.translation().y).toBeLessThan(y0);
    sim.respawn();
    expect(sim.mode).toBe('flying');
    expect(cw.debris.length).toBe(0);
  }, 30000);
});
