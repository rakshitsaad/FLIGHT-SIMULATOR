/**
 * AERONA — the handcrafted layout of the world. Pure data + small geometry
 * helpers; no rendering code. Coordinates are metres: +x east, +z south.
 *
 *                 N (-z)
 *   BADLANDS   HIGHLANDS   GREENBELT
 *      (W)    METROPOLIS      (E)
 *   OPEN SKY  ~~~ ocean ~~~ ARCHIPELAGO
 */
import type { SurfaceKind } from '../../types';

export type RegionId = 'metropolis' | 'highlands' | 'archipelago' | 'badlands' | 'greenbelt' | 'opensky';

export interface RegionDef {
  id: RegionId;
  name: string;
  tagline: string;
  /** Label anchor for the world map. */
  x: number;
  z: number;
  color: string;
}

export const REGIONS: RegionDef[] = [
  { id: 'metropolis', name: 'METROPOLIS', tagline: 'Skyscrapers, highways and Aerona International', x: -800, z: -4000, color: '#9fb6d6' },
  { id: 'highlands', name: 'HIGHLANDS', tagline: 'Peaks, deep valleys and mountain airstrips', x: -1000, z: -21500, color: '#c9d2dc' },
  { id: 'archipelago', name: 'ARCHIPELAGO', tagline: 'Tropical islands, lagoons and beaches', x: 13500, z: 17000, color: '#5fd6c1' },
  { id: 'badlands', name: 'BADLANDS', tagline: 'Deserts, mesas and Serpent Canyon', x: -19500, z: -11000, color: '#e0a166' },
  { id: 'greenbelt', name: 'GREENBELT', tagline: 'Farmland, rivers, villages and grass strips', x: 19000, z: -9000, color: '#8fce6a' },
  { id: 'opensky', name: 'OPEN SKY', tagline: 'Open ocean, remote islands and storm cells', x: -15000, z: 19000, color: '#6aa9ff' },
];

/* ------------------------------------------------------------- airports */

export type AirportKind = 'international' | 'regional' | 'grass' | 'mountain' | 'island' | 'dirt';

export interface AirportDef {
  id: string;
  name: string;
  code: string;
  region: RegionId;
  kind: AirportKind;
  x: number;
  z: number;
  elevation: number;
  /** True heading (degrees) of the "forward" runway direction. */
  heading: number;
  length: number;
  width: number;
  surface: SurfaceKind;
  lights: boolean;
  /** Extra flattened ground around the runway (metres). */
  pad: number;
  /** Width of the smooth blend from the pad into natural terrain. */
  blend: number;
}

export const AIRPORTS: AirportDef[] = [
  { id: 'aia', name: 'Aerona International', code: 'AIA', region: 'metropolis', kind: 'international', x: 5200, z: -700, elevation: 9, heading: 90, length: 3200, width: 60, surface: 'asphalt', lights: true, pad: 520, blend: 500 },
  { id: 'greenbelt', name: 'Greenbelt Regional', code: 'GBR', region: 'greenbelt', kind: 'regional', x: 17000, z: -6000, elevation: 31, heading: 120, length: 1500, width: 32, surface: 'asphalt', lights: true, pad: 260, blend: 450 },
  { id: 'willowbrook', name: 'Willowbrook Field', code: 'WLB', region: 'greenbelt', kind: 'grass', x: 21500, z: -14000, elevation: 46, heading: 20, length: 760, width: 26, surface: 'grass', lights: false, pad: 140, blend: 350 },
  { id: 'eagle', name: "Eagle's Perch", code: 'EGP', region: 'highlands', kind: 'mountain', x: -2200, z: -20200, elevation: 1340, heading: 60, length: 640, width: 22, surface: 'asphalt', lights: true, pad: 150, blend: 520 },
  { id: 'stonegate', name: 'Stonegate Valley', code: 'STG', region: 'highlands', kind: 'mountain', x: 5200, z: -18300, elevation: 430, heading: 165, length: 920, width: 24, surface: 'asphalt', lights: true, pad: 170, blend: 480 },
  { id: 'drygulch', name: 'Dry Gulch', code: 'DGU', region: 'badlands', kind: 'dirt', x: -20500, z: -8200, elevation: 395, heading: 35, length: 1500, width: 34, surface: 'dirt', lights: false, pad: 200, blend: 500 },
  { id: 'coral', name: 'Coral Cay', code: 'CRL', region: 'archipelago', kind: 'island', x: 11000, z: 16300, elevation: 5, heading: 75, length: 960, width: 26, surface: 'asphalt', lights: true, pad: 130, blend: 260 },
  { id: 'zephyr', name: 'Outpost Zephyr', code: 'ZPH', region: 'opensky', kind: 'island', x: -21000, z: 21000, elevation: 6, heading: 100, length: 860, width: 24, surface: 'asphalt', lights: true, pad: 120, blend: 240 },
];

