/**
 * Rapier owns collisions between the aircraft and solid structures, and the
 * rigid-body dynamics of crash debris. It never moves the aircraft: the custom
 * flight model is the single owner of aerodynamic motion. Each fixed step the
 * aircraft's hull shapes are swept through the static world as queries.
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { AircraftSpec } from '../aircraft/specs';
import { getStructures, type Structure } from '../world/structures';

type Rapier = typeof RAPIER_NS;

export interface DebrisPiece {
  body: RAPIER_NS.RigidBody;
  size: [number, number, number];
  color: number;
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const Y = new Vector3(0, 1, 0);

export class CollisionWorld {
  private R: Rapier;
  private world: RAPIER_NS.World;
  private fuselage!: RAPIER_NS.Shape;
  private wing!: RAPIER_NS.Shape;
  private wingOffset = new Vector3();
  private handles = new Map<number, Structure>();
  private ground: RAPIER_NS.Collider | null = null;
  debris: DebrisPiece[] = [];
  debrisTime = 0;
  structureCount = 0;

  private constructor(R: Rapier) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
  }

  static async create(): Promise<CollisionWorld> {
    const R = (await import('@dimforge/rapier3d-compat')).default;
    await R.init();
    const cw = new CollisionWorld(R);
    cw.build();
    return cw;
  }

  private build(): void {
    const R = this.R;
    for (const s of getStructures()) {
      const desc = s.round ? R.ColliderDesc.cylinder(s.h / 2, s.w / 2) : R.ColliderDesc.cuboid(s.w / 2, s.h / 2, s.d / 2);
      tmpQ.setFromAxisAngle(Y, s.rot);
      desc.setTranslation(s.x, s.y + s.h / 2, s.z).setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
      const c = this.world.createCollider(desc);
      this.handles.set(c.handle, s);
      this.structureCount++;
    }
    this.world.step();
  }

  setAircraft(spec: AircraftSpec): void {
    const R = this.R;
    let zMin = 0;
    let zMax = 0;
    let span = spec.wingSpan / 2;
    let wingZ = 0;
    for (const c of spec.contacts) {
      if (c.kind !== 'hull') continue;
      zMin = Math.min(zMin, c.z);
      zMax = Math.max(zMax, c.z);
      if (c.label.includes('wing')) {
        span = Math.abs(c.x);
        wingZ = c.z;
      }
    }
    const len = (zMax - zMin) / 2;
    this.fuselage = new R.Cuboid(0.7, 0.8, len);
    this.wing = new R.Cuboid(span, 0.25, spec.chord / 2);
    this.wingOffset.set(0, 0, wingZ);
    this.fuselageOffset.set(0, 0.1, (zMax + zMin) / 2);
  }
  private fuselageOffset = new Vector3();

  /** Returns the structure the aircraft is intersecting, if any. */
  test(pos: Vector3, quat: Quaternion): Structure | null {
    if (!this.fuselage) return null;
    let hit: Structure | null = null;
    const rot = { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
    const cb = (c: RAPIER_NS.Collider) => {
      const s = this.handles.get(c.handle);
      if (s) {
        hit = s;
        return false;
      }
      return true;
    };
    tmpV.copy(this.fuselageOffset).applyQuaternion(quat).add(pos);
    this.world.intersectionsWithShape({ x: tmpV.x, y: tmpV.y, z: tmpV.z }, rot, this.fuselage, cb);
    if (hit) return hit;
    tmpV.copy(this.wingOffset).applyQuaternion(quat).add(pos);
    this.world.intersectionsWithShape({ x: tmpV.x, y: tmpV.y, z: tmpV.z }, rot, this.wing, cb);
    return hit;
  }

  /** Break the aircraft into rigid bodies that tumble under Rapier's control. */
  spawnDebris(spec: AircraftSpec, pos: Vector3, quat: Quaternion, vel: Vector3, groundY: number, gravity: number): void {
    this.clearDebris();
    const R = this.R;
    this.world.gravity = { x: 0, y: -gravity, z: 0 };
    this.ground = this.world.createCollider(
      R.ColliderDesc.cuboid(900, 5, 900)
        .setTranslation(pos.x, groundY - 5, pos.z)
        .setFriction(0.9)
        .setRestitution(0.15),
    );
    const span = spec.wingSpan / 2;
    const parts: { o: [number, number, number]; s: [number, number, number]; c: number }[] = [
      { o: [0, 0, -1.5], s: [0.6, 0.6, 1.6], c: 0 },
      { o: [0, 0, 1.6], s: [0.5, 0.5, 1.6], c: 0 },
      { o: [-span * 0.5, 0, 0.2], s: [span * 0.5, 0.08, spec.chord * 0.5], c: 1 },
      { o: [span * 0.5, 0, 0.2], s: [span * 0.5, 0.08, spec.chord * 0.5], c: 1 },
      { o: [0, 0.9, 3.8], s: [0.06, 0.8, 0.6], c: 1 },
      { o: [0, 0.2, 4], s: [1.6, 0.05, 0.45], c: 0 },
      { o: [0, 0, -2.6], s: [0.45, 0.45, 0.5], c: 2 },
      { o: [-1.2, -0.9, 0.3], s: [0.2, 0.3, 0.3], c: 2 },
      { o: [1.2, -0.9, 0.3], s: [0.2, 0.3, 0.3], c: 2 },
    ];
    for (let i = 0; i < 10; i++) {
      const sz = 0.12 + Math.random() * 0.28;
      parts.push({ o: [(Math.random() - 0.5) * 3, Math.random() * 0.8, (Math.random() - 0.5) * 5], s: [sz, sz * 0.4, sz * 1.4], c: i % 3 });
    }
    const speed = vel.length();
    for (const p of parts) {
      tmpV.set(p.o[0], p.o[1], p.o[2]).applyQuaternion(quat).add(pos);
      if (tmpV.y < groundY + p.s[1] + 0.2) tmpV.y = groundY + p.s[1] + 0.2;
      const scatter = 0.25 * speed + 4;
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(tmpV.x, tmpV.y, tmpV.z)
          .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
          .setLinvel(vel.x * 0.55 + (Math.random() - 0.5) * scatter, Math.abs(vel.y) * 0.25 + Math.random() * scatter * 0.6, vel.z * 0.55 + (Math.random() - 0.5) * scatter)
          .setAngvel({ x: (Math.random() - 0.5) * 9, y: (Math.random() - 0.5) * 9, z: (Math.random() - 0.5) * 9 })
          .setLinearDamping(0.25)
          .setAngularDamping(0.5),
      );
      this.world.createCollider(R.ColliderDesc.cuboid(p.s[0], p.s[1], p.s[2]).setDensity(60).setFriction(0.8).setRestitution(0.2), body);
      this.debris.push({ body, size: p.s, color: p.c });
    }
    this.debrisTime = 0;
  }

  clearDebris(): void {
    for (const d of this.debris) this.world.removeRigidBody(d.body);
    this.debris = [];
    if (this.ground) {
      this.world.removeCollider(this.ground, false);
      this.ground = null;
    }
  }

  /** Advance the rigid-body debris simulation. */
  step(dt: number): void {
    if (!this.debris.length) return;
    this.debrisTime += dt;
    if (this.debrisTime > 25) return; // everything has settled
    this.world.timestep = dt;
    this.world.step();
  }
}
