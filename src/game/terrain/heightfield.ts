/**
 * Procedural terrain of AERONA: one continuous height function for the whole
 * world. Used by the terrain worker (meshes), by the flight model (ground
 * contact) and by the world map. Deterministic and allocation-free.
 */
import { AIRPORTS, CANYON, CITY, ISLANDS, LAKE, RIVER, VALLEY, runwayFrame, type RegionId } from '../world/aerona';
import { clamp, distToPolyline, fbm, hash2, lerp, ridged, simplex2, smoothstep } from './noise';

export const SEA_LEVEL = 0;
export const CHUNK_SIZE = 2048;

export interface TerrainSample {
  h: number;
  /** Region weights 0..1 */
  wHigh: number;
  wBad: number;
  wGreen: number;
  wCity: number;
  wIsle: number;
  /** 1 on an airport pad. */
  wPad: number;
  /** Metres inland from the mainland coast (negative = sea). */
  inland: number;
  /** 1 in the canyon floor / valley floor. */
  canyon: number;
}

export function makeSample(): TerrainSample {
  return { h: 0, wHigh: 0, wBad: 0, wGreen: 0, wCity: 0, wIsle: 0, wPad: 0, inland: 0, canyon: 0 };
}

const scratch = makeSample();

function mainlandSdf(x: number, z: number): number {
  const hx = 27000;
  const hz = 15000;
  const r = 7000;
  const qx = Math.abs(x) - (hx - r);
  const qz = Math.abs(z + 14000) - (hz - r);
  const ox = qx > 0 ? qx : 0;
  const oz = qz > 0 ? qz : 0;
  let d = Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - r;
  d += 1700 * simplex2(x / 6500, z / 6500) + 520 * simplex2(x / 1700 + 40, z / 1700 - 12);
  return d;
}

