/**
 * Runs MediaPipe Hand Landmarker (one hand) on the webcam video at its own
 * rate, independent of the render loop. Prefers a Web Worker; falls back to
 * the main thread if the worker cannot start.
 */
import type { HandLandmarks, Handedness } from '../../types';
import { HAND_OPTIONS, type Delegate, type FromWorker, type RawHand } from './protocol';

export type TrackerState = 'idle' | 'loading' | 'ready' | 'error';

export interface TrackerInfo {
  state: TrackerState;
  /** e.g. "worker · GPU" */
  backend: string;
  error: string;
  /** Inference results per second. */
  fps: number;
  /** Mean inference time, ms. */
  inferMs: number;
}

export interface TrackerOptions {
  delegate: Delegate;
  useWorker: boolean;
  fps: number;
}

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}models/hand_landmarker.task`;

/**
 * MediaPipe labels handedness assuming a mirrored (selfie) image. We feed the
 * raw, un-mirrored camera frame, so the label is flipped to get the player's
 * physical hand; landmark x is mirrored so +x is the player's right.
 */
export function toHandLandmarks(raw: RawHand, timestamp: number): HandLandmarks {
  const physical: Handedness = raw.label === 'Left' ? 'Right' : 'Left';
  return {
    image: raw.landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
    world: raw.world.map((p) => ({ x: -p.x, y: p.y, z: p.z })),
    handedness: physical,
    score: raw.score,
    timestamp,
  };
}

export class HandTracker {
  readonly info: TrackerInfo = { state: 'idle', backend: '', error: '', fps: 0, inferMs: 0 };
  onResult: (hand: HandLandmarks | null, timestamp: number) => void = () => {};
  onInfo: (info: TrackerInfo) => void = () => {};

  private video: HTMLVideoElement | null = null;
  private worker: Worker | null = null;
  private main: { detectForVideo(v: HTMLVideoElement, ts: number): any; close(): void } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private busySince = 0;
  private interval = 1000 / 24;
  private lastVideoTime = -1;
  private stamps: number[] = [];
  private inferAvg = 0;
  private running = false;
  private lastTs = 0;

  setFps(fps: number): void {
    this.interval = 1000 / Math.max(5, Math.min(60, fps));
  }

  async start(video: HTMLVideoElement, opts: TrackerOptions): Promise<void> {
    this.stop();
    this.video = video;
    this.setFps(opts.fps);
    this.setInfo({ state: 'loading', backend: '', error: '' });
    this.running = true;
    let ok = false;
    if (opts.useWorker && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      ok = await this.startWorker(opts.delegate).catch(() => false);
    }
    if (!ok && this.running) {
      try {
        await this.startMain(opts.delegate);
        ok = true;
      } catch (e) {
        this.setInfo({ state: 'error', error: `Hand tracking could not start: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    if (ok && this.running) {
      this.setInfo({ state: 'ready' });
      this.schedule(0);
    }
  }

  private startWorker(delegate: Delegate): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (v: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!v) {
          this.worker?.terminate();
          this.worker = null;
        }
        resolve(v);
      };
      const timeout = setTimeout(() => finish(false), 25000);
      try {
        const w = new Worker(new URL('./handWorker.ts', import.meta.url), { type: 'module' });
        this.worker = w;
        w.onerror = () => finish(false);
        w.onmessage = (ev: MessageEvent<FromWorker>) => {
          const m = ev.data;
          if (m.type === 'ready') {
            this.info.backend = `worker · ${m.delegate}`;
            finish(true);
          } else if (m.type === 'error') {
            if (!settled) finish(false);
            else this.info.error = m.message;
          } else if (m.type === 'result') {
            this.busy = false;
            this.deliver(m.hand, m.ts, m.inferMs);
          }
        };
        w.postMessage({ type: 'init', wasmPath: new URL(WASM_PATH, location.href).href, modelPath: new URL(MODEL_PATH, location.href).href, delegate });
      } catch {
        finish(false);
      }
    });
  }

  private async startMain(delegate: Delegate): Promise<void> {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const order: Delegate[] = delegate === 'GPU' ? ['GPU', 'CPU'] : ['CPU'];
    let last: unknown;
    for (const d of order) {
      try {
        this.main = await HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_PATH, delegate: d }, ...HAND_OPTIONS });
        this.info.backend = `main thread · ${d}`;
        return;
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private tick(): void {
    if (!this.running) return;
    const started = performance.now();
    const v = this.video;
    // a stuck worker must not stall tracking forever
    if (this.busy && started - this.busySince > 1500) this.busy = false;
    if (v && !this.busy && v.readyState >= 2 && v.videoWidth > 0 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      // MediaPipe requires strictly increasing timestamps
      const ts = Math.max(started, this.lastTs + 1);
      this.lastTs = ts;
      if (this.worker) {
        this.busy = true;
        this.busySince = started;
        const w = this.worker;
        createImageBitmap(v)
          .then((bitmap) => {
            if (this.worker === w) w.postMessage({ type: 'frame', bitmap, ts }, [bitmap]);
            else bitmap.close();
          })
          .catch(() => {
            this.busy = false;
          });
      } else if (this.main) {
        try {
          const res = this.main.detectForVideo(v, ts);
          let hand: RawHand | null = null;
          if (res.landmarks.length > 0) {
            const cat = res.handedness?.[0]?.[0] ?? res.handednesses?.[0]?.[0];
            hand = { landmarks: res.landmarks[0], world: res.worldLandmarks[0] ?? res.landmarks[0], label: cat?.categoryName ?? 'Right', score: cat?.score ?? 0.5 };
          }
          this.deliver(hand, ts, performance.now() - started);
        } catch (e) {
          this.info.error = e instanceof Error ? e.message : String(e);
        }
      }
    }
    this.schedule(Math.max(2, this.interval - (performance.now() - started)));
  }

  private deliver(raw: RawHand | null, ts: number, inferMs: number): void {
    const now = performance.now();
    this.stamps.push(now);
    while (this.stamps.length && now - this.stamps[0] > 1000) this.stamps.shift();
    this.inferAvg = this.inferAvg ? this.inferAvg * 0.9 + inferMs * 0.1 : inferMs;
    this.info.fps = this.stamps.length;
    this.info.inferMs = this.inferAvg;
    this.onResult(raw ? toHandLandmarks(raw, ts) : null, ts);
  }

  private setInfo(patch: Partial<TrackerInfo>): void {
    Object.assign(this.info, patch);
    this.onInfo(this.info);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
    try {
      this.main?.close();
    } catch {
      /* already closed */
    }
    this.main = null;
    this.busy = false;
    this.stamps = [];
    this.lastVideoTime = -1;
    this.info.fps = 0;
    if (this.info.state !== 'error') this.setInfo({ state: 'idle' });
  }
}