export interface RunwayFrame {
  /** Unit vector along the runway heading. */
  ax: number;
  az: number;
  /** Unit vector to the right of the heading. */
  rx: number;
  rz: number;
}

const DEG = Math.PI / 180;
const frames = new Map<string, RunwayFrame>();

export function runwayFrame(a: AirportDef): RunwayFrame {
  let f = frames.get(a.id);
  if (!f) {
    const h = a.heading * DEG;
    f = { ax: Math.sin(h), az: -Math.cos(h), rx: Math.cos(h), rz: Math.sin(h) };
    frames.set(a.id, f);
  }
  return f;
}

/** Position in runway coordinates: `along` the heading and `across` to the right. */
export function toRunwayCoords(a: AirportDef, x: number, z: number): { along: number; across: number } {
  const f = runwayFrame(a);
  const dx = x - a.x;
  const dz = z - a.z;
  return { along: dx * f.ax + dz * f.az, across: dx * f.rx + dz * f.rz };
}

export function fromRunwayCoords(a: AirportDef, along: number, across: number): { x: number; z: number } {
  const f = runwayFrame(a);
  return { x: a.x + f.ax * along + f.rx * across, z: a.z + f.az * along + f.rz * across };
}

/** Runway designator, e.g. heading 90 → "09". */
export function runwayNumber(heading: number): string {
  let n = Math.round((((heading % 360) + 360) % 360) / 10);
  if (n === 0) n = 36;
  return n.toString().padStart(2, '0');
}

/** Apron (parking) rectangle in runway coordinates, to the right of the runway. */
export function apronRect(a: AirportDef): { along0: number; along1: number; across0: number; across1: number } {
  const depth = a.kind === 'international' ? 330 : a.kind === 'regional' ? 150 : 70;
  const half = a.kind === 'international' ? 900 : a.kind === 'regional' ? 260 : 90;
  const off = a.width / 2 + (a.kind === 'international' ? 150 : 45);
  return { along0: -half, along1: half, across0: off, across1: off + depth };
}

/**
 * Surface that the aircraft would touch at (x,z) inside an airport, or null.
 */
export function airportSurfaceAt(x: number, z: number): { airport: AirportDef; onRunway: boolean; surface: SurfaceKind } | null {
  for (const a of AIRPORTS) {
    const dx = x - a.x;
    const dz = z - a.z;
    const reach = a.length / 2 + a.pad;
    if (dx * dx + dz * dz > reach * reach) continue;
    const { along, across } = toRunwayCoords(a, x, z);
    if (Math.abs(along) <= a.length / 2 && Math.abs(across) <= a.width / 2) {
      return { airport: a, onRunway: true, surface: a.surface };
    }
    const ap = apronRect(a);
    const inApron = along >= ap.along0 && along <= ap.along1 && across >= a.width / 2 && across <= ap.across1;
    if (inApron && a.surface === 'asphalt') return { airport: a, onRunway: false, surface: 'asphalt' };
    if (Math.abs(along) <= a.length / 2 + a.pad && Math.abs(across) <= a.pad) {
      return { airport: a, onRunway: false, surface: a.surface === 'dirt' ? 'dirt' : 'grass' };
    }
  }
  return null;
}