/** Full terrain sample: height plus the biome weights used for colouring. */
export function sampleTerrain(x: number, z: number, out: TerrainSample = scratch): TerrainSample {
  const d = mainlandSdf(x, z);
  const inland = -d;
  out.inland = inland;
  out.wHigh = 0;
  out.wBad = 0;
  out.wGreen = 0;
  out.wCity = 0;
  out.wIsle = 0;
  out.wPad = 0;
  out.canyon = 0;

  let h = -24 - 30 * smoothstep(0, 3500, d) + 5 * simplex2(x / 900, z / 900);

  if (inland > -400) {
    const land = smoothstep(-350, 450, inland);
    let hl = 5 + 22 * smoothstep(200, 5000, inland) + 11 * fbm(x / 4200, z / 4200, 3) + 2.5 * simplex2(x / 600, z / 600);

    const edge = smoothstep(500, 4500, inland);
    // ---- Highlands
    const wz = smoothstep(-10500, -16500, z + 1800 * simplex2(x / 8000, z / 8000 + 5));
    const wx = smoothstep(-17500, -9500, x) * (1 - smoothstep(9000, 16500, x));
    const wH = wz * wx * edge;
    if (wH > 0.002) {
      const m = ridged(x / 5200 + 3.1, z / 5200 - 1.7, 5);
      const m2 = fbm(x / 1400, z / 1400, 3);
      let mh = 250 + 2350 * Math.pow(m, 1.35) + 120 * m2;
      const dv = distToPolyline(x, z, VALLEY);
      if (dv < 3400) {
        const vm = smoothstep(320, 3300, dv);
        mh = lerp(205 + 45 * m2, mh, vm);
        out.canyon = 1 - smoothstep(200, 900, dv);
      }
      hl += wH * mh;
    }
    out.wHigh = wH;

    // ---- Badlands
    const wB = smoothstep(-9500, -14500, x + 1500 * simplex2(z / 7000 + 9, x / 7000)) * (1 - wH) * smoothstep(300, 3500, inland);
    if (wB > 0.002) {
      let bh = 330 + 90 * fbm(x / 3800 + 7, z / 3800, 3);
      bh += 135 * smoothstep(0.34, 0.5, simplex2(x / 1900 + 50, z / 1900 - 20));
      const step = 45;
      const tt = bh / step;
      const fl = Math.floor(tt);
      bh = (fl + smoothstep(0.3, 0.7, tt - fl)) * step;
      const side = 1 - smoothstep(0.03, 0.14, Math.abs(simplex2(x / 3100 - 8, z / 3100 + 3)));
      bh -= 150 * side;
      const dc = distToPolyline(x, z, CANYON);
      if (dc < 900) {
        // stepped canyon walls
        const cm = 1 - smoothstep(150, 760, dc);
        const stepped = Math.floor(cm * 4) / 4 + smoothstep(0.55, 0.95, (cm * 4) % 1) / 4;
        bh = lerp(bh, 92 + 8 * simplex2(x / 300, z / 300), clamp(stepped * 1.05, 0, 1));
        out.canyon = Math.max(out.canyon, 1 - smoothstep(150, 330, dc));
      }
      hl = lerp(hl, hl * 0.2 + bh, wB);
    }
    out.wBad = wB;

    // ---- Greenbelt
    const wG = smoothstep(9500, 13500, x) * (1 - wH);
    if (wG > 0.002) hl += wG * (13 + 15 * fbm(x / 2300 - 4, z / 2300 + 2, 3));
    out.wGreen = wG;

    // ---- Silverrun river + Lake Mirror
    if (x > 5600 && x < 11200 && z > -14500 && z < 6000) {
      let dr = distToPolyline(x, z, RIVER);
      const dl = Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.radius;
      if (dl < dr) dr = dl < 0 ? 0 : dl;
      if (dr < 520) hl = lerp(hl, -6, 1 - smoothstep(75, 500, dr));
    }

    h = lerp(h, hl, land);
  }

  // ---- Islands
  if (inland < 0) {
    for (let i = 0; i < ISLANDS.length; i++) {
      const isl = ISLANDS[i];
      const dx = x - isl.x;
      const dz = z - isl.z;
      const lim = isl.r * 1.5;
      if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
      const warp = 1 + 0.2 * simplex2(x / 620 + isl.x, z / 620 - isl.z) + 0.07 * simplex2(x / 190, z / 190);
      const dn = (Math.sqrt(dx * dx + dz * dz) / isl.r) * warp;
      const b = 1 - dn * dn;
      if (b <= 0) continue;
      const hi = -22 + 27 * smoothstep(0, 0.36, b) + isl.peak * Math.pow(b, 2.4) + 3 * b * simplex2(x / 260, z / 260);
      if (hi > h) {
        h = hi;
        out.wIsle = smoothstep(0, 0.3, b);
      }
    }
  }

  // ---- Metropolis is built on levelled ground
  {
    const dx = x - CITY.x;
    const dz = z - CITY.z;
    const lim = CITY.radius * 1.2;
    if (dx < lim && dx > -lim && dz < lim && dz > -lim) {
      const dc = Math.sqrt(dx * dx + dz * dz);
      const wc = 1 - smoothstep(CITY.radius * 0.8, CITY.radius * 1.18, dc);
      if (wc > 0) {
        h = lerp(h, CITY.elevation + 1.5 * simplex2(x / 900, z / 900), wc);
        out.wCity = wc;
        out.wHigh *= 1 - wc;
      }
    }
  }

  // ---- Airports: exact level pads blended into the terrain
  for (let i = 0; i < AIRPORTS.length; i++) {
    const a = AIRPORTS[i];
    const dx = x - a.x;
    const dz = z - a.z;
    const reach = a.length / 2 + a.pad + a.blend;
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
    const f = runwayFrame(a);
    const along = Math.abs(dx * f.ax + dz * f.az) - (a.length / 2 + a.pad);
    const across = Math.abs(dx * f.rx + dz * f.rz) - a.pad;
    const ex = along > 0 ? along : 0;
    const ez = across > 0 ? across : 0;
    const dist = Math.sqrt(ex * ex + ez * ez);
    if (dist >= a.blend) continue;
    const w = 1 - smoothstep(0, a.blend, dist);
    h = lerp(h, a.elevation, w);
    if (w > out.wPad) out.wPad = w;
  }

  out.h = h;
  return out;
}

/** Exact procedural terrain height (may be below sea level). */
export function heightAt(x: number, z: number): number {
  return sampleTerrain(x, z, scratch).h;
}

/* ----------------------------------------------- mesh-consistent queries */

let physicsCell = CHUNK_SIZE / 96;

/** Physics samples the same triangles the nearest-LOD terrain mesh renders. */
export function setPhysicsCellSize(cell: number): void {
  physicsCell = cell;
}

export interface GroundPlane {
  /** Ground height at the query point. */
  h: number;
  /** Unit normal. */
  nx: number;
  ny: number;
  nz: number;
}

const planeOut: GroundPlane = { h: 0, nx: 0, ny: 1, nz: 0 };

/**
 * Height and normal of the rendered terrain triangle under (x, z).
 * Matches the triangle split used by the terrain mesh builder.
 */
export function groundPlaneAt(x: number, z: number, out: GroundPlane = planeOut): GroundPlane {
  const c = physicsCell;
  const ix = Math.floor(x / c);
  const iz = Math.floor(z / c);
  const fx = x / c - ix;
  const fz = z / c - iz;
  const x0 = ix * c;
  const z0 = iz * c;
  const hb = heightAt(x0 + c, z0);
  const hc = heightAt(x0, z0 + c);
  let h: number;
  let sx: number; // dh/dx
  let sz: number; // dh/dz
  if (fx + fz <= 1) {
    const ha = heightAt(x0, z0);
    sx = (hb - ha) / c;
    sz = (hc - ha) / c;
    h = ha + (hb - ha) * fx + (hc - ha) * fz;
  } else {
    const hd = heightAt(x0 + c, z0 + c);
    sx = (hd - hc) / c;
    sz = (hd - hb) / c;
    h = hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }
  const inv = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
  out.h = h;
  out.nx = -sx * inv;
  out.ny = inv;
  out.nz = -sz * inv;
  return out;
}

