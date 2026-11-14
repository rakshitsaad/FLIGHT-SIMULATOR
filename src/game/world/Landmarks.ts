/**
 * Handcrafted pieces of AERONA: highways with traffic, the two bridges over
 * the Silverrun, the Aerona Spire, stadium, lighthouse, observatory, relay
 * tower, wind farm, Sunfire Arch and the Zephyr Gates ring course.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from 'three';
import type { FrameContext, Subsystem } from '../engine/frame';
import { heightAt } from '../terrain/heightfield';
import { BRIDGES, GATES, HIGHWAYS, LANDMARKS } from './aerona';
import { getStructures, turbinePositions } from './structures';

const DEG = Math.PI / 180;

interface RoadPath {
  pts: Vector3[];
  cum: number[];
  length: number;
  width: number;
}

/** Height of a road at (x, z): on the ground, or ramping up onto a bridge deck. */
function roadHeight(x: number, z: number): number {
  let h = Math.max(heightAt(x, z), 0.4) + 0.9;
  for (const b of BRIDGES) {
    const a = b.heading * DEG;
    const ax = Math.sin(a);
    const az = -Math.cos(a);
    const dx = x - b.x;
    const dz = z - b.z;
    const along = Math.abs(dx * ax + dz * az);
    const across = Math.abs(dx * az - dz * ax);
    if (across > 260) continue;
    const half = b.length / 2;
    const ramp = 420;
    if (along <= half) h = Math.max(h, b.deck + 0.4);
    else if (along < half + ramp) {
      const t = 1 - (along - half) / ramp;
      h = Math.max(h, 0.9 + (b.deck - 0.5) * t * t * (3 - 2 * t));
    }
  }
  return h;
}

function buildRoads(): { geometry: BufferGeometry; paths: RoadPath[] } {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const paths: RoadPath[] = [];
  for (const hw of HIGHWAYS) {
    const curve = new CatmullRomCurve3(hw.points.map(([x, z]) => new Vector3(x, 0, z)), hw.id === 'ring', 'catmullrom', 0.5);
    const len = curve.getLength();
    const n = Math.ceil(len / 28);
    const pts: Vector3[] = [];
    const cum: number[] = [];
    const base = pos.length / 3;
    let total = 0;
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(i / n);
      const t = curve.getTangentAt(i / n);
      p.y = roadHeight(p.x, p.z);
      if (i > 0) total += p.distanceTo(pts[i - 1]);
      pts.push(p);
      cum.push(total);
      const rx = -t.z;
      const rz = t.x;
      const hw2 = hw.width / 2;
      // edge / lane / centre / lane / edge
      for (const [o, shade] of [[-hw2, 0.2], [-0.6, 0.2], [0, 0.42], [0.6, 0.2], [hw2, 0.2]] as [number, number][]) {
        pos.push(p.x + rx * o, p.y, p.z + rz * o);
        col.push(shade, shade, shade * 1.04);
      }
      if (i < n) {
        for (let k = 0; k < 4; k++) {
          const a = base + i * 5 + k;
          idx.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
        }
      }
    }
    paths.push({ pts, cum, length: total, width: hw.width });
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, paths };
}

interface Car {
  path: RoadPath;
  s: number;
  speed: number;
  lane: number;
  seg: number;
}

