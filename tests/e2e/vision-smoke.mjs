// Runs the real MediaPipe pipeline in Chromium against a fake webcam fed from a video file.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const video = process.argv[2];
const query = process.argv[3] ?? '';
const seconds = Number(process.argv[4] ?? 9);
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5173/tests/pages/vision.html${query}`);
await page.waitForFunction(() => window.visionStarted !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(seconds * 1000);
const log = await page.evaluate(() => window.visionLog);
const status = await page.evaluate(() => window.vision.status);
console.log('status', JSON.stringify({ backend: status.backend, fps: status.fps, inferMs: Math.round(status.inferMs), brightness: Math.round(status.brightness), running: status.running }));
console.log('cmds', JSON.stringify(await page.evaluate(() => window.visionCmds)));
let lastKey = '';
for (const l of log) {
  const key = `${l.st}|${l.g}|${Math.round(l.t * (Number(process.argv[5] ?? 2)))}`;
  if (key !== lastKey) { console.log(`${String(l.t).padStart(6)} ${l.st.padEnd(10)} roll ${String(l.roll).padStart(6)} pitch ${String(l.pitch).padStart(6)} yaw ${String(l.yaw).padStart(6)} thr ${String(l.thr).padStart(5)} clos ${String(l.closure).padStart(5)} open ${l.open} ang ${String(l.ang).padStart(6)} sc ${l.scale} curl ${l.curl.join(',')} ti ${l.ti} tuck ${l.tuck} tdy ${l.tdy} prom ${l.prom} g=${l.g}(${l.gp}) ${l.hand} ${l.conf}`); lastKey = key; }
}
await browser.close();
