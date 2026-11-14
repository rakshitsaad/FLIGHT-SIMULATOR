/**
 * Every generic building in AERONA as two instanced draw calls (boxes and
 * cylinders). Windows are drawn procedurally in the shader from each
 * instance's real dimensions, and light up at night.
 */
import { BoxGeometry, Color, CylinderGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Quaternion, Vector3, Group, type BufferGeometry } from 'three';
import type { FrameContext, Subsystem } from '../engine/frame';
import { getStructures, type Structure, type StructureStyle } from './structures';

const PALETTE: Record<StructureStyle, [number, number, number][]> = {
  tower: [[0.42, 0.52, 0.62], [0.3, 0.38, 0.48], [0.55, 0.6, 0.66], [0.24, 0.3, 0.36], [0.5, 0.56, 0.52]],
  office: [[0.62, 0.6, 0.56], [0.5, 0.52, 0.56], [0.7, 0.66, 0.6], [0.44, 0.47, 0.5]],
  lowrise: [[0.72, 0.66, 0.58], [0.62, 0.52, 0.46], [0.78, 0.74, 0.68], [0.56, 0.56, 0.58], [0.66, 0.44, 0.36]],
  house: [[0.86, 0.82, 0.74], [0.8, 0.7, 0.6], [0.9, 0.88, 0.84], [0.72, 0.6, 0.5]],
  terminal: [[0.8, 0.83, 0.86], [0.7, 0.74, 0.78]],
  hangar: [[0.6, 0.64, 0.68], [0.5, 0.54, 0.58], [0.66, 0.6, 0.5]],
  control: [[0.84, 0.84, 0.82]],
  industrial: [[0.5, 0.5, 0.5], [0.58, 0.54, 0.48]],
  pylon: [[0.6, 0.3, 0.25]],
  deck: [[0.4, 0.4, 0.42]],
  landmark: [[0.7, 0.7, 0.7]],
};
/** How strongly windows are drawn for a style (0 = blank walls). */
const WINDOWS: Record<StructureStyle, number> = { tower: 1, office: 1, lowrise: 0.8, house: 0.5, terminal: 0.9, hangar: 0, control: 0.6, industrial: 0.15, pylon: 0, deck: 0, landmark: 0 };

function windowMaterial(night: { value: number }): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSize;\nvarying vec3 vLocalP;\nvarying vec3 vLocalN;\nvarying vec4 vSize;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalP = position * aSize.xyz;\nvLocalN = normal;\nvSize = aSize;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vLocalP;\nvarying vec3 vLocalN;\nvarying vec4 vSize;\nfloat whash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float wLit = 0.0;
        float wMask = 0.0;
        if (abs(vLocalN.y) < 0.5 && vSize.w > 0.01) {
          float horiz = abs(vLocalN.x) > 0.5 ? vLocalP.z : vLocalP.x;
          float seed = abs(vLocalN.x) > 0.5 ? 17.0 : 3.0;
          vec2 cell = vec2(horiz / 3.4 + 100.0, (vLocalP.y + vSize.y * 0.5) / 3.7);
          vec2 f = fract(cell);
          vec2 id = floor(cell);
          float dist = length(vViewPosition);
          float fade = 1.0 - smoothstep(1400.0, 5200.0, dist);
          wMask = step(0.16, f.x) * step(f.x, 0.84) * step(0.28, f.y) * step(f.y, 0.82) * vSize.w * fade;
          float r = whash(id + seed + vSize.xz);
          wLit = step(1.0 - 0.5 * uNight, r) * wMask + (1.0 - fade) * 0.22 * uNight * vSize.w;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.16, 0.24) + 0.25 * diffuseColor.rgb, wMask * 0.82);
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * wLit * uNight * 1.5;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.15, wMask);');
  };
  return mat;
}

export class Buildings implements Subsystem {
  readonly group = new Group();
  private night = { value: 0 };
  private mats: MeshStandardMaterial[] = [];
  private geos: BufferGeometry[] = [];

  constructor() {
    const all = getStructures().filter((s) => !s.custom);
    this.make(all.filter((s) => !s.round), new BoxGeometry(1, 1, 1));
    this.make(all.filter((s) => s.round), new CylinderGeometry(0.5, 0.5, 1, 14));
  }

  private make(list: Structure[], geo: BufferGeometry): void {
    if (!list.length) return;
    const mat = windowMaterial(this.night);
    const mesh = new InstancedMesh(geo, mat, list.length);
    const size = new Float32Array(list.length * 4);
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const sc = new Vector3();
    const c = new Color();
    const up = new Vector3(0, 1, 0);
    list.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rot);
      p.set(s.x, s.y + s.h / 2, s.z);
      sc.set(s.w, s.h, s.d);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      const pal = PALETTE[s.style];
      const col = pal[Math.floor(s.tint * pal.length) % pal.length];
      const v = 0.9 + ((s.tint * 7.3) % 1) * 0.2;
      mesh.setColorAt(i, c.setRGB(col[0] * v, col[1] * v, col[2] * v));
      size.set([s.w, s.h, s.d, WINDOWS[s.style]], i * 4);
    });
    geo.setAttribute('aSize', new InstancedBufferAttribute(size, 4));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    this.mats.push(mat);
    this.geos.push(geo);
  }

  update(ctx: FrameContext): void {
    this.night.value = Math.max(ctx.night, Math.min(1, ctx.weather.localCloud * ctx.weather.localRain * 0.9));
  }

  dispose(): void {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.group.children.forEach((c) => (c as Object3D & { dispose?: () => void }).dispose?.());
  }
}