export function nearestAirport(x: number, z: number): { airport: AirportDef; distance: number; bearing: number } {
  let best = AIRPORTS[0];
  let bd = Infinity;
  for (const a of AIRPORTS) {
    const d = Math.hypot(a.x - x, a.z - z);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  const bearing = (Math.atan2(best.x - x, -(best.z - z)) / DEG + 360) % 360;
  return { airport: best, distance: bd, bearing };
}

/* ----------------------------------------------------------- land forms */

export const CITY = { x: -800, z: -4000, radius: 3600, elevation: 14 };

/** The Silverrun river: Lake Mirror → Aerona Bay. Carved to sea level. */
export const RIVER: [number, number][] = [
  [7000, -12500],
  [8600, -10200],
  [7200, -7700],
  [9000, -5200],
  [8100, -2600],
  [9500, -600],
  [9100, 1400],
  [9700, 4200],
];
export const LAKE = { x: 7000, z: -12700, radius: 950 };

/** Stonegate valley — a deep corridor through the Highlands. */
export const VALLEY: [number, number][] = [
  [7000, -12700],
  [6100, -15400],
  [5200, -18300],
  [2800, -21800],
  [-1200, -24600],
  [-6000, -26200],
];

/** Serpent Canyon — the main gorge of the Badlands. */
export const CANYON: [number, number][] = [
  [-12500, -21500],
  [-15800, -17500],
  [-14200, -13200],
  [-16800, -9800],
  [-15200, -6200],
  [-18600, -3200],
  [-22500, -900],
  [-25500, 1500],
];

export interface IslandDef {
  name?: string;
  x: number;
  z: number;
  r: number;
  peak: number;
  region: RegionId;
}

export const ISLANDS: IslandDef[] = [
  { name: 'Coral Cay', x: 11000, z: 16000, r: 2400, peak: 70, region: 'archipelago' },
  { name: 'Mount Ember', x: 15400, z: 13200, r: 1700, peak: 360, region: 'archipelago' },
  { name: 'Palm Atoll', x: 7400, z: 19800, r: 1150, peak: 30, region: 'archipelago' },
  { name: 'Tidewater', x: 16800, z: 19200, r: 1900, peak: 150, region: 'archipelago' },
  { x: 13200, z: 21800, r: 950, peak: 38, region: 'archipelago' },
  { x: 19800, z: 15600, r: 1050, peak: 80, region: 'archipelago' },
  { x: 8800, z: 12200, r: 850, peak: 28, region: 'archipelago' },
  { name: 'Skyhook Isle', x: 21000, z: 21500, r: 1400, peak: 250, region: 'archipelago' },
  { x: 13600, z: 17400, r: 420, peak: 6, region: 'archipelago' },
  { x: 9300, z: 22300, r: 380, peak: 5, region: 'archipelago' },
  { x: 18200, z: 22400, r: 460, peak: 7, region: 'archipelago' },
  { name: 'Lighthouse Rock', x: 5600, z: 8800, r: 380, peak: 26, region: 'archipelago' },
  { name: 'Outpost Zephyr', x: -21000, z: 20900, r: 1800, peak: 55, region: 'opensky' },
  { name: 'Stormwatch Rock', x: -9000, z: 27000, r: 760, peak: 170, region: 'opensky' },
  { name: 'The Needle', x: -28000, z: 12500, r: 560, peak: 290, region: 'opensky' },
  { x: -15500, z: 30500, r: 900, peak: 60, region: 'opensky' },
];

/* -------------------------------------------------------------- highways */

export interface HighwayDef {
  id: string;
  width: number;
  points: [number, number][];
}

export const HIGHWAYS: HighwayDef[] = [
  {
    id: 'ring',
    width: 26,
    points: (() => {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        pts.push([CITY.x + Math.cos(a) * 2750, CITY.z + Math.sin(a) * 2750 * 0.82]);
      }
      return pts;
    })(),
  },
  { id: 'airport', width: 24, points: [[1700, -3300], [2600, -2700], [3600, -2250], [4700, -1900], [5200, -1500]] },
  { id: 'east', width: 26, points: [[1900, -4100], [3600, -4000], [5600, -3400], [7300, -2750], [8100, -2600], [8900, -2450], [11000, -3000], [13500, -4400], [16000, -5300], [16700, -5450]] },
  { id: 'north', width: 22, points: [[-600, -6250], [0, -8200], [1500, -10200], [3800, -11600], [5700, -12400]] },
  { id: 'west', width: 22, points: [[-3500, -4300], [-5600, -4700], [-8000, -5600], [-10500, -6100], [-12800, -6900]] },
  { id: 'farm', width: 16, points: [[16700, -5450], [18200, -7400], [19500, -10200], [21000, -12800], [21400, -13600]] },
];

/** Bridges are handcrafted: a suspension bridge and a girder bridge over the Silverrun. */
export const BRIDGES = [
  { id: 'gate', name: 'Aerona Gate Bridge', kind: 'suspension' as const, x: 8100, z: -2600, heading: 80, length: 1150, width: 30, deck: 58, tower: 190 },
  { id: 'mill', name: 'Millrace Bridge', kind: 'girder' as const, x: 7250, z: -7700, heading: 95, length: 700, width: 16, deck: 30, tower: 0 },
];

export interface VillageDef {
  name: string;
  x: number;
  z: number;
  radius: number;
  houses: number;
}

