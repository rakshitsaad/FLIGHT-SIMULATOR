/**
 * Airports: runways with painted markings, taxiways, aprons, edge / approach
 * lighting, PAPI glide-path lights, windsocks and moving ground vehicles.
 * The ground beneath is already flattened by the terrain function, so these
 * are thin decals laid exactly on it.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import type { FrameContext, Subsystem } from '../engine/frame';
import { AIRPORTS, apronRect, fromRunwayCoords, runwayFrame, runwayNumber, type AirportDef } from '../world/aerona';

const DEG = Math.PI / 180;

function runwayTexture(a: AirportDef): Texture {
  const pxPerM = a.length > 2000 ? 1.6 : 3;
  const W = Math.max(64, Math.round(a.width * pxPerM));
  const H = Math.min(4096, Math.round(a.length * pxPerM));
  const k = H / a.length;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const base = a.surface === 'asphalt' ? '#2e3136' : a.surface === 'grass' ? '#4f7a3a' : '#a8875c';
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // surface wear
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    g.fillStyle = a.surface === 'asphalt' ? `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},0.035)` : `rgba(${v > 0.5 ? 40 : 200},${v > 0.5 ? 60 : 190},${v > 0.5 ? 20 : 150},0.05)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 4 + Math.random() * 26);
  }
  const m = (metres: number) => metres * k;
  const cx = W / 2;
  if (a.surface === 'asphalt') {
    // rubber deposits in the touchdown zones
    for (const y0 of [m(140), H - m(520)]) {
      const grad = g.createLinearGradient(0, y0, 0, y0 + m(380));
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(cx - m(a.width * 0.2), y0, m(a.width * 0.4), m(380));
    }
    g.fillStyle = '#e9e9e4';
    // edge lines
    const sx = W / a.width;
    g.fillRect(1.2 * sx, 0, 0.9 * sx, H);
    g.fillRect(W - 2.1 * sx, 0, 0.9 * sx, H);
    // centreline dashes: 30 m on, 20 m off
    for (let y = m(110); y < H - m(110); y += m(50)) g.fillRect(cx - 0.45 * sx, y, 0.9 * sx, m(30));
    // threshold bars + numbers + aiming points at both ends
    const bars = a.width >= 45 ? 12 : a.width >= 30 ? 8 : 6;
    const end = (flip: boolean) => {
      g.save();
      if (flip) {
        g.translate(W, H);
        g.rotate(Math.PI);
      }
      const bw = (a.width * 0.72) / (bars * 1.6);
      for (let i = 0; i < bars; i++) {
        const off = (i - (bars - 1) / 2) * bw * 1.6 + (i >= bars / 2 ? bw * 0.6 : -bw * 0.6);
        g.fillRect(cx + off * sx - (bw * sx) / 2, m(8), bw * sx, m(30));
      }
      // number (this end is used when approaching from the far side)
      const num = runwayNumber(flip ? a.heading : a.heading + 180);
      g.save();
      g.translate(cx, m(62));
      g.rotate(Math.PI);
      g.font = `bold ${Math.round(m(18))}px Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(num, 0, 0);
      g.restore();
      // aiming point
      if (a.length > 1200) {
        g.fillRect(cx - a.width * 0.3 * sx, m(300), a.width * 0.12 * sx, m(45));
        g.fillRect(cx + a.width * 0.18 * sx, m(300), a.width * 0.12 * sx, m(45));
        for (const y of [m(150), m(450)]) {
          for (const s of [-1, 1]) {
            for (let j = 0; j < 3; j++) g.fillRect(cx + s * (a.width * 0.14 + j * 1.9) * sx - 0.6 * sx, y, 1.2 * sx, m(22));
          }
        }
      }
      g.restore();
    };
    end(false);
    end(true);
  } else {
    // grass / dirt strips: white corner and edge markers only
    g.fillStyle = 'rgba(245,245,240,0.9)';
    const sx = W / a.width;
    for (let y = m(5); y < H; y += m(60)) {
      g.fillRect(0.6 * sx, y, 1.6 * sx, m(6));
      g.fillRect(W - 2.2 * sx, y, 1.6 * sx, m(6));
    }
    g.fillRect(0, m(2), W, m(2.5));
    g.fillRect(0, H - m(4.5), W, m(2.5));
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

interface Papi {
  mats: MeshBasicMaterial[];
  pos: Vector3;
  airport: AirportDef;
  dir: 1 | -1;
}

interface Vehicle {
  airport: AirportDef;
  /** Loop in runway coordinates. */
  path: [number, number][];
  length: number;
  speed: number;
  s: number;
}

