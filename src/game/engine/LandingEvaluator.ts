/**
 * Watches the flight model's contact events and grades each landing from
 * what actually happened at touchdown. Nothing here moves the aircraft.
 */
import type { AircraftState, LandingReport, SurfaceKind } from '../../types';
import type { AircraftSpec } from '../aircraft/specs';
import type { FlightEvent } from '../physics/FlightModel';
import { SURFACES } from '../physics/environment';
import { airportSurfaceAt, runwayNumber, toRunwayCoords, type AirportDef } from '../world/aerona';

const DEG = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Touchdown {
  time: number;
  ias: number;
  sink: number;
  bank: number;
  pitch: number;
  heading: number;
  track: number;
  x: number;
  z: number;
  gearDown: boolean;
  surface: SurfaceKind;
  noseFirst: boolean;
  damageBefore: number;
  airport: AirportDef | null;
  onRunway: boolean;
}

export class LandingEvaluator {
  private spec: AircraftSpec;
  private phase: 'ground' | 'airborne' | 'rollout' = 'ground';
  private td: Touchdown | null = null;
  private bounces = 0;
  private airTime = 0;
  private rollTime = 0;
  private offGround = 0;

  constructor(spec: AircraftSpec) {
    this.spec = spec;
  }

  reset(airborne: boolean): void {
    this.phase = airborne ? 'airborne' : 'ground';
    this.td = null;
    this.bounces = 0;
    this.airTime = airborne ? 10 : 0;
    this.rollTime = 0;
    this.offGround = 0;
  }

  get rollingOut(): boolean {
    return this.phase === 'rollout';
  }

  /** Feed one fixed step. Returns a report when a landing has completed. */
  update(dt: number, s: AircraftState, events: readonly FlightEvent[]): LandingReport | null {
    if (this.phase === 'ground') {
      if (!s.onGround) {
        this.airTime += dt;
        if (this.airTime > 4 && s.altitudeAgl > 8) this.phase = 'airborne';
      } else this.airTime = 0;
      return null;
    }

    for (const e of events) {
      if (e.type !== 'touchdown') continue;
      if (this.phase === 'airborne') {
        const ap = airportSurfaceAt(s.position.x, s.position.z);
        this.td = {
          time: s.time,
          ias: s.indicatedAirspeed,
          sink: e.sinkRate,
          bank: s.bank,
          pitch: s.pitch,
          heading: s.heading,
          track: ((Math.atan2(s.velocity.x, -s.velocity.z) / DEG) + 360) % 360,
          x: s.position.x,
          z: s.position.z,
          gearDown: s.gear > 0.9,
          surface: e.surface,
          noseFirst: e.point.kind === 'gear' && e.point.label === 'nose',
          damageBefore: s.damage,
          airport: ap ? ap.airport : null,
          onRunway: ap ? ap.onRunway : false,
        };
        this.phase = 'rollout';
        this.bounces = 0;
        this.rollTime = 0;
        this.offGround = 0;
      } else if (this.phase === 'rollout' && this.td) {
        if (e.sinkRate > this.td.sink) this.td.sink = e.sinkRate;
        if (this.offGround > 0.45) this.bounces++;
        this.offGround = 0;
      }
    }

    if (this.phase === 'rollout' && this.td) {
      this.rollTime += dt;
      if (!s.onGround) {
        this.offGround += dt;
        if (this.offGround > 5) {
          // touch-and-go: not a completed landing
          this.phase = 'airborne';
          this.td = null;
          return null;
        }
      }
      if (s.destroyed) {
        this.phase = 'ground';
        this.td = null;
        return null;
      }
      if (s.onGround && s.groundSpeed < 2.5 && this.rollTime > 1.5) {
        const report = this.grade(this.td, s);
        this.phase = 'ground';
        this.td = null;
        this.airTime = 0;
        return report;
      }
    }
    return null;
  }

