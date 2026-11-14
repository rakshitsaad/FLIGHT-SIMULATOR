/**
 * Terrain chunk streaming with level of detail.
 *
 *  - the world is an endless grid of 2048 m chunks; only chunks within the
 *    view radius exist, at a resolution chosen by distance (4 LOD levels);
 *  - chunk meshes are generated in Web Workers, so flying never hitches;
 *  - when a chunk changes LOD the old mesh stays until the new one arrives,
 *    and every chunk carries a skirt — no holes, no cracks;
 *  - chunks that fall outside the radius are disposed.
 */
import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, MeshStandardMaterial, Sphere, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GraphicsConfig } from '../../stores/settingsStore';
import { buildChunkIndices, type ChunkData, type ChunkRequest } from './chunkBuilder';
import { CHUNK_SIZE, setPhysicsCellSize } from './heightfield';

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  lod: number;
  mesh: Mesh | null;
  trees: InstancedMesh[];
  /** LOD currently being generated, or -1. */
  pendingLod: number;
  requestId: number;
}

const LOD_RANGES = [1.55, 3.1, 5.6];

function lodFor(dist: number, current: number): number {
  let lod = 3;
  for (let i = 0; i < 3; i++) {
    if (dist < LOD_RANGES[i]) {
      lod = i;
      break;
    }
  }
  // hysteresis: stay at the current level near a boundary
  if (current >= 0 && current !== lod && Math.abs(current - lod) === 1) {
    const edge = LOD_RANGES[Math.min(current, lod)];
    if (Math.abs(dist - edge) < 0.22) return current;
  }
  return lod;
}

