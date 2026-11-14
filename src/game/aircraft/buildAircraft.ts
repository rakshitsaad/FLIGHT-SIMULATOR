/**
 * Procedural aircraft models. Each of the four aircraft is assembled from
 * lofted fuselage sections, tapered wings, moving control surfaces,
 * retractable gear and spinning propellers / glowing nozzles — no external
 * model files, and no placeholder boxes.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type Material,
} from 'three';
import type { AircraftId } from '../../types';
import { AIRCRAFT } from './specs';

export interface AircraftPose {
  gear: number;
  flaps: number;
  elevator: number;
  aileron: number;
  rudder: number;
  /** 0..1 of maximum RPM. */
  rpm: number;
  power: number;
}

export interface AircraftVisual {
  id: AircraftId;
  group: Group;
  update(pose: AircraftPose, dt: number): void;
  dispose(): void;
}

interface Station {
  z: number;
  w: number;
  h: number;
  y?: number;
}

/** Elliptical-section body lofted through stations along the z axis. */
function loft(st: Station[], seg = 14, flatBottom = 0): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      let y = Math.sin(a) * s.h * 0.5;
      if (flatBottom > 0 && y < 0) y *= 1 - flatBottom * 0.5;
      pos.push(Math.cos(a) * s.w * 0.5, y + (s.y ?? 0), s.z);
    }
  }
  for (let i = 0; i < st.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  // caps
  const capA = pos.length / 3;
  pos.push(0, st[0].y ?? 0, st[0].z);
  const capB = capA + 1;
  const last = st[st.length - 1];
  pos.push(0, last.y ?? 0, last.z);
  for (let k = 0; k < seg; k++) {
    idx.push(capA, (k + 1) % seg, k);
    const o = (st.length - 1) * seg;
    idx.push(capB, o + k, o + ((k + 1) % seg));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface WingDef {
  /** Root leading edge. */
  x: number;
  y: number;
  z: number;
  span: number; // semi-span of this panel
  rootChord: number;
  tipChord: number;
  sweep?: number; // tip leading edge offset aft (m)
  dihedral?: number; // rad
  thickness?: number; // fraction of chord
  /** -1 mirrors the panel to the left side. */
  side: 1 | -1;
  /** Vertical surface (fin): span runs along +y instead of ±x. */
  vertical?: boolean;
  cant?: number;
}

const AIRFOIL: [number, number][] = [
  [0, 0],
  [0.08, 0.42],
  [0.3, 0.5],
  [0.7, 0.3],
  [1, 0.02],
  [0.7, -0.22],
  [0.3, -0.4],
  [0.08, -0.34],
];

function wingGeometry(d: WingDef): BufferGeometry {
  const t = d.thickness ?? 0.13;
  const n = AIRFOIL.length;
  const pos: number[] = [];
  const sections = 3;
  for (let s = 0; s <= sections; s++) {
    const f = s / sections;
    const chord = d.rootChord + (d.tipChord - d.rootChord) * f;
    const span = d.span * f;
    const le = (d.sweep ?? 0) * f;
    const rise = Math.tan(d.dihedral ?? 0) * span;
    for (const [cx, cy] of AIRFOIL) {
      const lx = span;
      const ly = cy * t * chord;
      const lz = le + cx * chord;
      if (d.vertical) {
        const cant = d.cant ?? 0;
        pos.push(d.x + (ly + Math.sin(cant) * lx) * d.side, d.y + Math.cos(cant) * lx, d.z + lz);
      } else {
        pos.push(d.x * d.side + lx * d.side, d.y + rise + ly, d.z + lz);
      }
    }
  }
  const idx: number[] = [];
  const flip = d.side === -1;
  const tri = (a: number, b: number, c: number) => (flip !== !!d.vertical ? idx.push(a, c, b) : idx.push(a, b, c));
  for (let s = 0; s < sections; s++) {
    for (let k = 0; k < n; k++) {
      const a = s * n + k;
      const b = s * n + ((k + 1) % n);
      const c = a + n;
      const e = b + n;
      tri(a, c, b);
      tri(b, c, e);
    }
  }
  // tip cap
  const o = sections * n;
  for (let k = 1; k < n - 1; k++) tri(o, o + k + 1, o + k);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

interface Kit {
  group: Group;
  mats: Record<'primary' | 'secondary' | 'accent' | 'dark' | 'metal' | 'glass' | 'tyre', MeshStandardMaterial>;
  extra: Material[];
  geos: BufferGeometry[];
  props: { hub: Object3D; disc: Mesh; blades: Object3D }[];
  ailerons: { pivot: Object3D; side: number }[];
  elevators: Object3D[];
  rudders: Object3D[];
  flaps: Object3D[];
  gear: { pivot: Object3D; axis: 'x' | 'z'; angle: number }[];
  glows: Mesh[];
}

function makeKit(primary: string, secondary: string, accent: string): Kit {
  const std = (color: string, roughness: number, metalness: number) => new MeshStandardMaterial({ color, roughness, metalness });
  return {
    group: new Group(),
    mats: {
      primary: std(primary, 0.42, 0.25),
      secondary: std(secondary, 0.45, 0.25),
      accent: std(accent, 0.5, 0.2),
      dark: std('#1c2228', 0.6, 0.3),
      metal: std('#b9c0c7', 0.3, 0.8),
      tyre: std('#141414', 0.9, 0),
      glass: new MeshStandardMaterial({ color: '#9fd0ff', roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.42 }),
    },
    extra: [],
    geos: [],
    props: [],
    ailerons: [],
    elevators: [],
    rudders: [],
    flaps: [],
    gear: [],
    glows: [],
  };
}

const doubles = new WeakMap<Material, Material>();
/** Thin surfaces (wings, fins, control surfaces) are rendered double-sided. */
function dbl(k: Kit, mat: Material): Material {
  let d = doubles.get(mat);
  if (!d) {
    d = mat.clone();
    d.side = DoubleSide;
    doubles.set(mat, d);
    k.extra.push(d);
  }
  return d;
}

function add(k: Kit, geo: BufferGeometry, mat: Material, parent: Object3D = k.group, shadow = true): Mesh {
  k.geos.push(geo);
  const m = new Mesh(geo, mat);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

function wingPair(k: Kit, d: Omit<WingDef, 'side'>, mat: Material): void {
  add(k, wingGeometry({ ...d, side: 1 }), dbl(k, mat));
  add(k, wingGeometry({ ...d, side: -1 }), dbl(k, mat));
}

/** Hinged surface: a slab whose leading edge sits on the pivot. */
function surface(k: Kit, x: number, y: number, z: number, length: number, chord: number, mat: Material, opts: { rotY?: number; rotZ?: number; vertical?: boolean } = {}): Object3D {
  const pivot = new Object3D();
  pivot.position.set(x, y, z);
  const frame = new Object3D();
  frame.rotation.set(0, opts.rotY ?? 0, opts.rotZ ?? 0);
  const hinge = new Object3D();
  const geo = opts.vertical ? new BoxGeometry(0.05, length, chord) : new BoxGeometry(length, 0.05, chord);
  geo.translate(0, 0, chord / 2);
  add(k, geo, mat, hinge);
  frame.add(hinge);
  pivot.add(frame);
  k.group.add(pivot);
  return hinge;
}

function propeller(k: Kit, x: number, y: number, z: number, radius: number, blades: number, dir: 1 | -1 = 1): void {
  const hub = new Object3D();
  hub.position.set(x, y, z);
  const bl = new Object3D();
  for (let i = 0; i < blades; i++) {
    const g = new BoxGeometry(0.16, radius, 0.035);
    g.translate(0, radius / 2, 0);
    g.rotateY(0.35);
    const m = add(k, g, k.mats.dark, bl, false);
    m.rotation.z = (i / blades) * Math.PI * 2;
  }
  const spinner = new SphereGeometry(0.19, 10, 8);
  spinner.scale(1, 1, 1.9);
  spinner.translate(0, 0, -0.1 * dir);
  add(k, spinner, k.mats.metal, hub);
  const discMat = new MeshBasicMaterial({ color: '#cfd6dc', transparent: true, opacity: 0.0, side: DoubleSide, depthWrite: false });
  k.extra.push(discMat);
  const disc = add(k, new CircleGeometry(radius, 28), discMat, hub, false);
  hub.add(bl);
  k.group.add(hub);
  k.props.push({ hub, disc, blades: bl });
}

function gearLeg(k: Kit, x: number, bottomY: number, z: number, topY: number, wheelR: number, axis: 'x' | 'z', angle: number, twin = false): void {
  const pivot = new Object3D();
  pivot.position.set(x, topY, z);
  const len = topY - bottomY - wheelR;
  const strut = new CylinderGeometry(0.045, 0.055, len, 8);
  strut.translate(0, -len / 2, 0);
  add(k, strut, k.mats.metal, pivot);
  const offsets = twin ? [-0.16, 0.16] : [0];
  for (const o of offsets) {
    const wheel = new CylinderGeometry(wheelR, wheelR, 0.14, 14);
    wheel.rotateZ(Math.PI / 2);
    wheel.translate(o, -len, 0);
    add(k, wheel, k.mats.tyre, pivot);
  }
  k.group.add(pivot);
  k.gear.push({ pivot, axis, angle });
}

function canopy(k: Kit, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  const g = new SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  add(k, g, k.mats.glass, k.group, false);
}

/* ------------------------------------------------------------- aircraft */

function trainer(k: Kit): void {
  const m = k.mats;
  add(
    k,
    loft([
      { z: -2.62, w: 0.25, h: 0.25, y: -0.05 },
      { z: -2.3, w: 0.92, h: 0.86, y: -0.05 },
      { z: -1.4, w: 1.12, h: 1.04, y: -0.02 },
      { z: -0.2, w: 1.18, h: 1.14, y: 0.02 },
      { z: 1.0, w: 1.02, h: 1.0, y: 0.04 },
      { z: 3.0, w: 0.44, h: 0.56, y: 0.14 },
      { z: 4.4, w: 0.07, h: 0.2, y: 0.22 },
    ]),
    m.primary,
  );
  // cheat line
  add(k, loft([{ z: -2.2, w: 0.96, h: 0.14, y: -0.1 }, { z: -0.2, w: 1.22, h: 0.16, y: -0.06 }, { z: 2.9, w: 0.5, h: 0.12, y: 0.1 }, { z: 4.2, w: 0.1, h: 0.08, y: 0.2 }], 10), m.secondary, k.group, false);
  canopy(k, 0, 0.42, -0.25, 0.5, 0.52, 1.15);
  wingPair(k, { x: 0.35, y: -0.38, z: -0.75, span: 5.1, rootChord: 1.78, tipChord: 1.2, sweep: 0.22, dihedral: 0.09 }, m.primary);
  wingPair(k, { x: 5.38, y: 0.08, z: -0.5, span: 0.1, rootChord: 1.18, tipChord: 0.9, sweep: 0.12, dihedral: 0.5 }, m.secondary);
  wingPair(k, { x: 0.1, y: 0.2, z: 3.45, span: 1.75, rootChord: 0.95, tipChord: 0.62, sweep: 0.2 }, m.primary);
  add(k, wingGeometry({ x: 0, y: 0.3, z: 3.0, span: 1.5, rootChord: 1.4, tipChord: 0.65, sweep: 0.75, side: 1, vertical: true }), dbl(k, m.secondary));
  for (const s of [1, -1]) {
    k.ailerons.push({ pivot: surface(k, s * 4.1, 0.0, 0.72, 1.9, 0.34, m.accent, { rotZ: s * 0.09, rotY: -s * 0.06 }), side: s });
    k.flaps.push(surface(k, s * 1.9, -0.2, 0.86, 2.2, 0.42, m.primary, { rotZ: s * 0.09, rotY: -s * 0.04 }));
    k.elevators.push(surface(k, s * 1.0, 0.2, 4.12, 1.6, 0.3, m.accent, { rotY: -s * 0.1 }));
  }
  k.rudders.push(surface(k, 0, 1.0, 4.05, 1.35, 0.42, m.accent, { vertical: true }));
  propeller(k, 0, -0.05, -2.72, 0.95, 2);
  gearLeg(k, 0, -1.3, -1.6, -0.4, 0.19, 'x', -1.5);
  gearLeg(k, -1.3, -1.3, 0.38, -0.42, 0.21, 'z', -1.45);
  gearLeg(k, 1.3, -1.3, 0.38, -0.42, 0.21, 'z', 1.45);
}

function sport(k: Kit): void {
  const m = k.mats;
  add(
    k,
    loft(
      [
        { z: -2.5, w: 0.1, h: 0.25, y: -0.05 },
        { z: -1.9, w: 0.86, h: 0.8, y: -0.12 },
        { z: -0.6, w: 1.22, h: 1.18, y: -0.02 },
        { z: 0.6, w: 1.12, h: 1.1, y: 0.02 },
        { z: 1.6, w: 0.5, h: 0.6, y: 0.22 },
        { z: 3.0, w: 0.22, h: 0.3, y: 0.46 },
        { z: 4.1, w: 0.1, h: 0.18, y: 0.56 },
      ],
      14,
      0.55,
    ),
    m.primary,
  );
  // boat hull chine + sponsons
  add(k, loft([{ z: -2.2, w: 0.5, h: 0.2, y: -0.52 }, { z: -0.8, w: 1.1, h: 0.3, y: -0.6 }, { z: 0.2, w: 1.0, h: 0.3, y: -0.62 }, { z: 1.5, w: 0.3, h: 0.16, y: -0.3 }], 8), m.secondary, k.group, false);
  for (const s of [1, -1]) {
    const g = new BoxGeometry(1.0, 0.16, 0.9);
    g.translate(s * 1.05, -0.56, 0.1);
    add(k, g, m.secondary);
  }
  canopy(k, 0, 0.3, -0.85, 0.52, 0.56, 1.15);
  wingPair(k, { x: 0.25, y: 0.72, z: -0.4, span: 4.95, rootChord: 1.4, tipChord: 1.0, sweep: 0.15, dihedral: 0.035 }, m.primary);
  wingPair(k, { x: 5.2, y: 0.9, z: -0.25, span: 0.1, rootChord: 0.98, tipChord: 0.7, dihedral: 0.9 }, m.secondary);
  // engine pod on a pylon above the wing
  add(k, loft([{ z: -0.3, w: 0.2, h: 0.2, y: 1.18 }, { z: 0.1, w: 0.52, h: 0.5, y: 1.18 }, { z: 1.0, w: 0.5, h: 0.48, y: 1.18 }, { z: 1.3, w: 0.2, h: 0.2, y: 1.18 }], 10), m.secondary);
  const pylon = new BoxGeometry(0.12, 0.42, 0.7);
  pylon.translate(0, 0.9, 0.5);
  add(k, pylon, m.secondary);
  propeller(k, 0, 1.18, 1.42, 0.78, 3, -1);
  // T-tail
  add(k, wingGeometry({ x: 0, y: 0.55, z: 3.05, span: 1.35, rootChord: 1.15, tipChord: 0.7, sweep: 0.5, side: 1, vertical: true }), dbl(k, m.primary));
  wingPair(k, { x: 0.0, y: 1.9, z: 3.5, span: 1.45, rootChord: 0.8, tipChord: 0.55, sweep: 0.15 }, m.secondary);
  for (const s of [1, -1]) {
    k.ailerons.push({ pivot: surface(k, s * 3.9, 0.86, 0.78, 1.9, 0.3, m.accent, { rotZ: s * 0.035, rotY: -s * 0.04 }), side: s });
    k.flaps.push(surface(k, s * 1.75, 0.78, 0.9, 2.0, 0.36, m.primary, { rotZ: s * 0.035 }));
    k.elevators.push(surface(k, s * 0.75, 1.9, 4.05, 1.4, 0.26, m.accent));
  }
  k.rudders.push(surface(k, 0, 1.2, 3.98, 1.2, 0.36, m.accent, { vertical: true }));
  gearLeg(k, 0, -1.08, -1.45, -0.45, 0.16, 'x', -1.5);
  gearLeg(k, -0.95, -1.08, 0.3, -0.5, 0.18, 'z', -1.5);
  gearLeg(k, 0.95, -1.08, 0.3, -0.5, 0.18, 'z', 1.5);
}

function turboprop(k: Kit): void {
  const m = k.mats;
  add(
    k,
    loft([
      { z: -6.0, w: 0.12, h: 0.14, y: -0.1 },
      { z: -5.2, w: 0.95, h: 0.92, y: -0.08 },
      { z: -3.7, w: 1.55, h: 1.6, y: 0.05 },
      { z: -1.0, w: 1.62, h: 1.68, y: 0.08 },
      { z: 2.6, w: 1.56, h: 1.6, y: 0.08 },
      { z: 5.5, w: 0.82, h: 0.96, y: 0.36 },
      { z: 7.4, w: 0.14, h: 0.3, y: 0.58 },
    ]),
    m.primary,
  );
  add(k, loft([{ z: -5.0, w: 1.0, h: 0.16, y: -0.2 }, { z: -3.6, w: 1.6, h: 0.2, y: -0.12 }, { z: 2.6, w: 1.62, h: 0.2, y: -0.1 }, { z: 5.6, w: 0.84, h: 0.14, y: 0.26 }, { z: 7.3, w: 0.16, h: 0.08, y: 0.55 }], 12), m.secondary, k.group, false);
  // flight deck glazing + cabin windows
  const wind = loft([{ z: -4.75, w: 1.05, h: 0.2, y: 0.42 }, { z: -4.2, w: 1.38, h: 0.5, y: 0.52 }, { z: -3.55, w: 1.5, h: 0.5, y: 0.62 }, { z: -3.3, w: 1.4, h: 0.2, y: 0.7 }], 10);
  add(k, wind, m.glass, k.group, false);
  for (const s of [1, -1]) {
    for (let i = 0; i < 6; i++) {
      const w = new BoxGeometry(0.04, 0.3, 0.42);
      w.translate(s * 0.815, 0.36, -2.4 + i * 0.86);
      add(k, w, m.dark, k.group, false);
    }
  }
  wingPair(k, { x: 0.5, y: -0.45, z: -1.3, span: 7.8, rootChord: 2.35, tipChord: 1.1, sweep: 0.55, dihedral: 0.1 }, m.primary);
  // nacelles
  for (const s of [1, -1]) {
    add(k, loft([{ z: -3.05, w: 0.3, h: 0.3, y: -0.24 }, { z: -2.7, w: 0.76, h: 0.8, y: -0.24 }, { z: -1.0, w: 0.82, h: 0.86, y: -0.22 }, { z: 0.6, w: 0.7, h: 0.6, y: -0.2 }, { z: 1.5, w: 0.2, h: 0.2, y: -0.12 }], 12).translate(s * 2.6, 0, 0), m.primary);
    add(k, loft([{ z: -2.72, w: 0.8, h: 0.84, y: -0.24 }, { z: -2.4, w: 0.83, h: 0.87, y: -0.24 }], 12).translate(s * 2.6, 0, 0), m.secondary, k.group, false);
    propeller(k, s * 2.6, -0.24, -3.12, 1.18, 4);
  }
  // T-tail
  add(k, wingGeometry({ x: 0, y: 0.75, z: 4.9, span: 2.75, rootChord: 2.4, tipChord: 1.3, sweep: 1.3, side: 1, vertical: true, thickness: 0.1 }), dbl(k, m.secondary));
  wingPair(k, { x: 0, y: 3.5, z: 6.05, span: 2.8, rootChord: 1.3, tipChord: 0.75, sweep: 0.45 }, m.primary);
  for (const s of [1, -1]) {
    k.ailerons.push({ pivot: surface(k, s * 6.5, 0.2, 0.58, 2.9, 0.36, m.accent, { rotZ: s * 0.1, rotY: -s * 0.1 }), side: s });
    k.flaps.push(surface(k, s * 3.9, -0.07, 0.78, 2.1, 0.5, m.primary, { rotZ: s * 0.1, rotY: -s * 0.08 }));
    k.elevators.push(surface(k, s * 1.4, 3.5, 7.0, 2.6, 0.4, m.accent, { rotY: -s * 0.1 }));
  }
  k.rudders.push(surface(k, 0, 2.2, 7.0, 2.3, 0.6, m.accent, { vertical: true }));
  gearLeg(k, 0, -1.91, -4.1, -0.5, 0.24, 'x', -1.5, true);
  gearLeg(k, -2.6, -1.91, 0.55, -0.4, 0.3, 'x', -1.5, true);
  gearLeg(k, 2.6, -1.91, 0.55, -0.4, 0.3, 'x', -1.5, true);
}

function jet(k: Kit): void {
  const m = k.mats;
  add(
    k,
    loft([
      { z: -8.2, w: 0.06, h: 0.06, y: -0.05 },
      { z: -6.6, w: 0.72, h: 0.7, y: -0.02 },
      { z: -4.3, w: 1.2, h: 1.16, y: 0.04 },
      { z: -2.2, w: 1.5, h: 1.3, y: 0.06 },
      { z: 2.0, w: 1.9, h: 1.2, y: 0.02 },
      { z: 5.4, w: 1.8, h: 1.0, y: 0.02 },
      { z: 6.5, w: 1.5, h: 0.8, y: 0.04 },
    ]),
    m.primary,
  );
  canopy(k, 0, 0.52, -3.45, 0.42, 0.62, 1.65);
  // intakes + leading-edge extensions
  for (const s of [1, -1]) {
    const intake = new BoxGeometry(0.62, 0.74, 2.6);
    intake.translate(s * 0.95, -0.08, -1.6);
    add(k, intake, m.secondary);
    const lip = new BoxGeometry(0.5, 0.6, 0.06);
    lip.translate(s * 0.95, -0.08, -2.92);
    add(k, lip, m.dark, k.group, false);
    add(k, wingGeometry({ x: 0.7, y: 0.12, z: -4.4, span: 0.75, rootChord: 3.4, tipChord: 0.3, sweep: 3.1, side: s as 1 | -1, thickness: 0.03 }), dbl(k, m.primary));
  }
  wingPair(k, { x: 1.0, y: 0.06, z: -1.4, span: 3.8, rootChord: 4.3, tipChord: 1.25, sweep: 2.75, thickness: 0.05 }, m.primary);
  wingPair(k, { x: 0.95, y: -0.02, z: 4.3, span: 1.9, rootChord: 2.1, tipChord: 0.85, sweep: 1.25, thickness: 0.05 }, m.secondary);
  for (const s of [1, -1]) {
    add(k, wingGeometry({ x: s * 1.0, y: 0.45, z: 3.2, span: 2.35, rootChord: 2.4, tipChord: 0.9, sweep: 1.5, side: s as 1 | -1, vertical: true, cant: 0.3, thickness: 0.05 }), dbl(k, m.secondary));
    // nozzle
    const noz = new CylinderGeometry(0.42, 0.5, 0.9, 16, 1, true);
    noz.rotateX(Math.PI / 2);
    noz.translate(s * 0.55, 0.02, 6.75);
    add(k, noz, m.dark);
    const glowMat = new MeshBasicMaterial({ color: new Color('#ff8a3c'), transparent: true, opacity: 0, depthWrite: false });
    k.extra.push(glowMat);
    const glow = new CylinderGeometry(0.36, 0.05, 2.6, 14, 1, true);
    glow.rotateX(Math.PI / 2);
    glow.translate(0, 0, 1.3);
    const gm = add(k, glow, glowMat, k.group, false);
    gm.position.set(s * 0.55, 0.02, 6.9);
    k.glows.push(gm);
    k.ailerons.push({ pivot: surface(k, s * 3.5, 0.06, 2.72, 1.9, 0.5, m.accent, { rotY: -s * 0.36 }), side: s });
    k.flaps.push(surface(k, s * 1.9, 0.06, 2.85, 1.3, 0.55, m.primary, { rotY: -s * 0.1 }));
    k.elevators.push(surface(k, s * 1.9, -0.02, 5.95, 1.7, 0.4, m.accent, { rotY: -s * 0.3 }));
    k.rudders.push(surface(k, s * 1.5, 1.6, 5.35, 1.7, 0.5, m.accent, { vertical: true, rotZ: -s * 0.3 }));
  }
  gearLeg(k, 0, -1.69, -4.3, -0.4, 0.22, 'x', -1.5);
  gearLeg(k, -1.45, -1.69, 0.75, -0.3, 0.28, 'z', -1.5);
  gearLeg(k, 1.45, -1.69, 0.75, -0.3, 0.28, 'z', 1.5);
}

const BUILDERS: Record<AircraftId, (k: Kit) => void> = { trainer, sport, turboprop, jet };

/**
 * @param paint optional primary colour override (used for AI traffic liveries)
 */
export function buildAircraft(id: AircraftId, paint?: number): AircraftVisual {
  const spec = AIRCRAFT[id];
  const k = makeKit(spec.color.primary, spec.color.secondary, spec.color.accent);
  if (paint !== undefined) k.mats.secondary.color.setHex(paint);
  BUILDERS[id](k);
  let spin = 0;
  const jetEngine = spec.engineType === 'jet';

  return {
    id,
    group: k.group,
    update(p, dt) {
      const el = -p.elevator * 0.42;
      for (const e of k.elevators) e.rotation.x = el;
      for (const a of k.ailerons) a.pivot.rotation.x = p.aileron * 0.36 * a.side;
      for (const r of k.rudders) r.rotation.y = -p.rudder * 0.45;
      for (const f of k.flaps) f.rotation.x = p.flaps * 0.62;
      for (const g of k.gear) {
        const t = 1 - p.gear;
        if (g.axis === 'x') g.pivot.rotation.x = g.angle * t;
        else g.pivot.rotation.z = g.angle * t;
        g.pivot.visible = p.gear > 0.03;
      }
      if (k.props.length) {
        spin += dt * (4 + p.rpm * 60);
        const blur = Math.min(1, Math.max(0, (p.rpm - 0.22) / 0.3));
        for (const pr of k.props) {
          pr.blades.rotation.z = spin;
          pr.blades.visible = blur < 0.98;
          (pr.disc.material as MeshBasicMaterial).opacity = blur * 0.16;
        }
      }
      if (jetEngine) {
        for (const g of k.glows) {
          (g.material as MeshBasicMaterial).opacity = Math.max(0, p.power - 0.55) * 1.6;
          g.scale.z = 0.5 + p.power * 0.7;
        }
      }
    },
    dispose() {
      k.geos.forEach((g) => g.dispose());
      Object.values(k.mats).forEach((m) => m.dispose());
      k.extra.forEach((m) => m.dispose());
    },
  };
}