  private grade(td: Touchdown, s: AircraftState): LandingReport {
    const spec = this.spec;
    const ref = spec.vApproach;
    const water = td.surface === 'water';

    // touchdown speed relative to the reference approach speed
    const ratio = td.ias / ref;
    let speed = 100;
    if (ratio > 1.05) speed = 100 - (ratio - 1.05) * 230;
    else if (ratio < 0.78) speed = 100 - (0.78 - ratio) * 200;

    // sink rate
    const soft = 0.7;
    const descent = td.sink <= soft ? 100 : 100 - ((td.sink - soft) / (spec.maxSinkRate - soft)) * 88;

    // runway alignment
    let alignment: number;
    let alignErr: number | null = null;
    let offset: number | null = null;
    let runway: string | null = null;
    if (td.airport && td.onRunway) {
      const a = td.airport;
      let err = Math.abs((((td.heading - a.heading) % 180) + 180) % 180);
      if (err > 90) err = 180 - err;
      alignErr = err;
      const rc = toRunwayCoords(a, td.x, td.z);
      offset = Math.abs(rc.across);
      const diff = Math.abs(((td.heading - a.heading + 540) % 360) - 180);
      runway = runwayNumber(diff < 90 ? a.heading : a.heading + 180);
      alignment = 100 - (Math.max(0, err - 1.5) / 13) * 100 - (offset / (a.width / 2)) * 35;
    } else if (td.airport) {
      alignment = 45;
    } else if (water) {
      alignment = spec.amphibious ? 85 : 0;
    } else {
      alignment = SURFACES[td.surface].landable ? 62 : 30;
    }

    // stability: wings level, no crab, no bounce, mains first
    let crab = Math.abs(((td.heading - td.track + 540) % 360) - 180);
    if (td.ias < 8) crab = 0;
    let stability = 100 - (Math.max(0, Math.abs(td.bank) / DEG - 2) / 11) * 100 - Math.max(0, crab - 3) * 4 - this.bounces * 22;
    if (td.noseFirst) stability -= 30;

    // configuration
    const gear = water ? (spec.amphibious && !td.gearDown ? 100 : 0) : td.gearDown ? 100 : 0;

    const scores = {
      speed: Math.round(clamp01(speed / 100) * 100),
      descent: Math.round(clamp01(descent / 100) * 100),
      alignment: Math.round(clamp01(alignment / 100) * 100),
      stability: Math.round(clamp01(stability / 100) * 100),
      gear,
    };
    const damage = Math.max(0, s.damage - td.damageBefore);
    let total = scores.speed * 0.22 + scores.descent * 0.3 + scores.alignment * 0.2 + scores.stability * 0.18 + scores.gear * 0.1;
    total *= 1 - Math.min(0.9, damage * 1.6);
    if (gear === 0) total = Math.min(total, 45);
    total = Math.round(total);
    const grade: LandingReport['grade'] = total >= 93 ? 'S' : total >= 84 ? 'A' : total >= 72 ? 'B' : total >= 58 ? 'C' : total >= 40 ? 'D' : 'F';

    const where = td.airport ? (td.onRunway ? `${td.airport.name}, runway ${runway}` : `${td.airport.name} (off the runway)`) : water ? 'on the water' : `off-field (${td.surface})`;
    const notes: string[] = [];
    if (gear === 0) notes.push(water ? 'wheels were down on water' : 'gear was up');
    if (td.sink > spec.maxSinkRate) notes.push('very hard touchdown');
    else if (td.sink > spec.maxSinkRate * 0.6) notes.push('firm touchdown');
    else if (td.sink < 0.8) notes.push('feather-soft touchdown');
    if (ratio > 1.2) notes.push('too fast');
    if (this.bounces > 0) notes.push(`${this.bounces} bounce${this.bounces > 1 ? 's' : ''}`);
    if (alignErr !== null && alignErr > 6) notes.push('poorly aligned');
    if (offset !== null && td.airport && offset < td.airport.width * 0.12 && (alignErr ?? 9) < 3) notes.push('on the centreline');
    if (damage > 0.02) notes.push('aircraft damaged');

    return {
      time: td.time,
      airport: td.airport ? td.airport.name : null,
      runway,
      surface: td.surface,
      touchdownSpeed: td.ias,
      referenceSpeed: ref,
      verticalSpeed: td.sink,
      alignmentError: alignErr,
      centerlineOffset: offset,
      bank: td.bank / DEG,
      pitch: td.pitch / DEG,
      gearDown: td.gearDown,
      bounces: this.bounces,
      damage,
      scores,
      total,
      grade,
      summary: `Landed ${where}${notes.length ? ' — ' + notes.join(', ') : ''}.`,
    };
  }
}
