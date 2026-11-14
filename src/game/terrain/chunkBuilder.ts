/**
 * Builds the render data for one terrain chunk. Pure (no three.js / DOM) so
 * it runs inside the terrain Web Worker.
 */
import { CHUNK_SIZE, forestDensity, makeSample, sampleTerrain, terrainColor } from './heightfield';
import { hash2 } from './noise';

export interface ChunkRequest {
  id: number;
  cx: number;
  cz: number;
  lod: number;
  segs: number;
  /** Spacing of candidate trees in metres, 0 = no trees. */
  treeSpacing: number;
}

export interface ChunkData {
  id: number;
  cx: number;
  cz: number;
  lod: number;
  segs: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** x, y, z, scale, type (0 conifer, 1 broadleaf, 2 palm) per tree, chunk-local x/z. */
  trees: Float32Array;
  minY: number;
  maxY: number;
}

const sample = makeSample();

export function buildChunk(req: ChunkRequest): ChunkData {
  const n = req.segs;
  const cell = CHUNK_SIZE / n;
  const ox = req.cx * CHUNK_SIZE;
  const oz = req.cz * CHUNK_SIZE;
  const w = n + 1;
  const pw = n + 3; // padded grid for normals
  const heights = new Float32Array(pw * pw);
  const fields = new Float32Array(w * w * 8);

  for (let j = -1; j <= n + 1; j++) {
    for (let i = -1; i <= n + 1; i++) {
      const x = ox + i * cell;
      const z = oz + j * cell;
      const s = sampleTerrain(x, z, sample);
      heights[(j + 1) * pw + (i + 1)] = s.h;
      if (i >= 0 && j >= 0 && i <= n && j <= n) {
        const o = (j * w + i) * 8;
        fields[o] = s.wHigh;
        fields[o + 1] = s.wBad;
        fields[o + 2] = s.wGreen;
        fields[o + 3] = s.wCity;
        fields[o + 4] = s.wIsle;
        fields[o + 5] = s.wPad;
        fields[o + 6] = s.inland;
        fields[o + 7] = s.canyon;
      }
    }
  }

  const skirt = 4 * w;
  const count = w * w + skirt;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let minY = Infinity;
  let maxY = -Infinity;

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = j * w + i;
      const p = (j + 1) * pw + (i + 1);
      const h = heights[p];
      const sx = (heights[p + 1] - heights[p - 1]) / (2 * cell);
      const sz = (heights[p + pw] - heights[p - pw]) / (2 * cell);
      const inv = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
      positions[v * 3] = i * cell;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = j * cell;
      normals[v * 3] = -sx * inv;
      normals[v * 3 + 1] = inv;
      normals[v * 3 + 2] = -sz * inv;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      const o = v * 8;
      sample.h = h;
      sample.wHigh = fields[o];
      sample.wBad = fields[o + 1];
      sample.wGreen = fields[o + 2];
      sample.wCity = fields[o + 3];
      sample.wIsle = fields[o + 4];
      sample.wPad = fields[o + 5];
      sample.inland = fields[o + 6];
      sample.canyon = fields[o + 7];
      terrainColor(ox + i * cell, oz + j * cell, sample, inv, colors, v * 3);
    }
  }

  // skirts: a curtain around the chunk hides cracks between LOD levels
  const drop = 30 + cell * 1.2;
  let sv = w * w;
  const copy = (src: number) => {
    positions[sv * 3] = positions[src * 3];
    positions[sv * 3 + 1] = positions[src * 3 + 1] - drop;
    positions[sv * 3 + 2] = positions[src * 3 + 2];
    normals[sv * 3] = normals[src * 3];
    normals[sv * 3 + 1] = normals[src * 3 + 1];
    normals[sv * 3 + 2] = normals[src * 3 + 2];
    colors[sv * 3] = colors[src * 3];
    colors[sv * 3 + 1] = colors[src * 3 + 1];
    colors[sv * 3 + 2] = colors[src * 3 + 2];
    sv++;
  };
  for (let i = 0; i <= n; i++) copy(i); // north
  for (let i = 0; i <= n; i++) copy(n * w + i); // south
  for (let j = 0; j <= n; j++) copy(j * w); // west
  for (let j = 0; j <= n; j++) copy(j * w + n); // east
  minY -= drop;

  // trees
  let trees = new Float32Array(0);
  if (req.treeSpacing > 0) {
    const sp = req.treeSpacing;
    const m = Math.floor(CHUNK_SIZE / sp);
    const buf: number[] = [];
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const gx = req.cx * m + i;
        const gz = req.cz * m + j;
        const r1 = hash2(gx, gz);
        const r2 = hash2(gx + 7919, gz - 104729);
        const lx = (i + 0.15 + r1 * 0.7) * sp;
        const lz = (j + 0.15 + r2 * 0.7) * sp;
        const x = ox + lx;
        const z = oz + lz;
        const s = sampleTerrain(x, z, sample);
        if (s.h < 2.2) continue;
        const hx = sampleTerrain(x + 6, z, sample).h;
        const hz = sampleTerrain(x, z + 6, sample).h;
        const s2 = sampleTerrain(x, z, sample);
        const gxs = (hx - s2.h) / 6;
        const gzs = (hz - s2.h) / 6;
        const ny = 1 / Math.sqrt(gxs * gxs + 1 + gzs * gzs);
        const dens = forestDensity(x, z, s2, ny);
        const r3 = hash2(gx - 31337, gz + 271);
        if (r3 >= dens) continue;
        const type = s2.wIsle > 0.3 ? 2 : s2.wHigh > 0.35 ? 0 : r1 > 0.72 ? 0 : 1;
        buf.push(lx, s2.h - 0.4, lz, 0.75 + r2 * 0.7, type);
      }
    }
    trees = new Float32Array(buf);
  }

  return { id: req.id, cx: req.cx, cz: req.cz, lod: req.lod, segs: n, positions, normals, colors, trees, minY, maxY };
}

/** Triangle indices for a chunk grid with skirts (shared by all chunks of the same resolution). */
export function buildChunkIndices(n: number): Uint16Array | Uint32Array {
  const w = n + 1;
  const tris = n * n * 2 + n * 2 * 4;
  const total = w * w + 4 * w;
  const idx = total > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const base = w * w;
  const strip = (edge: (i: number) => number, s0: number, flip: boolean) => {
    for (let i = 0; i < n; i++) {
      const e0 = edge(i);
      const e1 = edge(i + 1);
      const k0 = s0 + i;
      const k1 = s0 + i + 1;
      if (!flip) {
        idx[k++] = e0;
        idx[k++] = e1;
        idx[k++] = k0;
        idx[k++] = e1;
        idx[k++] = k1;
        idx[k++] = k0;
      } else {
        idx[k++] = e0;
        idx[k++] = k0;
        idx[k++] = e1;
        idx[k++] = e1;
        idx[k++] = k0;
        idx[k++] = k1;
      }
    }
  };
  strip((i) => i, base, false); // north, faces -z
  strip((i) => n * w + i, base + w, true); // south, faces +z
  strip((j) => j * w, base + 2 * w, true); // west, faces -x
  strip((j) => j * w + n, base + 3 * w, false); // east, faces +x
  return idx;
}
