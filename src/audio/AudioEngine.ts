/**
 * Procedural sound: everything is synthesised with the Web Audio API from the
 * live simulation state — no audio files.
 *
 *  engine   pitch & timbre follow RPM and power (piston / turboprop / jet)
 *  wind     follows airspeed
 *  cockpit  cabin hum when inside
 *  systems  flap / gear motors and locks, stall horn, autopilot chimes
 *  ground   tyre chirp and thump scaled by the real touchdown sink rate
 *  weather  rain, thunder
 *  world    spatialised airport, city and AI-aircraft sources (PannerNodes)
 *
 * The AudioContext is created on the first user gesture (autoplay policy).
 */
import type { Quaternion, Vector3 } from 'three';
import { AIRCRAFT } from '../game/aircraft/specs';
import type { SimEvent, Simulation } from '../game/engine/Simulation';
import { AIRPORTS, CITY } from '../game/world/aerona';
import type { CameraMode } from '../types';

interface Volumes {
  master: number;
  engine: number;
  ambience: number;
  muted: boolean;
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private ambienceBus!: GainNode;
  private fxBus!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private vol: Volumes = { master: 0.8, engine: 0.8, ambience: 0.7, muted: false };

  // engine voice
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private whine!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private toneGain!: GainNode;
  private whineGain!: GainNode;
  private roarFilter!: BiquadFilterNode;
  private roarGain!: GainNode;
  // wind / cabin / rain
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private cabinGain!: GainNode;
  private rainGain!: GainNode;
  // warnings
  private hornGain!: GainNode;
  // spatial
  private airportPanner!: PannerNode;
  private airportGain!: GainNode;
  private cityPanner!: PannerNode;
  private trafficPanners: PannerNode[] = [];
  private hornPhase = 0;
  private sim: Simulation | null = null;
  private unsubscribe: (() => void) | null = null;
  private suspended = false;

  get ready(): boolean {
    return !!this.ctx;
  }

  attach(sim: Simulation): void {
    this.sim = sim;
    this.unsubscribe?.();
    this.unsubscribe = sim.events.on((e) => this.onEvent(e));
  }

  setVolumes(v: Volumes): void {
    this.vol = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(v.engine, t, 0.05);
    this.ambienceBus.gain.setTargetAtTime(v.ambience, t, 0.05);
  }