export class Landmarks implements Subsystem {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];
  private cars: Car[] = [];
  private carMesh: InstancedMesh;
  private carLights: InstancedMesh;
  private carLightMat: MeshBasicMaterial;
  private rotors: { obj: Object3D; phase: number }[] = [];
  private beacons: { mat: MeshBasicMaterial; rate: number; phase: number }[] = [];
  private beam: Object3D | null = null;
  private beamMat: MeshBasicMaterial | null = null;
  private gateMat: MeshBasicMaterial;
  private m4 = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private sc = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private fwd = new Vector3();

  private mat(m: Material): Material {
    this.disposables.push(m);
    return m;
  }
  private mesh(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0, parent: Object3D = this.group): Mesh {
    this.disposables.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  constructor(carCount: number) {
    // ---- highways
    const roads = buildRoads();
    const roadMat = this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12, side: DoubleSide }));
    const roadMesh = this.mesh(roads.geometry, roadMat);
    roadMesh.renderOrder = 2;
    roadMesh.receiveShadow = true;

    // ---- traffic
    const cg = new BoxGeometry(1.9, 1.4, 4.4);
    cg.translate(0, 0.75, 0);
    const cm = this.mat(new MeshStandardMaterial({ roughness: 0.45, metalness: 0.3 }));
    this.carMesh = new InstancedMesh(cg, cm, carCount);
    const lg = new BoxGeometry(1.7, 0.3, 4.7);
    lg.translate(0, 0.7, 0);
    this.carLightMat = this.mat(new MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0, fog: false })) as MeshBasicMaterial;
    this.carLights = new InstancedMesh(lg, this.carLightMat, carCount);
    const paint = ['#d8dade', '#22262b', '#b3261e', '#2b5fb8', '#e8e3d3', '#4c5560', '#e0b030'];
    const totalLen = roads.paths.reduce((a, p) => a + p.length, 0);
    for (let i = 0; i < carCount; i++) {
      let pick = ((i * 0.6180339) % 1) * totalLen;
      let path = roads.paths[0];
      for (const p of roads.paths) {
        if (pick < p.length) {
          path = p;
          break;
        }
        pick -= p.length;
      }
      const dir = i % 2 === 0 ? 1 : -1;
      this.cars.push({ path, s: pick, speed: dir * (22 + (i % 7) * 2.5), lane: dir * (path.width * 0.22), seg: 0 });
      this.carMesh.setColorAt(i, new Color(paint[i % paint.length]));
    }
    this.carMesh.frustumCulled = false;
    this.carLights.frustumCulled = false;
    this.group.add(this.carMesh, this.carLights);
    this.disposables.push(cg, lg);

    // ---- bridges
    const steel = this.mat(new MeshStandardMaterial({ color: '#b5392c', roughness: 0.55, metalness: 0.3 }));
    const concrete = this.mat(new MeshStandardMaterial({ color: '#8d8f93', roughness: 0.9 }));
    const cableMat = this.mat(new LineBasicMaterial({ color: 0x7a2a22 }));
    for (const b of BRIDGES) {
      const a = b.heading * DEG;
      const ax = Math.sin(a);
      const az = -Math.cos(a);
      const deck = this.mesh(new BoxGeometry(b.width + 4, 3, b.length), b.kind === 'suspension' ? steel : concrete, b.x, b.deck - 1.3, b.z);
      deck.rotation.y = -a;
      if (b.kind === 'suspension') {
        const span = b.length * 0.27;
        const cablePts: number[] = [];
        for (const side of [-1, 1]) {
          const ox = Math.cos(a) * side * (b.width / 2 + 2);
          const oz = Math.sin(a) * side * (b.width / 2 + 2);
          const pts: Vector3[] = [];
          for (let i = -30; i <= 30; i++) {
            const d = (i / 30) * (b.length / 2);
            const ad = Math.abs(d);
            let y: number;
            if (ad <= span) y = b.deck + 6 + (b.tower - b.deck - 8) * Math.pow(ad / span, 2);
            else y = b.tower - 2 - (b.tower - b.deck - 2) * ((ad - span) / (b.length / 2 - span));
            const px = b.x + ax * d + ox;
            const pz = b.z + az * d + oz;
            pts.push(new Vector3(px, y, pz));
            if (i % 2 === 0) cablePts.push(px, y, pz, px, b.deck, pz);
          }
          this.mesh(new TubeGeometry(new CatmullRomCurve3(pts), 60, 0.7, 5), steel);
        }
        const hg = new BufferGeometry();
        hg.setAttribute('position', new BufferAttribute(new Float32Array(cablePts), 3));
        this.disposables.push(hg);
        this.group.add(new LineSegments(hg, cableMat));
        // tower cross beams
        for (const s of [-1, 1]) {
          for (const h of [b.deck + 30, b.tower - 6]) {
            const beam = this.mesh(new BoxGeometry(b.width + 8, 5, 6), steel, b.x + ax * s * span, h, b.z + az * s * span);
            beam.rotation.y = -a;
          }
        }
      }
    }
    // towers / pylons / handcrafted solids come from the shared structure list
    for (const s of getStructures()) {
      if (!s.custom || s.style === 'deck') continue;
      if (s.style === 'pylon') {
        const m = this.mesh(new BoxGeometry(s.w, s.h, s.d), s.h > 60 ? steel : concrete, s.x, s.y + s.h / 2, s.z);
        m.rotation.y = s.rot;
      }
    }

    // ---- landmarks
    const white = this.mat(new MeshStandardMaterial({ color: '#eef0f2', roughness: 0.5 }));
    const glass = this.mat(new MeshStandardMaterial({ color: '#6d8fb0', roughness: 0.15, metalness: 0.7 }));
    const sand = this.mat(new MeshStandardMaterial({ color: '#c9793f', roughness: 0.95 }));
    const dark = this.mat(new MeshStandardMaterial({ color: '#30363d', roughness: 0.7 }));
    const beacon = (x: number, y: number, z: number, color: number, size: number, rate: number, phase = 0) => {
      const mat = this.mat(new MeshBasicMaterial({ color, fog: false })) as MeshBasicMaterial;
      this.mesh(new SphereGeometry(size, 8, 6), mat, x, y, z);
      this.beacons.push({ mat, rate, phase });
    };
    for (const l of LANDMARKS) {
      const g = Math.max(0, heightAt(l.x, l.z));
      switch (l.kind) {
        case 'spire': {
          this.mesh(new CylinderGeometry(15, 22, 150, 16), glass, l.x, g + 75, l.z);
          this.mesh(new CylinderGeometry(9, 15, 140, 16), glass, l.x, g + 220, l.z);
          this.mesh(new CylinderGeometry(20, 12, 16, 20), white, l.x, g + 298, l.z);
          this.mesh(new CylinderGeometry(20, 20, 8, 20), dark, l.x, g + 310, l.z);
          this.mesh(new CylinderGeometry(2.5, 8, 80, 10), white, l.x, g + 354, l.z);
          this.mesh(new CylinderGeometry(0.6, 1.6, 40, 6), dark, l.x, g + 414, l.z);
          beacon(l.x, g + 436, l.z, 0xff2a1a, 2.6, 0.9);
          break;
        }
        case 'stadium': {
          const ring = new CylinderGeometry(125, 105, 40, 40, 1, true);
          this.mesh(ring, this.mat(new MeshStandardMaterial({ color: '#c9ced4', roughness: 0.6, side: DoubleSide })), l.x, g + 20, l.z);
          const pitch = new RingGeometry(0, 100, 40);
          pitch.rotateX(-Math.PI / 2);
          this.mesh(pitch, this.mat(new MeshStandardMaterial({ color: '#3f8f3a', roughness: 0.9 })), l.x, g + 1.2, l.z);
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.78;
            this.mesh(new CylinderGeometry(1.2, 1.8, 62, 6), dark, l.x + Math.cos(a) * 128, g + 31, l.z + Math.sin(a) * 128);
            beacon(l.x + Math.cos(a) * 126, g + 63, l.z + Math.sin(a) * 126, 0xfff4d6, 4, 0);
          }
          break;
        }
        case 'lighthouse': {
          this.mesh(new CylinderGeometry(3, 4.6, 38, 14), white, l.x, g + 19, l.z);
          this.mesh(new CylinderGeometry(3.3, 3.6, 5, 14), this.mat(new MeshStandardMaterial({ color: '#c02a20' })), l.x, g + 15, l.z);
          this.mesh(new CylinderGeometry(3.1, 3.3, 5, 14), this.mat(new MeshStandardMaterial({ color: '#c02a20' })), l.x, g + 29, l.z);
          this.mesh(new CylinderGeometry(2.6, 2.6, 4, 12), glass, l.x, g + 40, l.z);
          this.mesh(new ConeGeometry(3.2, 3, 12), dark, l.x, g + 43.5, l.z);
          const pivot = new Object3D();
          pivot.position.set(l.x, g + 40, l.z);
          const bg = new ConeGeometry(26, 420, 12, 1, true);
          bg.rotateX(Math.PI / 2);
          bg.translate(0, 0, -210);
          this.beamMat = this.mat(new MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false })) as MeshBasicMaterial;
          this.mesh(bg, this.beamMat, 0, 0, 0, pivot);
          this.group.add(pivot);
          this.beam = pivot;
          beacon(l.x, g + 40, l.z, 0xfff2c0, 2.2, 0);
          break;
        }
        case 'observatory': {
          this.mesh(new CylinderGeometry(17, 17, 14, 20), white, l.x, g + 7, l.z);
          this.mesh(new SphereGeometry(16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(new MeshStandardMaterial({ color: '#dfe6ee', roughness: 0.25, metalness: 0.5 })), l.x, g + 14, l.z);
          this.mesh(new BoxGeometry(22, 8, 36), white, l.x + 30, g + 4, l.z + 6);
          break;
        }
        case 'radiotower': {
          for (let i = 0; i < 6; i++) {
            this.mesh(new CylinderGeometry(1.6 - i * 0.2, 1.9 - i * 0.2, 31, 4), i % 2 ? white : this.mat(new MeshStandardMaterial({ color: '#d2331f' })), l.x, g + 15.5 + i * 31, l.z);
          }
          beacon(l.x, g + 189, l.z, 0xff2a1a, 2.2, 1.1);
          beacon(l.x, g + 95, l.z, 0xff2a1a, 1.6, 1.1, 0.5);
          break;
        }
        case 'turbines': {
          const blade = new BoxGeometry(2.4, 44, 0.5);
          blade.translate(0, 23, 0);
          this.disposables.push(blade);
          for (const t of turbinePositions()) {
            this.mesh(new CylinderGeometry(1.5, 2.4, 90, 10), white, t.x, t.y + 45, t.z);
            const nac = this.mesh(new BoxGeometry(4, 4, 10), white, t.x, t.y + 91, t.z);
            const rotor = new Object3D();
            rotor.position.set(0, 0, -5.6);
            for (let i = 0; i < 3; i++) {
              const b = new Mesh(blade, white);
              b.rotation.z = (i / 3) * Math.PI * 2;
              rotor.add(b);
            }
            nac.add(rotor);
            this.rotors.push({ obj: rotor, phase: t.phase });
            this.rotors.push({ obj: nac, phase: -1 });
          }
          break;
        }
        case 'arch': {
          for (const s of [-1, 1]) this.mesh(new BoxGeometry(46, 124, 50), sand, l.x + s * 95, g + 58, l.z);
          this.mesh(new BoxGeometry(236, 30, 44), sand, l.x, g + 107, l.z);
          this.mesh(new BoxGeometry(150, 14, 38), sand, l.x - 10, g + 128, l.z);
          break;
        }
        default:
          break;
      }
    }

    // ---- Zephyr Gates
    this.gateMat = this.mat(new MeshBasicMaterial({ color: 0xff9a2e, fog: false })) as MeshBasicMaterial;
    const torus = new TorusGeometry(55, 2.4, 8, 40);
    this.disposables.push(torus);
    for (const gt of GATES) {
      const m = new Mesh(torus, this.gateMat);
      m.position.set(gt.x, gt.y, gt.z);
      m.rotation.y = -gt.heading * DEG;
      this.group.add(m);
    }
  }

  update(ctx: FrameContext): void {
    const night = ctx.night;
    const t = ctx.time;
    // cars
    this.carLightMat.opacity = Math.min(1, night * 1.4);
    this.carLights.visible = night > 0.05;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const path = c.path;
      c.s += c.speed * ctx.dt;
      if (c.s < 0) c.s += path.length;
      if (c.s >= path.length) c.s -= path.length;
      let k = c.seg;
      if (k >= path.cum.length - 1 || path.cum[k] > c.s) k = 0;
      while (k < path.cum.length - 2 && path.cum[k + 1] < c.s) k++;
      c.seg = k;
      const a = path.pts[k];
      const b = path.pts[k + 1];
      const span = path.cum[k + 1] - path.cum[k] || 1;
      const f = (c.s - path.cum[k]) / span;
      this.fwd.subVectors(b, a).normalize();
      this.p.lerpVectors(a, b, f);
      this.p.x += -this.fwd.z * c.lane;
      this.p.z += this.fwd.x * c.lane;
      this.p.y += 0.1;
      this.q.setFromAxisAngle(this.up, Math.atan2(this.fwd.x, this.fwd.z) + (c.speed < 0 ? Math.PI : 0));
      this.m4.compose(this.p, this.q, this.sc);
      this.carMesh.setMatrixAt(i, this.m4);
      this.carLights.setMatrixAt(i, this.m4);
    }
    this.carMesh.instanceMatrix.needsUpdate = true;
    this.carLights.instanceMatrix.needsUpdate = true;

    // wind turbines face the wind and spin with it
    const w = ctx.weather.state;
    const spin = t * (0.25 + w.windSpeed * 0.09);
    for (const r of this.rotors) {
      if (r.phase < 0) r.obj.rotation.y = -(w.windDirection * DEG);
      else r.obj.rotation.z = spin + r.phase;
    }
    for (const b of this.beacons) {
      const on = b.rate === 0 ? 0.35 + night * 0.9 : (t * b.rate + b.phase) % 1 < 0.45 ? 1.4 : 0.12;
      b.mat.color.setScalar(1).multiplyScalar(on);
      if (b.rate !== 0) b.mat.color.setRGB(on, on * 0.12, on * 0.08);
    }
    if (this.beam && this.beamMat) {
      this.beam.rotation.y = t * 0.8;
      this.beamMat.opacity = night * 0.16;
      this.beam.visible = night > 0.05;
    }
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    this.gateMat.color.setRGB(1 * pulse, 0.55 * pulse, 0.15);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
