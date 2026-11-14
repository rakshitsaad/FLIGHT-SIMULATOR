/**
 * The 3D cockpit: instrument panel (a live canvas texture), glareshield,
 * windscreen frame, control stick and throttle lever. Parented to the
 * aircraft and positioned relative to the pilot's eye point.
 */
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, SRGBColorSpace, SphereGeometry } from 'three';
import type { AircraftState } from '../../types';
import type { AircraftSpec } from '../aircraft/specs';
import { InstrumentPanel } from './instruments';

export class Cockpit {
  readonly group = new Group();
  readonly panel: InstrumentPanel;
  private texture: CanvasTexture;
  private stick = new Object3D();
  private lever = new Object3D();
  private disposables: { dispose(): void }[] = [];
  private timer = 0;

  constructor(spec: AircraftSpec) {
    this.panel = new InstrumentPanel(spec);
    this.texture = new CanvasTexture(this.panel.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const e = spec.eye;
    this.group.position.set(e.x, e.y, e.z);
    const dark = new MeshStandardMaterial({ color: '#15181c', roughness: 0.85 });
    const trim = new MeshStandardMaterial({ color: '#2a2f36', roughness: 0.6, metalness: 0.3 });
    const add = (geo: BoxGeometry | CylinderGeometry | PlaneGeometry | SphereGeometry, mat: MeshStandardMaterial | MeshBasicMaterial, x: number, y: number, z: number, parent: Object3D = this.group) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      this.disposables.push(geo);
      return m;
    };
    // panel: self-lit so it stays readable at night
    const panelMat = new MeshBasicMaterial({ map: this.texture, toneMapped: false });
    const p = add(new PlaneGeometry(0.96, 0.48), panelMat, 0, -0.36, -0.66);
    p.rotation.x = -0.12;
    add(new BoxGeometry(1.5, 0.5, 0.05), dark, 0, -0.37, -0.69).rotation.x = -0.12;
    // glareshield + coaming
    add(new BoxGeometry(1.2, 0.045, 0.34), dark, 0, -0.105, -0.6).rotation.x = 0.08;
    add(new BoxGeometry(1.6, 0.4, 0.5), dark, 0, -0.72, -0.5);
    // windscreen frame
    const pillar = (s: number) => {
      const m = add(new BoxGeometry(0.05, 0.9, 0.05), trim, s * 0.6, 0.3, -0.62);
      m.rotation.z = s * -0.24;
      m.rotation.x = 0.5;
    };
    pillar(1);
    pillar(-1);
    add(new BoxGeometry(1.35, 0.05, 0.05), trim, 0, 0.62, -0.38);
    // side walls / sills
    for (const s of [1, -1]) add(new BoxGeometry(0.06, 0.5, 1.5), dark, s * 0.72, -0.5, -0.1);
    // stick
    this.stick.position.set(0, -0.72, -0.32);
    add(new CylinderGeometry(0.014, 0.018, 0.42, 8), trim, 0, 0.21, 0, this.stick);
    add(new SphereGeometry(0.035, 10, 8), dark, 0, 0.43, 0, this.stick);
    this.group.add(this.stick);
    // throttle
    this.lever.position.set(0.36, -0.62, -0.42);
    add(new CylinderGeometry(0.01, 0.01, 0.2, 6), trim, 0, 0.1, 0, this.lever);
    add(new SphereGeometry(0.028, 10, 8), new MeshStandardMaterial({ color: '#111111' }), 0, 0.2, 0, this.lever);
    this.group.add(this.lever);
    this.disposables.push(dark, trim, panelMat, this.texture);
    this.group.visible = false;
  }

  update(dt: number, s: AircraftState, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1 / 30;
      this.panel.draw(s);
      this.texture.needsUpdate = true;
    }
    this.stick.rotation.x = s.elevator * 0.28;
    this.stick.rotation.z = -s.aileron * 0.3;
    this.lever.rotation.x = 0.5 - s.throttle * 1.0;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