  /** Must be called from a user gesture (click / key press). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.suspended) void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 3, true);
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.ambienceBus.connect(this.master);
    this.fxBus.connect(this.master);

    const loop = (buf: AudioBuffer): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };
    const gain = (v = 0): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };

    // ---- engine: two detuned oscillators + filtered noise "roar" + turbine whine
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2.type = 'square';
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.toneGain = gain();
    this.osc1.connect(this.engFilter);
    this.osc2.connect(this.engFilter);
    this.engFilter.connect(this.toneGain).connect(this.engineBus);
    this.osc1.start();
    this.osc2.start();
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.Q.value = 0.7;
    this.roarGain = gain();
    loop(this.brown).connect(this.roarFilter).connect(this.roarGain).connect(this.engineBus);
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = gain();
    this.whine.connect(this.whineGain).connect(this.engineBus);
    this.whine.start();

    // ---- wind
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.5;
    this.windGain = gain();
    loop(this.white).connect(this.windFilter).connect(this.windGain).connect(this.ambienceBus);

    // ---- cabin hum
    const cabinFilter = ctx.createBiquadFilter();
    cabinFilter.type = 'lowpass';
    cabinFilter.frequency.value = 180;
    this.cabinGain = gain();
    loop(this.brown).connect(cabinFilter).connect(this.cabinGain).connect(this.ambienceBus);

    // ---- rain
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1800;
    this.rainGain = gain();
    loop(this.white).connect(rainFilter).connect(this.rainGain).connect(this.ambienceBus);

    // ---- stall horn
    const horn = ctx.createOscillator();
    horn.type = 'square';
    horn.frequency.value = 520;
    this.hornGain = gain();
    horn.connect(this.hornGain).connect(this.fxBus);
    horn.start();

    // ---- spatial world sources
    const panner = (ref: number, max: number, rolloff: number): PannerNode => {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.maxDistance = max;
      p.rolloffFactor = rolloff;
      return p;
    };
    this.airportPanner = panner(260, 9000, 1.3);
    const apFilter = ctx.createBiquadFilter();
    apFilter.type = 'bandpass';
    apFilter.frequency.value = 420;
    apFilter.Q.value = 0.4;
    this.airportGain = gain(0.5);
    loop(this.brown).connect(apFilter).connect(this.airportGain).connect(this.airportPanner).connect(this.ambienceBus);
    this.cityPanner = panner(1400, 20000, 1.1);
    const cityFilter = ctx.createBiquadFilter();
    cityFilter.type = 'lowpass';
    cityFilter.frequency.value = 520;
    const cityGain = gain(0.55);
    loop(this.brown).connect(cityFilter).connect(cityGain).connect(this.cityPanner).connect(this.ambienceBus);
    this.cityPanner.positionX.value = CITY.x;
    this.cityPanner.positionY.value = 120;
    this.cityPanner.positionZ.value = CITY.z;
    for (let i = 0; i < 6; i++) {
      const p = panner(90, 5000, 1.5);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 78 + i * 13;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      const g = gain(0.5);
      o.connect(f).connect(g).connect(p).connect(this.ambienceBus);
      o.start();
      this.trafficPanners.push(p);
    }
    this.setVolumes(this.vol);
  }

  /** Silence everything while paused / in menus without tearing the graph down. */
  setSuspended(s: boolean): void {
    this.suspended = s;
    if (!this.ctx) return;
    if (s && this.ctx.state === 'running') void this.ctx.suspend();
    if (!s && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private blip(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.fxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, vol: number, filter: BiquadFilterType, freq: number, brown = false, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = brown ? this.brown : this.white;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.fxBus);
    s.start(t);
    s.stop(t + dur + 0.1);
  }

  /** UI feedback: a gesture was recognised. */
  gestureTick(): void {
    this.blip(880, 0.09, 'triangle', 0.16, 1320);
  }
  uiClick(): void {
    this.blip(520, 0.05, 'triangle', 0.08);
  }

  private onEvent(e: SimEvent): void {
    if (!this.ctx || !this.sim) return;
    const spec = this.sim.spec;
    switch (e.type) {
      case 'touchdown': {
        if (e.point.kind === 'gear') {
          const hard = Math.min(1, e.sinkRate / 4);
          this.burst(0.16 + hard * 0.1, 0.12 + hard * 0.35, 'highpass', 2400); // tyre chirp
          this.blip(70, 0.28, 'sine', 0.2 + hard * 0.5, 34); // strut thump
        } else {
          this.burst(0.5, 0.4, 'lowpass', 500, true);
        }
        break;
      }
      case 'splash':
        this.burst(0.9, 0.35, 'bandpass', 1200);
        break;
      case 'gear':
        this.blip(150, spec.gearTime, 'sawtooth', 0.07, 185);
        this.burst(0.08, 0.2, 'lowpass', 700, true);
        break;
      case 'gearLocked':
        this.burst(0.12, 0.35, 'lowpass', 420, true);
        this.blip(90, 0.12, 'sine', 0.3, 50);
        break;
      case 'flaps':
        this.blip(240, spec.flapTime / (spec.flapNotches.length - 1), 'triangle', 0.06, 262);
        break;
      case 'engineStart':
        this.burst(0.5, 0.25, 'bandpass', 300, true);
        break;
      case 'engineStop':
        this.blip(180, 0.9, 'sawtooth', 0.12, 40);
        break;
      case 'autopilot':
        if (e.on) {
          this.blip(660, 0.12, 'sine', 0.18);
          setTimeout(() => this.blip(990, 0.16, 'sine', 0.18), 110);
        } else {
          this.blip(880, 0.12, 'sine', 0.18);
          setTimeout(() => this.blip(520, 0.2, 'sine', 0.18), 110);
        }
        break;
      case 'damage':
        this.burst(0.25, 0.4, 'lowpass', 900, true);
        break;
      case 'crash':
        this.burst(1.6, 0.9, 'lowpass', 380, true);
        this.burst(0.5, 0.6, 'highpass', 1500);
        this.blip(60, 1.1, 'sine', 0.8, 22);
        break;
      case 'thunder':
        this.burst(3.2, 0.5 * e.strength, 'lowpass', 160, true, 0.4 + Math.random() * 1.8);
        break;
      case 'gate':
        this.blip(784, 0.12, 'sine', 0.2);
        setTimeout(() => this.blip(1175, 0.2, 'sine', 0.2), 90);
        break;
      case 'landing':
        if (e.report.total >= 72) {
          this.blip(523, 0.14, 'sine', 0.16);
          setTimeout(() => this.blip(659, 0.14, 'sine', 0.16), 120);
          setTimeout(() => this.blip(784, 0.26, 'sine', 0.16), 240);
        }
        break;
      default:
        break;
    }
  }

  /** Per-frame update from the render loop. */
  update(dt: number, camPos: Vector3, camQuat: Quaternion, camera: CameraMode | 'orbit' | 'wreck', active: boolean): void {
    const ctx = this.ctx;
    const sim = this.sim;
    if (!ctx || !sim || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const s = sim.state;
    const view = sim.view;
    const spec = AIRCRAFT[view.aircraftId];
    const inside = camera === 'cockpit' || camera === 'instruments';
    const live = active && (sim.mode === 'flying' || sim.mode === 'replay');
    const tc = 0.06;

    // ---- listener
    const l = ctx.listener;
    const fx = -2 * (camQuat.x * camQuat.z + camQuat.w * camQuat.y);
    const fy = -2 * (camQuat.y * camQuat.z - camQuat.w * camQuat.x);
    const fz = -(1 - 2 * (camQuat.x * camQuat.x + camQuat.y * camQuat.y));
    if (l.positionX) {
      l.positionX.setTargetAtTime(camPos.x, t, 0.05);
      l.positionY.setTargetAtTime(camPos.y, t, 0.05);
      l.positionZ.setTargetAtTime(camPos.z, t, 0.05);
      l.forwardX.setTargetAtTime(fx, t, 0.05);
      l.forwardY.setTargetAtTime(fy, t, 0.05);
      l.forwardZ.setTargetAtTime(fz, t, 0.05);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(camPos.x, camPos.y, camPos.z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }

    // ---- engine
    const rpmFrac = Math.min(1.1, view.rpm / spec.rpmMax);
    const power = view.power;
    const running = live && view.rpm > spec.rpmIdle * 0.25;
    const dist = camPos.distanceTo(view.position);
    const near = inside ? 0.6 : Math.min(1, 26 / Math.max(dist, 26));
    if (spec.engineType === 'jet') {
      this.osc1.frequency.setTargetAtTime(60 + rpmFrac * 70, t, tc);
      this.osc2.frequency.setTargetAtTime(91 + rpmFrac * 96, t, tc);
      this.engFilter.frequency.setTargetAtTime(200 + power * 500, t, tc);
      this.toneGain.gain.setTargetAtTime(running ? 0.035 * near : 0, t, tc);
      this.roarFilter.frequency.setTargetAtTime(180 + power * 900, t, tc);
      this.roarGain.gain.setTargetAtTime(running ? (0.12 + power * power * 0.75) * near : 0, t, tc);
      this.whine.frequency.setTargetAtTime(900 + rpmFrac * 3100, t, tc);
      this.whineGain.gain.setTargetAtTime(running ? (0.012 + rpmFrac * 0.02) * near : 0, t, tc);
    } else {
      // firing / blade-pass frequency
      const base = spec.engineType === 'piston' ? (view.rpm / 60) * 2 : (view.rpm / 60) * 4;
      this.osc1.frequency.setTargetAtTime(Math.max(18, base), t, tc);
      this.osc2.frequency.setTargetAtTime(Math.max(9, base * 0.5 + 1.5), t, tc);
      this.engFilter.frequency.setTargetAtTime(260 + power * 1500 + rpmFrac * 500, t, tc);
      this.toneGain.gain.setTargetAtTime(running ? (0.07 + power * 0.2) * near * spec.engineCount ** 0.3 : 0, t, tc);
      this.roarFilter.frequency.setTargetAtTime(140 + rpmFrac * 380, t, tc);
      this.roarGain.gain.setTargetAtTime(running ? (0.08 + power * 0.32) * near : 0, t, tc);
      const turbine = spec.engineType === 'turboprop';
      this.whine.frequency.setTargetAtTime(1700 + rpmFrac * 2600, t, tc);
      this.whineGain.gain.setTargetAtTime(running && turbine ? (0.008 + power * 0.014) * near : 0, t, tc);
    }

    // ---- wind, cabin, rain
    const q = Math.min(1, view.speed / (spec.vne * 0.9));
    this.windFilter.frequency.setTargetAtTime(420 + q * 1600, t, 0.1);
    this.windGain.gain.setTargetAtTime(live ? Math.pow(q, 1.4) * (inside ? 0.34 : 0.22) + (sim.weather.state.windSpeed / 60) * 0.12 : 0, t, 0.1);
    this.cabinGain.gain.setTargetAtTime(live && inside ? 0.35 : 0, t, 0.15);
    this.rainGain.gain.setTargetAtTime(active ? sim.weather.localRain * (inside ? 0.26 : 0.16) : 0, t, 0.3);

    // ---- stall horn (beeps while the warning is active)
    this.hornPhase += dt;
    const horn = live && sim.mode === 'flying' && s.stallWarning && this.hornPhase % 0.32 < 0.18;
    this.hornGain.gain.setTargetAtTime(horn ? 0.07 : 0, t, 0.008);

    // ---- spatial sources
    let best = AIRPORTS[0];
    let bd = Infinity;
    for (const a of AIRPORTS) {
      const d = (a.x - camPos.x) ** 2 + (a.z - camPos.z) ** 2;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    this.airportPanner.positionX.setTargetAtTime(best.x, t, 0.4);
    this.airportPanner.positionY.setTargetAtTime(best.elevation + 10, t, 0.4);
    this.airportPanner.positionZ.setTargetAtTime(best.z, t, 0.4);
    this.airportGain.gain.setTargetAtTime(best.kind === 'international' ? 0.9 : best.kind === 'regional' ? 0.45 : 0.18, t, 0.4);
    const traffic = sim.traffic.aircraft;
    for (let i = 0; i < this.trafficPanners.length && i < traffic.length; i++) {
      const p = this.trafficPanners[i];
      p.positionX.setTargetAtTime(traffic[i].position.x, t, 0.05);
      p.positionY.setTargetAtTime(traffic[i].position.y, t, 0.05);
      p.positionZ.setTargetAtTime(traffic[i].position.z, t, 0.05);
    }
  }
}

export const audio = new AudioEngine();