/** Height of whatever is under the aircraft: terrain or the sea surface. */
export function surfaceHeightAt(x: number, z: number): number {
  const h = groundPlaneAt(x, z).h;
  return h > SEA_LEVEL ? h : SEA_LEVEL;
}

/* ----------------------------------------------------------- vegetation */

/** Forest density 0..1 at a sampled point. */
export function forestDensity(x: number, z: number, s: TerrainSample, slopeY: number): number {
  if (s.h < 2.2 || s.wPad > 0.02 || s.wCity > 0.25 || slopeY < 0.82) return 0;
  const n = simplex2(x / 1500 + 11, z / 1500 - 7) * 0.5 + 0.5;
  const fine = simplex2(x / 330, z / 330) * 0.5 + 0.5;
  let dens = 0;
  // Highland conifers below the tree line
  dens += s.wHigh * smoothstep(1500, 1050, s.h) * smoothstep(0.3, 0.55, n * 0.7 + fine * 0.3 + 0.18);
  // Greenbelt woods between the fields
  dens += s.wGreen * (1 - s.wHigh) * smoothstep(0.62, 0.74, n * 0.8 + fine * 0.2);
  // Tropical islands
  dens += s.wIsle * smoothstep(3, 9, s.h) * smoothstep(0.25, 0.5, fine * 0.6 + n * 0.4 + 0.15);
  // Sparse plains woodland
  dens += (1 - s.wGreen) * (1 - s.wHigh) * (1 - s.wBad) * (1 - s.wIsle) * smoothstep(0.7, 0.82, n) * 0.7;
  // Badlands: almost nothing
  dens *= 1 - s.wBad * 0.97;
  return clamp(dens, 0, 1);
}

/* --------------------------------------------------------------- colour */

const FIELD_COLORS: [number, number, number][] = [
  [0.74, 0.65, 0.33],
  [0.36, 0.55, 0.2],
  [0.22, 0.42, 0.16],
  [0.47, 0.35, 0.22],
  [0.52, 0.66, 0.3],
  [0.66, 0.7, 0.34],
  [0.3, 0.5, 0.24],
];
const STRATA: [number, number, number][] = [
  [0.74, 0.45, 0.27],
  [0.84, 0.59, 0.37],
  [0.64, 0.35, 0.21],
  [0.88, 0.7, 0.48],
  [0.7, 0.4, 0.26],
];

/**
 * Vertex colour for a terrain sample. `ny` is the vertical component of the
 * surface normal (1 = flat). Writes linear-ish RGB into out[o..o+2].
 */