export class Airports implements Subsystem {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];
  private lights: InstancedMesh;
  private lightMat: MeshBasicMaterial;
  private strobe: InstancedMesh;
  private strobeMat: MeshBasicMaterial;
  private papis: Papi[] = [];
  private socks: { pivot: Object3D; cone: Object3D }[] = [];
  private vehicles: Vehicle[] = [];
  private vehicleMesh: InstancedMesh;
  private m4 = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private sc = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private white = new Color(1, 0.97, 0.9);
  private red = new Color(1, 0.08, 0.05);

  constructor() {
    const lightPos: { x: number; y: number; z: number; c: number; s: number }[] = [];
    const strobePos: Vector3[] = [];

    for (const a of AIRPORTS) {
      const f = runwayFrame(a);
      const rotY = -a.heading * DEG;
      const flat = (w: number, l: number, along: number, across: number, mat: Material, lift: number, order: number) => {
        const geo = new PlaneGeometry(w, l);
        geo.rotateX(-Math.PI / 2);
        const mesh = new Mesh(geo, mat);
        const c = fromRunwayCoords(a, along, across);
        mesh.position.set(c.x, a.elevation + lift, c.z);
        mesh.rotation.y = rotY;
        mesh.renderOrder = order;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.disposables.push(geo);
        return mesh;
      };
      const decal = (color: string, order: number, map?: Texture) => {
        const mat = new MeshStandardMaterial({ color, map, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 - order, polygonOffsetUnits: -6 - order * 6 });
        this.disposables.push(mat);
        return mat;
      };

      // runway
      const tex = runwayTexture(a);
      this.disposables.push(tex);
      flat(a.width, a.length, 0, 0, decal('#ffffff', 2, tex), 0.06, 3);

      // apron + taxiways for paved fields
      const ap = apronRect(a);
      if (a.surface === 'asphalt') {
        const apron = decal('#3a3d42', 1);
        flat(ap.across1 - ap.across0, ap.along1 - ap.along0, (ap.along0 + ap.along1) / 2, (ap.across0 + ap.across1) / 2, apron, 0.04, 2);
        const taxi = decal('#34373c', 1);
        const tw = a.kind === 'international' ? 26 : 14;
        const tOff = a.width / 2 + (a.kind === 'international' ? 95 : 30);
        if (a.kind === 'international' || a.kind === 'regional') flat(tw, a.length, 0, tOff, taxi, 0.04, 2);
        const links = a.kind === 'international' ? [-0.48, -0.25, 0, 0.25, 0.48] : a.kind === 'regional' ? [-0.47, 0, 0.47] : [0];
        for (const l of links) {
          flat(ap.across0 + 10 - a.width / 2, tw, l * a.length, (a.width / 2 + ap.across0 + 10) / 2, taxi, 0.045, 2);
        }
      }

      // lighting
      const y = a.elevation + 0.5;
      if (a.lights) {
        const gap = a.length > 2000 ? 60 : 50;
        for (let d = -a.length / 2; d <= a.length / 2 + 1; d += gap) {
          for (const s of [-1, 1]) {
            const p = fromRunwayCoords(a, d, s * (a.width / 2 + 2));
            lightPos.push({ x: p.x, y, z: p.z, c: 0, s: 1 });
          }
        }
        for (const end of [-1, 1]) {
          const n = Math.max(6, Math.round(a.width / 4));
          for (let i = 0; i < n; i++) {
            const p = fromRunwayCoords(a, end * (a.length / 2 + 3), (i / (n - 1) - 0.5) * a.width);
            lightPos.push({ x: p.x, y, z: p.z, c: end === -1 ? 2 : 1, s: 1.2 });
          }
          // approach lights + sequenced strobes
          const reach = a.kind === 'international' ? 720 : 300;
          for (let d = 60; d <= reach; d += 60) {
            const bar = d === 300 ? 5 : 2;
            for (let i = -bar; i <= bar; i++) {
              const p = fromRunwayCoords(a, end * (a.length / 2 + d), i * 3);
              lightPos.push({ x: p.x, y: y + 0.5, z: p.z, c: 0, s: 1.1 });
            }
            const sp = fromRunwayCoords(a, end * (a.length / 2 + d), 0);
            strobePos.push(new Vector3(sp.x, y + 1.2, sp.z));
          }
          // PAPI: four lights left of the touchdown zone
          const mats: MeshBasicMaterial[] = [];
          const dir = end === -1 ? 1 : -1;
          for (let i = 0; i < 4; i++) {
            const mat = new MeshBasicMaterial({ color: 0xffffff, fog: false });
            const geo = new SphereGeometry(0.9, 8, 6);
            const mesh = new Mesh(geo, mat);
            const p = fromRunwayCoords(a, end * (a.length / 2 - 300), -dir * (a.width / 2 + 12 + i * 8));
            mesh.position.set(p.x, y + 0.6, p.z);
            this.group.add(mesh);
            mats.push(mat);
            this.disposables.push(mat, geo);
          }
          const pp = fromRunwayCoords(a, end * (a.length / 2 - 300), 0);
          this.papis.push({ mats, pos: new Vector3(pp.x, a.elevation, pp.z), airport: a, dir: dir as 1 | -1 });
        }
        if (a.surface === 'asphalt') {
          // blue taxiway / apron edge lights
          for (let d = ap.along0; d <= ap.along1; d += 45) {
            const p = fromRunwayCoords(a, d, ap.across1);
            lightPos.push({ x: p.x, y, z: p.z, c: 3, s: 0.8 });
          }
        }
      }

      // windsock
      const wp = fromRunwayCoords(a, -a.length * 0.22, -(a.width / 2 + 30));
      const pole = new Mesh(new CylinderGeometry(0.12, 0.16, 7, 6), new MeshStandardMaterial({ color: '#d8d8d8' }));
      pole.position.set(wp.x, a.elevation + 3.5, wp.z);
      const pivot = new Object3D();
      pivot.position.set(wp.x, a.elevation + 7, wp.z);
      const coneGeo = new ConeGeometry(0.7, 4, 8, 1, true);
      coneGeo.rotateX(-Math.PI / 2);
      coneGeo.translate(0, 0, -2);
      const cone = new Mesh(coneGeo, new MeshStandardMaterial({ color: '#ff6a1a', side: 2 }));
      pivot.add(cone);
      this.group.add(pole, pivot);
      this.socks.push({ pivot, cone });
      this.disposables.push(pole.geometry, pole.material as Material, coneGeo, cone.material as Material);

      // ground vehicles circulating on the apron
      if (a.surface === 'asphalt') {
        const count = a.kind === 'international' ? 9 : a.kind === 'regional' ? 3 : 1;
        for (let i = 0; i < count; i++) {
          const inset = 8 + i * 7;
          const x0 = ap.along0 + inset;
          const x1 = ap.along1 - inset;
          const y0 = ap.across0 + 6 + (i % 3) * 6;
          const y1 = ap.across1 - 10 - (i % 4) * 9;
          const path: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
          const length = 2 * (x1 - x0) + 2 * (y1 - y0);
          this.vehicles.push({ airport: a, path, length, speed: 5 + (i % 4) * 2.2, s: (i * 137) % length });
        }
      }
      void f;
    }

    // one instanced mesh for every steady light
    this.lightMat = new MeshBasicMaterial({ color: 0xffffff, fog: false });
    const lg = new SphereGeometry(0.55, 6, 5);
    this.lights = new InstancedMesh(lg, this.lightMat, lightPos.length);
    const colors = [new Color(1, 0.93, 0.75), new Color(1, 0.1, 0.06), new Color(0.1, 1, 0.3), new Color(0.2, 0.45, 1)];
    lightPos.forEach((l, i) => {
      this.m4.makeScale(l.s, l.s, l.s).setPosition(l.x, l.y, l.z);
      this.lights.setMatrixAt(i, this.m4);
      this.lights.setColorAt(i, colors[l.c]);
    });
    this.lights.instanceMatrix.needsUpdate = true;
    this.lights.computeBoundingSphere();
    this.group.add(this.lights);

    this.strobeMat = new MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true });
    const sg = new SphereGeometry(1.3, 6, 5);
    this.strobe = new InstancedMesh(sg, this.strobeMat, strobePos.length);
    strobePos.forEach((p, i) => {
      this.m4.makeTranslation(p.x, p.y, p.z);
      this.strobe.setMatrixAt(i, this.m4);
    });
    this.strobe.computeBoundingSphere();
    this.group.add(this.strobe);

    const vg = new BoxGeometry(2.2, 1.8, 4.6);
    vg.translate(0, 0.9, 0);
    const vm = new MeshStandardMaterial({ roughness: 0.6 });
    this.vehicleMesh = new InstancedMesh(vg, vm, Math.max(1, this.vehicles.length));
    const vc = [new Color('#f2c230'), new Color('#e8e8e8'), new Color('#d9482b'), new Color('#3d7bd9')];
    this.vehicles.forEach((_, i) => this.vehicleMesh.setColorAt(i, vc[i % vc.length]));
    this.vehicleMesh.frustumCulled = false;
    this.group.add(this.vehicleMesh);
    this.disposables.push(lg, this.lightMat, sg, this.strobeMat, vg, vm);
  }

  update(ctx: FrameContext): void {
    const w = ctx.weather;
    // lights come on at dusk and in poor visibility
    const need = Math.max(ctx.night, 1 - Math.min(1, w.visibility / 9000), w.localCloud * 0.5);
    const on = need > 0.12;
    this.lights.visible = on;
    this.lightMat.color.setScalar(0.4 + need * 1.6);
    // sequenced "rabbit" strobes
    this.strobe.visible = on;
    if (on) this.strobeMat.opacity = (ctx.time * 2) % 1 < 0.12 ? 1 : 0;

    // PAPI: white above the 3° path, red below
    const pos = ctx.view.position;
    for (const p of this.papis) {
      const f = runwayFrame(p.airport);
      const dx = pos.x - p.pos.x;
      const dz = pos.z - p.pos.z;
      const back = -(dx * f.ax + dz * f.az) * p.dir; // distance before the lights along the approach
      const angle = back > 30 ? Math.atan2(pos.y - p.pos.y, back) / DEG : 9;
      const thresholds = [3.5, 3.17, 2.83, 2.5];
      for (let i = 0; i < 4; i++) p.mats[i].color.copy(angle > thresholds[i] ? this.white : this.red).multiplyScalar(0.8 + need);
    }

    // windsocks point downwind and droop in light wind
    const dir = (w.state.windDirection + 180) * DEG;
    const lift = Math.min(1, w.state.windSpeed / 9);
    for (const s of this.socks) {
      s.pivot.rotation.y = -dir + Math.sin(ctx.time * 2.3) * 0.08 * (0.3 + w.state.turbulence);
      s.cone.rotation.x = -(1 - lift) * 1.2;
    }

    // vehicles
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      v.s = (v.s + v.speed * ctx.dt) % v.length;
      let d = v.s;
      let k = 0;
      for (; k < v.path.length - 1; k++) {
        const seg = Math.hypot(v.path[k + 1][0] - v.path[k][0], v.path[k + 1][1] - v.path[k][1]);
        if (d <= seg) break;
        d -= seg;
      }
      k = Math.min(k, v.path.length - 2);
      const a0 = v.path[k];
      const a1 = v.path[k + 1];
      const seg = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
      const t = d / seg;
      const wp = fromRunwayCoords(v.airport, a0[0] + (a1[0] - a0[0]) * t, a0[1] + (a1[1] - a0[1]) * t);
      const wn = fromRunwayCoords(v.airport, a1[0], a1[1]);
      const wo = fromRunwayCoords(v.airport, a0[0], a0[1]);
      this.q.setFromAxisAngle(this.up, Math.atan2(wn.x - wo.x, wn.z - wo.z));
      this.p.set(wp.x, v.airport.elevation + 0.05, wp.z);
      this.m4.compose(this.p, this.q, this.sc);
      this.vehicleMesh.setMatrixAt(i, this.m4);
    }
    this.vehicleMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