export const VILLAGES: VillageDef[] = [
  { name: 'Willowbrook', x: 20900, z: -13300, radius: 420, houses: 70 },
  { name: 'Fernhollow', x: 14800, z: -9600, radius: 380, houses: 60 },
  { name: 'Larkspur', x: 19800, z: -3200, radius: 400, houses: 64 },
  { name: 'Millrace', x: 10800, z: -7300, radius: 340, houses: 48 },
  { name: 'Hazelmere', x: 24200, z: -8300, radius: 360, houses: 52 },
  { name: 'Pinewatch', x: 5900, z: -16200, radius: 260, houses: 30 },
  { name: 'Coral Harbour', x: 10400, z: 15400, radius: 300, houses: 40 },
  { name: 'Dry Gulch', x: -19600, z: -7300, radius: 240, houses: 22 },
];

export interface LandmarkDef {
  id: string;
  name: string;
  kind: 'lighthouse' | 'observatory' | 'radiotower' | 'turbines' | 'arch' | 'gates' | 'stadium' | 'spire' | 'dam';
  x: number;
  z: number;
}

export const LANDMARKS: LandmarkDef[] = [
  { id: 'spire', name: 'Aerona Spire', kind: 'spire', x: -700, z: -4300 },
  { id: 'stadium', name: 'Skyline Stadium', kind: 'stadium', x: 1500, z: -5600 },
  { id: 'lighthouse', name: 'Lighthouse Rock', kind: 'lighthouse', x: 5600, z: 8800 },
  { id: 'observatory', name: 'Highpeak Observatory', kind: 'observatory', x: -6200, z: -18600 },
  { id: 'radio', name: 'Ridgeline Relay', kind: 'radiotower', x: 9800, z: -20500 },
  { id: 'turbines', name: 'Larkspur Wind Farm', kind: 'turbines', x: 22500, z: -4600 },
  { id: 'arch', name: 'Sunfire Arch', kind: 'arch', x: -23500, z: -13200 },
  { id: 'gates', name: 'Zephyr Gates', kind: 'gates', x: -13500, z: 15500 },
];

/** Ring course over the Open Sky experimental area. */
export const GATES: { x: number; y: number; z: number; heading: number; radius: number }[] = (() => {
  const g: { x: number; y: number; z: number; heading: number; radius: number }[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 3200 + Math.sin(a * 2) * 700;
    g.push({
      x: -13500 + Math.cos(a) * rad,
      z: 15500 + Math.sin(a) * rad,
      y: 320 + Math.sin(a * 3) * 170,
      heading: (Math.atan2(-Math.sin(a), -Math.cos(a)) / DEG + 360) % 360,
      radius: 55,
    });
  }
  return g;
})();

/** The roaming Open Sky storm cell (position is a function of time). */
export const STORM_CELL = { cx: -11000, cz: 23500, orbit: 6500, radius: 5200, period: 1500 };

export function stormCellPosition(t: number): { x: number; z: number } {
  const a = (t / STORM_CELL.period) * Math.PI * 2;
  return { x: STORM_CELL.cx + Math.cos(a) * STORM_CELL.orbit, z: STORM_CELL.cz + Math.sin(a * 0.7) * STORM_CELL.orbit * 0.6 };
}

/* ----------------------------------------------------------- spawn points */

export interface SpawnPoint {
  id: string;
  label: string;
  airportId?: string;
  airborne: boolean;
  x: number;
  z: number;
  /** Altitude MSL for airborne spawns. */
  altitude?: number;
  heading: number;
}

export const SPAWNS: SpawnPoint[] = [
  ...AIRPORTS.map((a): SpawnPoint => {
    const start = fromRunwayCoords(a, -a.length / 2 + Math.min(90, a.length * 0.08), 0);
    return { id: a.id, label: `${a.name} — runway ${runwayNumber(a.heading)}`, airportId: a.id, airborne: false, x: start.x, z: start.z, heading: a.heading };
  }),
  { id: 'air-city', label: 'Airborne — over Metropolis', airborne: true, x: -4500, z: -1500, altitude: 900, heading: 80 },
  { id: 'air-highlands', label: 'Airborne — Highlands ridge', airborne: true, x: 3000, z: -13500, altitude: 2400, heading: 330 },
  { id: 'air-islands', label: 'Airborne — Archipelago', airborne: true, x: 9000, z: 11000, altitude: 700, heading: 150 },
  { id: 'air-badlands', label: 'Airborne — Serpent Canyon', airborne: true, x: -12500, z: -9000, altitude: 1100, heading: 270 },
  { id: 'air-final', label: 'Airborne — 4 km final, AIA runway 09', airborne: true, x: 5200 - 1600 - 4000, z: -700, altitude: 230, heading: 90 },
  { id: 'air-gates', label: 'Airborne — Zephyr Gates', airborne: true, x: -13500, z: 10500, altitude: 500, heading: 180 },
];

export function getAirport(id: string): AirportDef | undefined {
  return AIRPORTS.find((a) => a.id === id);
}