function treeGeometries(): BufferGeometry[] {
  const paint = (g: BufferGeometry, r: number, gr: number, b: number) => {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = r;
      c[i * 3 + 1] = gr;
      c[i * 3 + 2] = b;
    }
    g.setAttribute('color', new BufferAttribute(c, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const trunk = (h: number, r: number) => paint(new CylinderGeometry(r * 0.7, r, h, 5).translate(0, h / 2, 0), 0.32, 0.23, 0.15);
  const conifer = mergeGeometries([trunk(3, 0.35), paint(new ConeGeometry(2.6, 7, 6).translate(0, 6, 0), 0.1, 0.27, 0.13), paint(new ConeGeometry(1.9, 5.5, 6).translate(0, 9.6, 0), 0.12, 0.31, 0.15)])!;
  const broadleaf = mergeGeometries([trunk(3.6, 0.4), paint(new IcosahedronGeometry(3.6, 0).scale(1, 0.85, 1).translate(0, 6.2, 0), 0.2, 0.42, 0.14)])!;
  const palm = mergeGeometries([trunk(8, 0.28), paint(new ConeGeometry(3.6, 1.6, 7).translate(0, 8.6, 0), 0.16, 0.45, 0.16), paint(new ConeGeometry(2.4, 1.4, 7).rotateX(Math.PI).translate(0, 8.2, 0), 0.13, 0.38, 0.13)])!;
  return [conifer, broadleaf, palm];
}

export class TerrainStreamer {
  readonly group = new Group();
  /** Chunks in the innermost ring that are ready (used for the loading screen). */
  ready = false;
  loadedChunks = 0;
  pendingChunks = 0;

  private cfg: GraphicsConfig;
  private chunks = new Map<string, Chunk>();
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: ChunkRequest[] = [];
  private inFlight = new Map<number, Chunk>();
  private nextId = 1;
  private indices = new Map<number, BufferAttribute>();
  private material: MeshStandardMaterial;
  private treeMat: MeshLambertMaterial;
  private treeGeo: BufferGeometry[];
  private timer = 0;
  private lastCx = Infinity;
  private lastCz = Infinity;
  private m4 = new Matrix4();
  private v3 = new Vector3();
  private tint = new Color();
  private disposed = false;

  constructor(cfg: GraphicsConfig) {
    this.cfg = cfg;
    setPhysicsCellSize(CHUNK_SIZE / cfg.lodSegments[0]);
    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    this.treeMat = new MeshLambertMaterial({ vertexColors: true });
    this.treeGeo = treeGeometries();
    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev: MessageEvent<ChunkData>) => {
        this.idle.push(w);
        this.receive(ev.data);
        this.pump();
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  private getIndex(segs: number): BufferAttribute {
    let a = this.indices.get(segs);
    if (!a) {
      a = new BufferAttribute(buildChunkIndices(segs), 1);
      this.indices.set(segs, a);
    }
    return a;
  }

  /** Call every frame with the camera position. */
  update(dt: number, x: number, z: number): void {
    this.timer -= dt;
    const ccx = Math.floor(x / CHUNK_SIZE);
    const ccz = Math.floor(z / CHUNK_SIZE);
    if (this.timer > 0 && ccx === this.lastCx && ccz === this.lastCz) return;
    this.timer = 0.25;
    this.lastCx = ccx;
    this.lastCz = ccz;
    const R = this.cfg.viewChunks;
    const fx = x / CHUNK_SIZE;
    const fz = z / CHUNK_SIZE;
    const wanted: { c: Chunk; lod: number; dist: number }[] = [];
    const seen = new Set<string>();
    let nearReady = true;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const dist = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz);
        if (dist > R) continue;
        const key = `${cx},${cz}`;
        seen.add(key);
        let c = this.chunks.get(key);
        if (!c) {
          c = { key, cx, cz, lod: -1, mesh: null, trees: [], pendingLod: -1, requestId: 0 };
          this.chunks.set(key, c);
        }
        const lod = lodFor(dist, c.lod);
        if (dist < 2.2 && c.lod < 0) nearReady = false;
        if (lod !== c.lod && lod !== c.pendingLod) wanted.push({ c, lod, dist });
      }
    }
    // unload
    for (const [key, c] of this.chunks) {
      if (seen.has(key)) continue;
      const dist = Math.hypot(c.cx + 0.5 - fx, c.cz + 0.5 - fz);
      if (dist > R + 1.5) {
        this.disposeChunk(c);
        this.chunks.delete(key);
      }
    }
    // queue the new requests, then keep the whole queue ordered nearest-first
    for (const wnt of wanted) {
      const id = this.nextId++;
      wnt.c.pendingLod = wnt.lod;
      wnt.c.requestId = id;
      this.queue.push({ id, cx: wnt.c.cx, cz: wnt.c.cz, lod: wnt.lod, segs: this.cfg.lodSegments[wnt.lod], treeSpacing: wnt.lod < this.cfg.treeLods ? this.cfg.treeSpacing : wnt.lod === this.cfg.treeLods ? this.cfg.treeSpacing * 2 : 0 });
    }
    // drop requests that were superseded or whose chunk has been unloaded
    this.queue = this.queue.filter((q) => this.chunks.get(`${q.cx},${q.cz}`)?.requestId === q.id);
    this.queue.sort((a, b) => Math.hypot(a.cx + 0.5 - fx, a.cz + 0.5 - fz) - Math.hypot(b.cx + 0.5 - fx, b.cz + 0.5 - fz));
    this.ready = nearReady;
    this.pendingChunks = this.queue.length + this.inFlight.size;
    this.pump();
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const req = this.queue.shift()!;
      const c = this.chunks.get(`${req.cx},${req.cz}`);
      if (!c || c.requestId !== req.id) continue; // superseded
      this.inFlight.set(req.id, c);
      this.idle.pop()!.postMessage(req);
    }
  }

  private receive(d: ChunkData): void {
    const c = this.inFlight.get(d.id);
    this.inFlight.delete(d.id);
    this.pendingChunks = this.queue.length + this.inFlight.size;
    if (this.disposed || !c || c.requestId !== d.id || !this.chunks.has(c.key)) return;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(d.positions, 3));
    geo.setAttribute('normal', new BufferAttribute(d.normals, 3));
    geo.setAttribute('color', new BufferAttribute(d.colors, 3));
    geo.setIndex(this.getIndex(d.segs));
    const half = CHUNK_SIZE / 2;
    const cy = (d.minY + d.maxY) / 2;
    geo.boundingSphere = new Sphere(new Vector3(half, cy, half), Math.hypot(half * Math.SQRT2, (d.maxY - d.minY) / 2));
    const mesh = new Mesh(geo, this.material);
    mesh.position.set(d.cx * CHUNK_SIZE, 0, d.cz * CHUNK_SIZE);
    mesh.receiveShadow = d.lod <= 1 && this.cfg.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // swap atomically: the old LOD is only removed once the new one is in the scene
    this.group.add(mesh);
    this.removeMeshes(c);
    c.mesh = mesh;
    c.lod = d.lod;
    c.pendingLod = -1;
    this.loadedChunks = this.chunks.size;

    if (d.trees.length) {
      const per: number[][] = [[], [], []];
      for (let i = 0; i < d.trees.length; i += 5) per[d.trees[i + 4]].push(i);
      for (let t = 0; t < 3; t++) {
        const list = per[t];
        if (!list.length) continue;
        const im = new InstancedMesh(this.treeGeo[t], this.treeMat, list.length);
        for (let k = 0; k < list.length; k++) {
          const o = list[k];
          const s = d.trees[o + 3] * (t === 2 ? 1 : 1.25);
          this.m4.makeScale(s, s * (0.85 + ((o * 7) % 10) * 0.04), s);
          this.m4.setPosition(this.v3.set(d.trees[o], d.trees[o + 1], d.trees[o + 2]));
          im.setMatrixAt(k, this.m4);
          const v = 0.82 + ((o * 13) % 17) / 17 * 0.36;
          im.setColorAt(k, this.tint.setRGB(v, v, v));
        }
        im.position.copy(mesh.position);
        im.matrixAutoUpdate = false;
        im.updateMatrix();
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.boundingSphere = geo.boundingSphere.clone();
        im.boundingSphere.radius += 20;
        im.castShadow = false;
        this.group.add(im);
        c.trees.push(im);
      }
    }
  }

  private removeMeshes(c: Chunk): void {
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    for (const t of c.trees) {
      this.group.remove(t);
      t.dispose();
    }
    c.trees = [];
  }

  private disposeChunk(c: Chunk): void {
    this.removeMeshes(c);
    c.requestId = -1;
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.material.dispose();
    this.treeMat.dispose();
    this.treeGeo.forEach((g) => g.dispose());
  }
}