export function terrainColor(x: number, z: number, s: TerrainSample, ny: number, out: Float32Array, o: number): void {
  const h = s.h;
  const n1 = simplex2(x / 420, z / 420);
  const n2 = simplex2(x / 95, z / 95);
  let r: number;
  let g: number;
  let b: number;

  if (h < 0.4) {
    // seabed (seen through the water): pale sand shelving into deep blue
    const t = smoothstep(0.4, -26, h);
    r = lerp(0.8, 0.05, t);
    g = lerp(0.76, 0.2, t);
    b = lerp(0.56, 0.28, t);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    return;
  }

  // base grassland
  r = 0.27 + 0.05 * n1 + 0.03 * n2;
  g = 0.44 + 0.06 * n1 + 0.03 * n2;
  b = 0.17 + 0.03 * n1;

  // Greenbelt farmland patchwork
  if (s.wGreen > 0.05) {
    const ca = 0.92;
    const sa = 0.39;
    const u = (x * ca - z * sa) / 310;
    const v = (x * sa + z * ca) / 190;
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    const fc = FIELD_COLORS[Math.floor(hash2(iu, iv) * FIELD_COLORS.length)];
    const fu = u - iu;
    const fv = v - iv;
    const border = smoothstep(0, 0.05, fu) * smoothstep(1, 0.95, fu) * smoothstep(0, 0.07, fv) * smoothstep(1, 0.93, fv);
    const w = s.wGreen * 0.9 * smoothstep(0.86, 0.97, ny);
    const k = 0.72 + 0.28 * border;
    r = lerp(r, fc[0] * k + 0.03 * n2, w);
    g = lerp(g, fc[1] * k + 0.03 * n2, w);
    b = lerp(b, fc[2] * k, w);
  }

  // forests darken the ground beneath the trees
  const forest = forestDensity(x, z, s, ny);
  if (forest > 0) {
    r = lerp(r, 0.12, forest * 0.8);
    g = lerp(g, 0.27, forest * 0.8);
    b = lerp(b, 0.11, forest * 0.8);
  }

  // tropical islands are lusher
  if (s.wIsle > 0) {
    r = lerp(r, 0.2 + 0.04 * n2, s.wIsle * 0.7);
    g = lerp(g, 0.52 + 0.05 * n1, s.wIsle * 0.7);
    b = lerp(b, 0.2, s.wIsle * 0.7);
  }

  // Metropolis ground
  if (s.wCity > 0) {
    const park = smoothstep(0.55, 0.7, simplex2(x / 700 + 3, z / 700) * 0.5 + 0.5);
    const w = s.wCity * (1 - park * 0.8);
    r = lerp(r, 0.34 + 0.02 * n2, w);
    g = lerp(g, 0.35 + 0.02 * n2, w);
    b = lerp(b, 0.35, w);
  }

  // Highlands: meadow → rock → snow
  if (s.wHigh > 0.02) {
    const rockLine = smoothstep(820, 1250, h + 120 * n1);
    const steep = smoothstep(0.84, 0.62, ny);
    const rock = Math.max(rockLine, steep) * s.wHigh;
    const rk = 0.4 + 0.05 * n2;
    r = lerp(r, rk + 0.02, rock);
    g = lerp(g, rk, rock);
    b = lerp(b, rk - 0.02, rock);
    const snow = smoothstep(1650, 1900, h + 110 * n1) * smoothstep(0.6, 0.8, ny) * s.wHigh;
    r = lerp(r, 0.93, snow);
    g = lerp(g, 0.95, snow);
    b = lerp(b, 0.98, snow);
  }

  // Badlands strata
  if (s.wBad > 0.02) {
    const band = (h + 6 * n2) / 23;
    const ib = Math.floor(band);
    const c0 = STRATA[((ib % STRATA.length) + STRATA.length) % STRATA.length];
    const dust = 0.05 * n1;
    const flat = smoothstep(0.8, 0.97, ny);
    let sr = c0[0] + dust;
    let sg = c0[1] + dust;
    let sb = c0[2] + dust * 0.5;
    // flat tops are bleached sand
    sr = lerp(sr, 0.86 + dust, flat * 0.55);
    sg = lerp(sg, 0.71 + dust, flat * 0.55);
    sb = lerp(sb, 0.5, flat * 0.55);
    r = lerp(r, sr, s.wBad);
    g = lerp(g, sg, s.wBad);
    b = lerp(b, sb, s.wBad);
  }

  // generic steep rock outside the special regions
  if (ny < 0.8 && s.wBad < 0.5 && s.wHigh < 0.5) {
    const w = smoothstep(0.8, 0.6, ny) * 0.8;
    r = lerp(r, 0.42, w);
    g = lerp(g, 0.4, w);
    b = lerp(b, 0.37, w);
  }

  // beaches
  const beachTop = 2.6 + 1.2 * n1 + (s.wIsle > 0 ? 1.6 : 0);
  if (h < beachTop + 1.5 && s.wPad < 0.6) {
    const w = smoothstep(beachTop + 1.5, beachTop, h) * (1 - s.wPad);
    r = lerp(r, 0.86 + 0.03 * n2, w);
    g = lerp(g, 0.8 + 0.03 * n2, w);
    b = lerp(b, 0.6, w);
  }

  // airport grounds: mown grass / packed dirt
  if (s.wPad > 0.3) {
    const w = smoothstep(0.3, 0.9, s.wPad) * 0.85;
    if (s.wBad > 0.4) {
      r = lerp(r, 0.74, w);
      g = lerp(g, 0.6, w);
      b = lerp(b, 0.42, w);
    } else if (s.wHigh > 0.4 && h > 900) {
      r = lerp(r, 0.4, w);
      g = lerp(g, 0.43, w);
      b = lerp(b, 0.34, w);
    } else {
      r = lerp(r, 0.31 + 0.02 * n2, w);
      g = lerp(g, 0.47 + 0.02 * n2, w);
      b = lerp(b, 0.2, w);
    }
  }

  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}

const regionScratch = makeSample();

/** Which named region a point belongs to (for the HUD and the map). */
export function regionAt(x: number, z: number): RegionId {
  const s = sampleTerrain(x, z, regionScratch);
  if (s.wCity > 0.3) return 'metropolis';
  if (s.inland > -300) {
    if (s.wHigh > 0.35) return 'highlands';
    if (s.wBad > 0.4) return 'badlands';
    if (s.wGreen > 0.45) return 'greenbelt';
    return 'metropolis';
  }
  if (x > 3000 && z > 6500 && x < 26000 && z < 26000) return 'archipelago';
  return 'opensky';
}
