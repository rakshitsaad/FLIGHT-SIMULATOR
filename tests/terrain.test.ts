import { describe, expect, it } from 'vitest';
import { groundPlaneAt, heightAt, regionAt } from '../src/game/terrain/heightfield';
import { AIRPORTS, fromRunwayCoords } from '../src/game/world/aerona';

describe('AERONA terrain', () => {
  it('keeps every runway perfectly level at the airport elevation', () => {
    for (const a of AIRPORTS) {
      for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
        for (const off of [-a.width / 2, 0, a.width / 2]) {
          const p = fromRunwayCoords(a, a.length * t, off);
          expect(heightAt(p.x, p.z)).toBeCloseTo(a.elevation, 3);
          const g = groundPlaneAt(p.x, p.z);
          expect(g.h).toBeCloseTo(a.elevation, 3);
          expect(g.ny).toBeGreaterThan(0.9999);
        }
      }
    }
  });
  it('has mountains, canyons, sea and distinct regions', () => {
    let max = -Infinity;
    for (let x = -14000; x <= 12000; x += 500) for (let z = -27000; z <= -15000; z += 500) max = Math.max(max, heightAt(x, z));
    expect(max).toBeGreaterThan(1800);
    expect(heightAt(0, 12000)).toBeLessThan(-10);
    expect(heightAt(-15800, -17500)).toBeLessThan(heightAt(-18500, -17500) - 120);
    expect(regionAt(-800, -4000)).toBe('metropolis');
    expect(regionAt(-1000, -21500)).toBe('highlands');
    expect(regionAt(19000, -9000)).toBe('greenbelt');
    expect(regionAt(-19500, -11000)).toBe('badlands');
    expect(regionAt(13500, 17000)).toBe('archipelago');
    expect(regionAt(-15000, 19000)).toBe('opensky');
  });
});
