// Copies the MediaPipe WASM runtime out of node_modules into /public so that all
// computer-vision code is served from the same origin (no CDN, no uploads), and
// makes sure the hand-landmark model is present.
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = path.join(root, 'public/mediapipe/wasm');
const model = path.join(root, 'public/models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const exists = (p) => access(p).then(() => true, () => false);

await mkdir(wasmDst, { recursive: true });
if (await exists(wasmSrc)) {
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log('[setup] MediaPipe WASM runtime ready');
} else {
  console.warn('[setup] @mediapipe/tasks-vision is not installed yet - run npm install');
}

if (!(await exists(model))) {
  console.log('[setup] downloading hand landmark model...');
  await mkdir(path.dirname(model), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  await writeFile(model, Buffer.from(await res.arrayBuffer()));
}
console.log('[setup] hand landmark model ready');
