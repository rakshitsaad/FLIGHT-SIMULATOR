/**
 * Owns every three.js object in the game world and updates them each frame
 * from the simulation's read-only view. No React here: the R3F canvas hosts
 * this scene and simply calls `update()`.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry, Vector3 } from 'three';
import { Airports } from '../airports/Airports';
import { buildAircraft, type AircraftVisual } from '../aircraft/buildAircraft';
import { AIRCRAFT } from '../aircraft/specs';
import { CameraRig, type RigMode } from '../cameras/CameraRig';
import { Cockpit } from '../cockpit/Cockpit';
import type { FrameContext } from '../engine/frame';
import { sim } from '../engine/Simulation';
import { CHUNK_SIZE } from '../terrain/heightfield';
import { TerrainStreamer } from '../terrain/TerrainStreamer';
import { Atmosphere } from '../weather/Atmosphere';
import type { GraphicsConfig } from '../../stores/settingsStore';
import type { AircraftId, FlightRecord } from '../../types';
import { Buildings } from './Buildings';
import { Landmarks } from './Landmarks';

export class WorldScene {
  readonly root = new Group();
  readonly rig = new CameraRig();
  readonly terrain: TerrainStreamer;
  readonly atmosphere: Atmosphere;
  private buildings: Buildings;
  private airports: Airports;
  private landmarks: Landmarks;
  private cfg: GraphicsConfig;
  private player: AircraftVisual | null = null;
  private cockpit: Cockpit | null = null;
  private ai: { visual: AircraftVisual; strobe: Mesh }[] = [];
  private strobeMat = new MeshBasicMaterial({ color: 0xffffff, fog: false });
  private debris: Mesh[] = [];
  private debrisMats = [new MeshStandardMaterial({ color: '#d9dde2', roughness: 0.6 }), new MeshStandardMaterial({ color: '#2f6fd0', roughness: 0.6 }), new MeshStandardMaterial({ color: '#22262b', roughness: 0.8 })];
  private smoke: Mesh[] = [];
  private smokeMat = new MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.5, depthWrite: false });
  private path: Line | null = null;
  private pathRecord: FlightRecord | null = null;
  private sun = new Vector3(0, 1, 0);
  private time = 0;
  private far: number;
  private ctx: FrameContext;
  private pose = { gear: 1, flaps: 0, elevator: 0, aileron: 0, rudder: 0, rpm: 0, power: 0 };

  constructor(scene: Scene, camera: PerspectiveCamera, cfg: GraphicsConfig) {
    this.cfg = cfg;
    this.far = cfg.viewChunks * CHUNK_SIZE * 1.12;
    this.terrain = new TerrainStreamer(cfg);
    this.atmosphere = new Atmosphere(scene, cfg);
    this.buildings = new Buildings();
    this.airports = new Airports();
    this.landmarks = new Landmarks(cfg.viewChunks >= 10 ? 110 : 60);
    this.root.add(this.terrain.group, this.atmosphere.group, this.buildings.group, this.airports.group, this.landmarks.group);
    scene.add(this.root);

    for (const a of sim.traffic.aircraft) {
      const visual = buildAircraft(a.model, a.color);
      const strobe = new Mesh(new SphereGeometry(0.9, 6, 5), this.strobeMat);
      strobe.position.set(0, 1.5, 0);
      visual.group.add(strobe);
      this.root.add(visual.group);
      this.ai.push({ visual, strobe });
    }
    const box = new BoxGeometry(2, 2, 2);
    for (let i = 0; i < 24; i++) {
      const m = new Mesh(box, this.debrisMats[i % 3]);
      m.visible = false;
      m.castShadow = true;
      this.root.add(m);
      this.debris.push(m);
    }
    const sg = new SphereGeometry(1, 10, 8);
    for (let i = 0; i < 10; i++) {
      const m = new Mesh(sg, this.smokeMat);
      m.visible = false;
      this.root.add(m);
      this.smoke.push(m);
    }
    this.ctx = { dt: 0, time: 0, camera, weather: sim.weather, view: sim.view, cfg, night: 0, sun: this.sun, far: this.far };
  }

  private ensurePlayer(id: AircraftId): void {
    if (this.player && this.player.id === id) return;
    if (this.player) {
      this.root.remove(this.player.group);
      this.player.dispose();
      this.cockpit?.dispose();
    }
    this.player = buildAircraft(id);
    this.cockpit = new Cockpit(AIRCRAFT[id]);
    this.player.group.add(this.cockpit.group);
    this.root.add(this.player.group);
    this.rig.snap();
  }

  /** Show the recorded flight path (replay) or hide it. */
  setFlightPath(record: FlightRecord | null): void {
    if (record === this.pathRecord) return;
    this.pathRecord = record;
    if (this.path) {
      this.root.remove(this.path);
      this.path.geometry.dispose();
      (this.path.material as LineBasicMaterial).dispose();
      this.path = null;
    }
    if (!record) return;
    const f = record.frames;
    const pos = new Float32Array(f.length * 3);
    const col = new Float32Array(f.length * 3);
    const c = new Color();
    const max = Math.max(1, record.maxSpeed);
    for (let i = 0; i < f.length; i++) {
      pos.set([f[i].px, f[i].py, f[i].pz], i * 3);
      c.setHSL(0.62 - 0.62 * Math.min(1, f[i].speed / max), 0.95, 0.56);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    this.path = new Line(g, new LineBasicMaterial({ vertexColors: true, fog: false, depthTest: true }));
    this.path.frustumCulled = false;
    this.root.add(this.path);
  }

  update(dt: number, camera: PerspectiveCamera, mode: RigMode): void {
    this.time += dt;
    const view = sim.view;
    const w = sim.weather;
    w.sunDirection(this.sun);
    const ctx = this.ctx;
    ctx.dt = dt;
    ctx.time = this.time;
    ctx.camera = camera;
    ctx.night = w.night;

    // ---- player aircraft
    this.ensurePlayer(view.aircraftId);
    const spec = AIRCRAFT[view.aircraftId];
    const player = this.player!;
    player.group.visible = view.visible;
    player.group.position.copy(view.position);
    player.group.quaternion.copy(view.quaternion);
    const pose = this.pose;
    pose.gear = view.gear;
    pose.flaps = view.flaps;
    pose.elevator = view.elevator;
    pose.aileron = view.aileron;
    pose.rudder = view.rudder;
    pose.rpm = Math.min(1, view.rpm / spec.rpmMax);
    pose.power = view.power;
    player.update(pose, dt);
    const inside = (mode === 'cockpit' || mode === 'instruments') && view.visible;
    this.cockpit!.update(dt, sim.state, inside);

    // ---- camera
    this.rig.mode = mode;
    const st = sim.state;
    const flying = sim.mode === 'flying' && !sim.paused;
    const buffet = flying ? (st.stalled ? 0.9 : st.stallWarning ? 0.3 : 0) + w.localTurbulence * 0.35 * (st.onGround ? 0 : 1) + (st.onGround ? Math.min(0.5, st.groundSpeed * 0.004) : 0) : 0;
    this.rig.shake += (buffet - this.rig.shake) * Math.min(1, dt * 5);
    this.rig.update(dt, camera, view, spec, this.far);

    // ---- world
    this.terrain.update(dt, camera.position.x, camera.position.z);
    this.atmosphere.update(ctx);
    this.buildings.update(ctx);
    this.airports.update(ctx);
    this.landmarks.update(ctx);

    // ---- AI traffic
    const blink = (this.time * 1.1) % 1 < 0.08;
    this.strobeMat.color.setScalar(blink ? 2.5 : 0.0);
    for (let i = 0; i < this.ai.length; i++) {
      const a = sim.traffic.aircraft[i];
      const v = this.ai[i].visual;
      v.group.position.copy(a.position);
      v.group.quaternion.copy(a.quaternion);
      const low = a.position.y < 400;
      pose.gear = low ? 1 : 0;
      pose.flaps = low ? 0.5 : 0;
      pose.elevator = pose.aileron = pose.rudder = 0;
      pose.rpm = 0.8;
      pose.power = 0.7;
      v.update(pose, dt);
      this.ai[i].strobe.visible = blink;
    }

    // ---- crash debris (positions come straight from Rapier)
    const pieces = sim.collision?.debris ?? [];
    for (let i = 0; i < this.debris.length; i++) {
      const m = this.debris[i];
      const d = pieces[i];
      if (!d) {
        m.visible = false;
        continue;
      }
      const t = d.body.translation();
      const r = d.body.rotation();
      m.visible = true;
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
      m.scale.set(d.size[0], d.size[1], d.size[2]);
      m.material = this.debrisMats[d.color];
    }
    const burning = sim.mode === 'crashed';
    const age = sim.collision?.debrisTime ?? 0;
    for (let i = 0; i < this.smoke.length; i++) {
      const m = this.smoke[i];
      m.visible = burning;
      if (!burning) continue;
      const k = (age * 0.22 + i / this.smoke.length) % 1;
      m.position.set(view.position.x + Math.sin(i * 2.4) * 3 + k * 9, view.position.y + 1 + k * 46, view.position.z + Math.cos(i * 1.7) * 3);
      m.scale.setScalar(3 + k * 15);
    }
    this.smokeMat.opacity = 0.42;

    if (this.path) this.path.visible = sim.mode === 'replay';
  }

  dispose(): void {
    this.terrain.dispose();
    this.atmosphere.dispose();
    this.buildings.dispose();
    this.airports.dispose();
    this.landmarks.dispose();
    this.player?.dispose();
    this.cockpit?.dispose();
    this.ai.forEach((a) => a.visual.dispose());
    this.setFlightPath(null);
    this.root.removeFromParent();
  }
}
