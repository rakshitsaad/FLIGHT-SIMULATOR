// Shared helpers for the browser tests (Playwright + Chromium, software GL in CI).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

export const URL = process.env.URL ?? 'http://localhost:5173/';
export const SHOTS = process.env.SHOTS ?? '/tmp/skybound-shots';

export async function launch({ video, width = 640, height = 400 } = {}) {
  const args = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (video) args.push(`--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  await page.goto(URL);
  await page.waitForFunction(() => window.__skybound && window.__skybound.world.current, null, { timeout: 60000 });
  await page.evaluate(() => window.__skybound.settings.getState().set({ graphics: 'low', firstRunDone: true }));
  await page.waitForTimeout(1500);
  return { browser, page, errors };
}

export const state = (page) =>
  page.evaluate(() => {
    const k = window.__skybound;
    const s = k.sim.state;
    const a = k.app.getState();
    return {
      screen: a.screen, paused: a.paused, loading: a.loading, camera: a.camera, landing: a.landing, crash: a.crash, panel: a.panel,
      mode: k.sim.mode, t: +s.time.toFixed(1), ias: +s.indicatedAirspeed.toFixed(1), alt: +s.altitude.toFixed(1), agl: +s.altitudeAgl.toFixed(1), vs: +s.verticalSpeed.toFixed(1),
      hdg: +s.heading.toFixed(1), pitch: +((s.pitch * 180) / Math.PI).toFixed(1), bank: +((s.bank * 180) / Math.PI).toFixed(1), thr: +s.throttle.toFixed(2), power: +s.enginePower.toFixed(2),
      gear: +s.gear.toFixed(2), gearDown: s.gearDown, flaps: s.flapsNotch, onGround: s.onGround, ap: s.autopilot, engine: s.engineRunning, dmg: +s.damage.toFixed(2), brake: s.brake,
      x: Math.round(s.position.x), z: Math.round(s.position.z), elev: +s.elevator.toFixed(2), ail: +s.aileron.toFixed(2), rud: +s.rudder.toFixed(2),
      input: { ...k.controls.current }, fps: +k.perf.fps.toFixed(1), steps: k.sim.steps,
      wx: { ...k.sim.weather.state }, region: k.sim.region,
    };
  });

/** Poll until fn(state) is truthy; returns the state or throws on timeout. */
export async function until(page, fn, seconds, label = 'condition') {
  const end = Date.now() + seconds * 1000;
  let s;
  while (Date.now() < end) {
    s = await state(page);
    if (fn(s)) return s;
    await page.waitForTimeout(250);
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s)}`);
}

let pass = 0;
let fail = 0;
export function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
}
export function summary(errors = []) {
  const uniq = [...new Set(errors)].filter((e) => !/XNNPACK|OpenGL error checking|NORM_RECT|GPU stall|WebGL: INVALID|Automatic fallback to software|GL Driver Message/i.test(e));
  if (uniq.length) console.log('console errors:\n   ' + uniq.join('\n   '));
  console.log(`\n${pass} passed, ${fail} failed, ${uniq.length} console error(s)`);
  return fail === 0 && uniq.length === 0;
}
