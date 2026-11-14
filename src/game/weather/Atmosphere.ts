/**
 * Sky, sun, fog, ocean, clouds, rain and lightning. Everything is driven by
 * the WeatherSystem, so the weather panel changes what you see and what the
 * aircraft feels at the same time.
 */
import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { FrameContext, Subsystem } from '../engine/frame';
import { hash2, lerp, smoothstep } from '../terrain/noise';

const C = {
  zenithDay: new Color(0.16, 0.4, 0.86),
  zenithNight: new Color(0.006, 0.01, 0.03),
  horizonDay: new Color(0.62, 0.78, 0.95),
  horizonNight: new Color(0.02, 0.03, 0.065),
  sunset: new Color(1.0, 0.5, 0.22),
  overcast: new Color(0.56, 0.6, 0.65),
  sunDay: new Color(1.0, 0.96, 0.9),
  sunLow: new Color(1.0, 0.62, 0.36),
  moon: new Color(0.45, 0.55, 0.8),
  waterDay: new Color(0.03, 0.26, 0.42),
  waterNight: new Color(0.004, 0.02, 0.045),
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uSunset;
uniform float uTwilight; uniform float uNight; uniform float uSunVis; uniform float uFlash;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
  float sd = max(dot(d, uSun), 0.0);
  col = mix(col, uSunset, uTwilight * (0.25 + 0.75 * pow(sd, 3.0)) * pow(1.0 - h, 3.0));
  col += uSunColor * uSunVis * (smoothstep(0.9994, 0.9998, sd) * 6.0 + pow(sd, 60.0) * 0.35 + pow(sd, 6.0) * 0.08);
  if (uNight > 0.02 && d.y > 0.0) {
    vec3 p = d * 190.0; vec3 c = floor(p);
    float r = hash(c);
    float star = step(0.9962, r) * smoothstep(0.5, 0.05, length(fract(p) - 0.5));
    col += vec3(star) * uNight * smoothstep(0.0, 0.25, d.y) * (0.5 + r * 0.6) * (1.0 - uSunVis * 0.0);
  }
  col += vec3(0.6, 0.65, 0.8) * uFlash * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RAIN_VERT = /* glsl */ `
uniform vec3 uCam; uniform vec3 uFall; uniform float uTime; uniform float uBox; uniform float uLen;
attribute float aEnd;
varying float vA;
void main() {
  vec3 p = position + uFall * uTime;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  p += normalize(uFall) * aEnd * uLen;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vA = (1.0 - aEnd * 0.6) * smoothstep(uBox * 0.5, uBox * 0.2, length(mv.xyz));
  gl_Position = projectionMatrix * mv;
}`;
const RAIN_FRAG = /* glsl */ `
uniform float uOpacity; uniform vec3 uColor; varying float vA;
void main() { gl_FragColor = vec4(uColor, vA * uOpacity); }`;

export class Atmosphere implements Subsystem {
  readonly group = new Group();
  readonly sun = new DirectionalLight(0xffffff, 3);
  private hemi = new HemisphereLight(0xbcd7ff, 0x5a5346, 1);
  private ambient = new AmbientLight(0x8fa6c8, 0.15);
  private fog = new Fog(0xa8c8e8, 200, 20000);
  private sky: Mesh;
  private skyMat: ShaderMaterial;
  private water: Mesh;
  private waterMat: MeshStandardMaterial;
  private clouds: InstancedMesh;
  private cloudMat: MeshLambertMaterial;
  private deck: Mesh;
  private deckMat: MeshLambertMaterial;
  private rain: LineSegments;
  private rainMat: ShaderMaterial;
  private scene: Scene;
  private cloudCellX = Infinity;
  private cloudCellZ = Infinity;
  private cloudCover = -1;
  private maxPuffs: number;
  private tmpC = new Color();
  private tmpC2 = new Color();
  private m4 = new Matrix4();
  private v = new Vector3();
  private fall = new Vector3();
  /** Colours other systems want to match (building haze, HUD). */
  readonly horizon = new Color();

  constructor(scene: Scene, cfg: FrameContext['cfg']) {
    this.scene = scene;
    scene.fog = this.fog;

    this.skyMat = new ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uSun: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uSunset: { value: C.sunset.clone() },
        uTwilight: { value: 0 },
        uNight: { value: 0 },
        uSunVis: { value: 1 },
        uFlash: { value: 0 },
      },
    });
    this.sky = new Mesh(new SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    this.waterMat = new MeshStandardMaterial({ color: C.waterDay, roughness: 0.16, metalness: 0.35, transparent: true, opacity: 0.86, depthWrite: false });
    this.water = new Mesh(new PlaneGeometry(1, 1), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.renderOrder = 1;
    this.water.frustumCulled = false;
    this.group.add(this.water);

    // cumulus: clusters of low-poly puffs, recycled around the camera
    this.maxPuffs = cfg.clouds * 7;
    this.cloudMat = new MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.93, depthWrite: true });
    this.clouds = new InstancedMesh(new IcosahedronGeometry(1, 1), this.cloudMat, this.maxPuffs);
    this.clouds.frustumCulled = false;
    this.clouds.count = 0;
    this.group.add(this.clouds);

    this.deckMat = new MeshLambertMaterial({ color: 0x8a9099, transparent: true, opacity: 0, depthWrite: false, side: BackSide });
    this.deck = new Mesh(new PlaneGeometry(1, 1), this.deckMat);
    this.deck.rotation.x = -Math.PI / 2;
    this.deck.frustumCulled = false;
    this.deck.renderOrder = 2;
    this.group.add(this.deck);

    // rain streaks
    const n = cfg.rain;
    const pos = new Float32Array(n * 6);
    const end = new Float32Array(n * 2);
    const box = 90;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * box;
      const y = Math.random() * box;
      const z = Math.random() * box;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    }
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(pos, 3));
    rg.setAttribute('aEnd', new BufferAttribute(end, 1));
    this.rainMat = new ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uCam: { value: new Vector3() }, uFall: { value: new Vector3(0, -9, 0) }, uTime: { value: 0 }, uBox: { value: box }, uLen: { value: 1.4 }, uOpacity: { value: 0 }, uColor: { value: new Color(0.75, 0.82, 0.92) } },
    });
    this.rain = new LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 5;
    this.group.add(this.rain);

    this.sun.castShadow = cfg.shadows;
    this.sun.shadow.mapSize.set(cfg.shadowMap, cfg.shadowMap);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 10;
    sc.far = 700;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.group.add(this.sun, this.sun.target, this.hemi, this.ambient);
  }

  update(ctx: FrameContext): void {
    const w = ctx.weather;
    const s = w.state;
    const cam = ctx.camera.position;
    const sun = ctx.sun;
    const sunY = sun.y;
    const day = smoothstep(-0.12, 0.22, sunY);
    const night = ctx.night;
    const twilight = Math.max(0, 1 - Math.abs(sunY) / 0.3);
    const cloud = w.localCloud;
    const storm = Math.min(1, Math.max(w.localRain, s.lightning, w.cell));
    const grey = Math.pow(cloud, 1.4) * 0.9;
    const dim = 1 - 0.5 * storm * cloud;

    // ---- sky colours
    const u = this.skyMat.uniforms;
    const zen = (u.uZenith.value as Color).copy(C.zenithNight).lerp(C.zenithDay, day);
    const hor = (u.uHorizon.value as Color).copy(C.horizonNight).lerp(C.horizonDay, day);
    this.tmpC.copy(C.overcast).multiplyScalar(0.06 + 0.94 * day);
    zen.lerp(this.tmpC, grey).multiplyScalar(dim);
    hor.lerp(this.tmpC, grey * 0.95).multiplyScalar(dim);
    // fog makes the low sky uniformly pale
    const fogAmt = Math.min(1, s.fog * 1.1);
    this.tmpC2.copy(C.overcast).multiplyScalar(0.08 + 0.95 * day);
    hor.lerp(this.tmpC2, fogAmt);
    zen.lerp(this.tmpC2, fogAmt * 0.75);
    this.horizon.copy(hor);
    (u.uSun.value as Vector3).copy(sun);
    const sunCol = (u.uSunColor.value as Color).copy(C.sunLow).lerp(C.sunDay, smoothstep(0.0, 0.35, sunY));
    u.uTwilight.value = twilight * (1 - grey) * (1 - fogAmt);
    u.uNight.value = night * (1 - cloud * 0.9);
    u.uSunVis.value = (1 - smoothstep(0.45, 0.95, cloud)) * (1 - fogAmt) * smoothstep(-0.08, 0.02, sunY);
    u.uFlash.value = w.flash;
    this.sky.position.copy(cam);
    this.sky.scale.setScalar(ctx.far * 0.95);

    // ---- fog / visibility
    const vis = Math.min(w.visibility, ctx.far * 0.97);
    this.fog.color.copy(hor);
    if (w.flash > 0.02) this.fog.color.lerp(this.tmpC.setRGB(0.8, 0.85, 1), w.flash * 0.4);
    this.fog.far = vis;
    this.fog.near = vis * lerp(0.22, 0.02, Math.min(1, s.fog * 1.5 + w.localRain * 0.6));

    // ---- lights
    const direct = (1 - 0.82 * smoothstep(0.35, 1, cloud)) * (1 - fogAmt * 0.8);
    if (sunY > -0.05) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.3 * smoothstep(-0.05, 0.25, sunY) * direct + w.flash * 2;
      this.v.copy(sun);
    } else {
      // moonlight from the opposite side of the sky
      this.sun.color.copy(C.moon);
      this.sun.intensity = 0.28 * (1 - cloud * 0.8) + w.flash * 2.5;
      this.v.set(-sun.x, Math.max(0.25, -sun.y), -sun.z).normalize();
    }
    const tgt = ctx.view.position;
    this.sun.target.position.copy(tgt);
    this.sun.position.copy(tgt).addScaledVector(this.v, 300);
    this.hemi.intensity = (0.16 + 1.05 * day) * (1 - 0.35 * storm) + w.flash * 1.5;
    this.hemi.color.copy(zen).lerp(hor, 0.6).multiplyScalar(1.4).addScalar(0.06);
    this.hemi.groundColor.setRGB(0.32, 0.3, 0.26).multiplyScalar(0.25 + 0.75 * day);
    this.ambient.intensity = 0.1 + 0.25 * night;

    // ---- ocean
    const size = ctx.far * 2.4;
    this.water.scale.set(size, size, 1);
    this.water.position.set(cam.x, 0, cam.z);
    this.waterMat.color.copy(C.waterNight).lerp(C.waterDay, day).lerp(this.tmpC.copy(hor).multiplyScalar(0.55), 0.25 + grey * 0.4);
    this.waterMat.roughness = 0.14 + 0.3 * Math.min(1, s.windSpeed / 20) + 0.2 * w.localRain;

    // ---- clouds
    this.updateClouds(ctx, cloud, day, storm);
    const deckOpacity = smoothstep(0.55, 1, cloud) * 0.9;
    this.deckMat.opacity = deckOpacity;
    this.deck.visible = deckOpacity > 0.01;
    if (this.deck.visible) {
      this.deck.position.set(cam.x, 3300, cam.z);
      this.deck.scale.set(size, size, 1);
      this.deckMat.color.setRGB(0.62, 0.65, 0.7).multiplyScalar((0.1 + 0.9 * day) * (1 - 0.45 * storm));
      // above the overcast you look down on a bright cloud top
      this.deckMat.side = cam.y > 3300 ? 0 : BackSide;
      if (cam.y > 3300) this.deckMat.color.setRGB(0.92, 0.94, 0.97).multiplyScalar(0.12 + 0.88 * day);
    }

    // ---- rain
    const rain = w.localRain;
    this.rain.visible = rain > 0.03 && cam.y < 3200;
    if (this.rain.visible) {
      const ru = this.rainMat.uniforms;
      // streak direction = rain velocity relative to the camera (so fast flight streaks horizontally)
      const vel = ctx.view.velocity;
      this.fall.set(w.state.windSpeed * -Math.sin((w.state.windDirection * Math.PI) / 180) - vel.x, -11 - vel.y, w.state.windSpeed * Math.cos((w.state.windDirection * Math.PI) / 180) - vel.z);
      if (this.fall.length() > 70) this.fall.setLength(70);
      (ru.uFall.value as Vector3).copy(this.fall);
      (ru.uCam.value as Vector3).copy(cam);
      ru.uTime.value = ctx.time % 1000;
      ru.uLen.value = 0.9 + this.fall.length() * 0.06;
      ru.uOpacity.value = Math.min(0.75, rain * 0.8) * (0.35 + 0.65 * day + w.flash);
    }
  }

  private updateClouds(ctx: FrameContext, cover: number, day: number, storm: number): void {
    const cell = 2600;
    const cam = ctx.camera.position;
    const cx = Math.floor(cam.x / cell);
    const cz = Math.floor(cam.z / cell);
    const shade = (0.08 + 0.92 * day) * (1 - 0.55 * storm);
    this.cloudMat.color.setRGB(shade, shade, shade * 1.03);
    this.cloudMat.emissive.setRGB(0.5, 0.52, 0.6).multiplyScalar(ctx.weather.flash * 0.6 + 0.02 * (1 - day));
    if (cx === this.cloudCellX && cz === this.cloudCellZ && Math.abs(cover - this.cloudCover) < 0.03) return;
    this.cloudCellX = cx;
    this.cloudCellZ = cz;
    this.cloudCover = cover;
    const R = Math.max(3, Math.min(8, Math.round(ctx.far / cell) - 1));
    let n = 0;
    for (let dz = -R; dz <= R && n < this.maxPuffs - 8; dz++) {
      for (let dx = -R; dx <= R && n < this.maxPuffs - 8; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const gx = cx + dx;
        const gz = cz + dz;
        const r = hash2(gx * 3 + 11, gz * 3 - 5);
        if (r > cover * 0.95) continue;
        const bx = (gx + 0.2 + hash2(gx, gz) * 0.6) * cell;
        const bz = (gz + 0.2 + hash2(gz + 9, gx - 4) * 0.6) * cell;
        const by = 1500 + hash2(gx - 17, gz + 23) * 1300;
        const size = 260 + r * 420 + cover * 220;
        const puffs = 4 + Math.floor(hash2(gx + 5, gz + 5) * 4);
        for (let p = 0; p < puffs; p++) {
          const a = hash2(gx * 7 + p, gz * 5 - p) * Math.PI * 2;
          const d = hash2(gx - p * 3, gz + p * 11) * size * 1.1;
          const s = size * (0.45 + hash2(gx + p * 13, gz - p * 7) * 0.6);
          this.m4.makeScale(s, s * 0.55, s);
          this.m4.setPosition(bx + Math.cos(a) * d, by + s * 0.2 * (p % 2), bz + Math.sin(a) * d);
          this.clouds.setMatrixAt(n++, this.m4);
        }
      }
    }
    this.clouds.count = n;
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.fog = null;
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.water.geometry.dispose();
    this.waterMat.dispose();
    this.clouds.geometry.dispose();
    this.cloudMat.dispose();
    this.deck.geometry.dispose();
    this.deckMat.dispose();
    this.rain.geometry.dispose();
    this.rainMat.dispose();
    this.sun.shadow.map?.dispose();
  }
}
