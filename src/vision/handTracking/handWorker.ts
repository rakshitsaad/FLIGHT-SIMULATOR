/// <reference lib="webworker" />
/**
 * Hand-landmark inference off the main thread, so the 3D renderer never
 * waits for computer vision. Receives ImageBitmaps, returns 21 landmarks.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { HAND_OPTIONS, type Delegate, type FromWorker, type RawHand, type ToWorker } from './protocol';

let landmarker: HandLandmarker | null = null;
const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function create(wasmPath: string, modelPath: string, delegate: Delegate): Promise<Delegate> {
  const fileset = await FilesetResolver.forVisionTasks(wasmPath, true);
  const order: Delegate[] = delegate === 'GPU' ? ['GPU', 'CPU'] : ['CPU'];
  let lastError: unknown;
  for (const d of order) {
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: modelPath, delegate: d }, ...HAND_OPTIONS });
      return d;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      const used = await create(m.wasmPath, m.modelPath, m.delegate);
      post({ type: 'ready', delegate: used });
    } catch (e) {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  if (m.type === 'frame') {
    if (!landmarker) {
      m.bitmap.close();
      return;
    }
    const t0 = performance.now();
    let hand: RawHand | null = null;
    try {
      const res = landmarker.detectForVideo(m.bitmap, m.ts);
      if (res.landmarks.length > 0) {
        const cat = res.handedness[0]?.[0] ?? res.handednesses?.[0]?.[0];
        hand = {
          landmarks: res.landmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z })),
          world: (res.worldLandmarks[0] ?? res.landmarks[0]).map((p) => ({ x: p.x, y: p.y, z: p.z })),
          label: cat?.categoryName ?? 'Right',
          score: cat?.score ?? 0.5,
        };
      }
    } catch (e) {
      post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    m.bitmap.close();
    post({ type: 'result', ts: m.ts, hand, inferMs: performance.now() - t0 });
  }
};
