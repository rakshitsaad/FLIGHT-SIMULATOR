/**
 * Four flight cameras with smooth blends between them, plus the orbit
 * camera used behind the menus. Switching never touches the simulation.
 */
import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { CameraMode } from '../../types';
import type { AircraftSpec } from '../aircraft/specs';
import type { SimView } from '../engine/Simulation';
import { surfaceHeightAt } from '../terrain/heightfield';

export type RigMode = CameraMode | 'orbit' | 'wreck';

const UP = new Vector3(0, 1, 0);

export class CameraRig {
  mode: RigMode = 'orbit';
  /** Extra shake 0..1 (stall buffet, turbulence, touchdown). */
  shake = 0;
  orbitAngle = 0.6;
  orbitDistance = 1;

  private pos = new Vector3();
  private quat = new Quaternion();
  private fov = 60;
  private fromPos = new Vector3();
  private fromQuat = new Quaternion();
  private fromFov = 60;
  private blend = 1;
  private lastMode: RigMode = 'orbit';
  private chasePos = new Vector3();
  private chaseInit = false;
  private cinePos = new Vector3();
  private cineTimer = 0;
  private look = new Vector3();
  private fwd = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private q = new Quaternion();
  private dummy = new PerspectiveCamera();
  private t = 0;

  /** Jump straight to the target next frame (after a respawn / teleport). */
  snap(): void {
    this.chaseInit = false;
    this.cineTimer = 0;
    this.blend = 1;
  }

  update(dt: number, camera: PerspectiveCamera, view: SimView, spec: AircraftSpec, far: number): void {
    this.t += dt;
    if (this.mode !== this.lastMode) {
      this.fromPos.copy(camera.position);
      this.fromQuat.copy(camera.quaternion);
      this.fromFov = camera.fov;
      this.blend = 0;
      if (this.mode === 'cinematic') this.cineTimer = 0;
      this.lastMode = this.mode;
    }
    const p = view.position;
    const q = view.quaternion;
    const fwd = this.fwd.set(0, 0, -1).applyQuaternion(q);
    let near = 1.2;

    switch (this.mode) {
      case 'cockpit': {
        this.pos.set(spec.eye.x, spec.eye.y, spec.eye.z).applyQuaternion(q).add(p);
        this.quat.copy(q);
        this.q.setFromAxisAngle(this.tmp.set(1, 0, 0), -0.05);
        this.quat.multiply(this.q);
        this.fov = 68;
        near = 0.08;
        break;
      }
      case 'instruments': {
        this.pos.set(spec.eye.x, spec.eye.y - 0.06, spec.eye.z + 0.12).applyQuaternion(q).add(p);
        this.quat.copy(q);
        this.q.setFromAxisAngle(this.tmp.set(1, 0, 0), -0.36);
        this.quat.multiply(this.q);
        this.fov = 46;
        near = 0.08;
        break;
      }
      case 'chase': {
        // follow the heading and a little of the pitch; keep the horizon level so bank is readable
        const flat = this.tmp.set(fwd.x, 0, fwd.z);
        if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
        flat.normalize();
        const d = spec.chase.distance;
        const want = this.tmp2.copy(p).addScaledVector(flat, -d).addScaledVector(UP, spec.chase.height - fwd.y * d * 0.55);
        if (!this.chaseInit) {
          this.chasePos.copy(want);
          this.chaseInit = true;
        }
        this.chasePos.lerp(want, 1 - Math.exp(-dt * 7));
        // never let the camera sink into the ground
        const floor = surfaceHeightAt(this.chasePos.x, this.chasePos.z) + 1.2;
        if (this.chasePos.y < floor) this.chasePos.y = floor;
        this.pos.copy(this.chasePos);
        this.look.copy(p).addScaledVector(fwd, d * 0.5).addScaledVector(UP, 0.8);
        this.lookAt(this.pos, this.look);
        this.fov = 58 + Math.min(14, view.speed * 0.045);
        break;
      }
      case 'cinematic': {
        this.cineTimer -= dt;
        const dist = this.cinePos.distanceTo(p);
        if (this.cineTimer <= 0 || dist > 900) {
          // park a camera ahead of the flight path and let the aircraft fly past it
          const speed = Math.max(view.speed, 12);
          const lead = this.tmp.copy(view.velocity);
          if (lead.lengthSq() < 4) lead.copy(fwd);
          lead.normalize();
          const side = this.tmp2.set(-lead.z, 0, lead.x).normalize();
          const sign = Math.sin(this.t * 1.7) > 0 ? 1 : -1;
          this.cinePos.copy(p).addScaledVector(lead, speed * 3.2).addScaledVector(side, sign * (22 + speed * 0.5));
          this.cinePos.y += view.onGround ? 3 : -6 + sign * 10;
          const floor = surfaceHeightAt(this.cinePos.x, this.cinePos.z) + 2.5;
          if (this.cinePos.y < floor) this.cinePos.y = floor;
          this.cineTimer = 7;
        }
        this.pos.copy(this.cinePos);
        this.look.copy(p);
        this.lookAt(this.pos, this.look);
        this.fov = MathUtils.clamp(2400 / Math.max(dist, 30), 9, 48);
        break;
      }
      case 'wreck': {
        this.orbitAngle += dt * 0.12;
        this.pos.set(p.x + Math.cos(this.orbitAngle) * 46, 0, p.z + Math.sin(this.orbitAngle) * 46);
        this.pos.y = Math.max(p.y, surfaceHeightAt(this.pos.x, this.pos.z)) + 16;
        this.look.copy(p);
        this.lookAt(this.pos, this.look);
        this.fov = 52;
        break;
      }
      default: {
        // orbit (menus, hangar)
        this.orbitAngle += dt * 0.07;
        const r = spec.chase.distance * 1.35 * this.orbitDistance;
        this.pos.set(p.x + Math.cos(this.orbitAngle) * r, p.y + spec.chase.height * 0.42 * this.orbitDistance, p.z + Math.sin(this.orbitAngle) * r);
        const floor = surfaceHeightAt(this.pos.x, this.pos.z) + 0.8;
        if (this.pos.y < floor) this.pos.y = floor;
        this.look.copy(p).addScaledVector(UP, 0.3);
        this.lookAt(this.pos, this.look);
        this.fov = 42;
        break;
      }
    }

    if (this.blend < 1) {
      // blends are quicker between the two in-cockpit views
      this.blend = Math.min(1, this.blend + dt / 0.85);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      camera.position.lerpVectors(this.fromPos, this.pos, k);
      camera.quaternion.slerpQuaternions(this.fromQuat, this.quat, k);
      camera.fov = this.fromFov + (this.fov - this.fromFov) * k;
      // the source pose is stale while the aircraft moves: drag it along
      this.fromPos.addScaledVector(view.velocity, dt);
    } else {
      camera.position.copy(this.pos);
      camera.quaternion.copy(this.quat);
      camera.fov += (this.fov - camera.fov) * Math.min(1, dt * 6);
    }

    if (this.shake > 0.001) {
      const s = this.shake * (this.mode === 'cockpit' || this.mode === 'instruments' ? 0.012 : 0.05);
      camera.position.x += Math.sin(this.t * 61) * s;
      camera.position.y += Math.sin(this.t * 73 + 1.3) * s;
      camera.rotateZ(Math.sin(this.t * 47) * s * 0.25);
    }
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }

  private lookAt(from: Vector3, to: Vector3): void {
    this.dummy.position.copy(from);
    this.dummy.up.copy(UP);
    this.dummy.lookAt(to);
    this.quat.copy(this.dummy.quaternion);
  }
}
