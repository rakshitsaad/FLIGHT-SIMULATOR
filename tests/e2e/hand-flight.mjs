// One-hand flight, end to end, through the REAL pipeline:
//   fake webcam (real hand photographs, see make-hand-clip.py) → MediaPipe Hand Landmarker
//   → SingleHandFlightController → ControlRouter → flight model.
// usage: node tests/e2e/hand-flight.mjs <mission.mjpeg>
import fs from 'node:fs';
import { SHOTS, check, launch, state, summary } from './lib.mjs';

const clip = process.argv[2];
// clip timeline (seconds from camera start), see make-hand-clip.py
const B = 180; // phase B: the flight
const at = (x) => B + x;
if (!clip || !fs.existsSync(clip)) throw new Error('pass the clip made by make-hand-clip.py');
fs.mkdirSync(SHOTS, { recursive: true });
const { browser, page, errors } = await launch({ video: clip, width: 960, height: 600 });
await page.evaluate(() => {
  const k = window.__skybound;
  k.settings.getState().set({ visionDelegate: 'CPU', handControl: false });
  window.__cmds = [];
  k.controls.onCommand = (c, src) => window.__cmds.push({ c, src, t: +k.sim.state.time.toFixed(1), screen: k.app.getState().screen });
});
const clipT = () => page.evaluate(() => (window.__skybound.vision.camera.startedAt ? (performance.now() - window.__skybound.vision.camera.startedAt) / 1000 : -1));
const vis = () =>
  page.evaluate(() => {
    const v = window.__skybound.vision;
    const s = v.controller.snapshot;
    return { status: s.status, running: v.status.running, fps: v.status.fps, backend: v.status.backend, calibrated: v.status.calibrated, roll: s.roll, pitch: s.pitch, yaw: s.yaw, throttle: s.throttle, closure: s.closure, gesture: s.gesture.active, hand: s.landmarks?.handedness ?? null };
  });
const heading = () => page.evaluate(() => document.querySelector('.ac-card-head h3')?.textContent ?? '');

console.log('AIR CONTROL: camera + hand detection');
await page.click('[data-menu="aircontrol"]');
await page.getByRole('button', { name: 'ENABLE CAMERA' }).click();
let v;
for (let i = 0; i < 120; i++) {
  v = await vis();
  if (v.status === 'tracking') break;
  await page.waitForTimeout(500);
}
check('webcam permission granted and MediaPipe running', v.running, `${v.backend}, ${v.fps} fps`);
check('exactly one hand detected and tracked', v.status === 'tracking', `hand ${v.hand}`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/hand-aircontrol.png` });

console.log('calibration wizard (driven only by the hand in the video)');
await page.getByRole('button', { name: 'START CALIBRATION' }).click();
const seen = new Set();
let done = false;
while ((await clipT()) < at(-2)) {
  const h = await heading();
  if (!seen.has(h)) {
    seen.add(h);
    console.log(`   ${(await clipT()).toFixed(0).padStart(4)} s  ${h}`);
  }
  if (h.includes('Gesture check')) {
    // the clip has no pinch photo: the gesture step is optional and skippable
    await page.getByRole('button', { name: 'SKIP STEP' }).click();
  }
  if (h.includes('ready')) {
    done = true;
    break;
  }
  await page.waitForTimeout(400);
}
const cal = await page.evaluate(() => ({ ...window.__skybound.vision.controller.calibration, calibrated: window.__skybound.vision.controller.calibrated }));
check('calibration completed: neutral, roll, pitch, wrist, open hand and fist measured', done && cal.calibrated);
check('calibrated ranges come from the observed hand movement', cal.rollLeft > 0.12 && cal.rollRight > 0.12 && cal.pitchUp > 0.09 && cal.pitchDown > 0.09 && cal.wristCw > 0.25 && cal.wristCcw > 0.25 && cal.opennessOpen - cal.opennessFist > 0.5, `roll ${cal.rollLeft.toFixed(2)}/${cal.rollRight.toFixed(2)} pitch ${cal.pitchUp.toFixed(2)}/${cal.pitchDown.toFixed(2)} wrist ${cal.wristCcw.toFixed(2)}/${cal.wristCw.toFixed(2)} open ${cal.opennessOpen.toFixed(2)} fist ${cal.opennessFist.toFixed(2)}`);
const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('skybound'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('calibration'); q.onsuccess = () => res(!!q.result); q.onerror = () => res(false); }; r.onerror = () => res(false); }));
check('calibration saved to IndexedDB', stored);
await page.screenshot({ path: `${SHOTS}/hand-calibrated.png` });

// wait for the flight part of the clip (open hand at 144 s)
while ((await clipT()) < at(1)) await page.waitForTimeout(300);
console.log('SAVE & FLY — hand control only from here on');
await page.getByRole('button', { name: 'SAVE & FLY' }).click();

const obs = { brakeHeld: false, maxThr: 0, handThrottleFull: false, engine: false, liftoff: false, maxAgl: 0, rollIn: 0, maxBank: 0, hdg0: null, hdgAfterTurn: null, ap: false, flapsChanged: false, lost: false, lostMaxInput: 1, lostSamples: 0, paused: false, resumed: false, sources: new Set(), damage: 0, destroyed: false };
let shots = { climb: false, lost: false, pause: false };
const startFlaps = 0;
while (true) {
  const t = await clipT();
  if (t > at(162)) break;
  const s = await state(page);
  const h = await vis();
  obs.sources.add(s.input.source);
  if (t > at(1) && t < at(6) && s.onGround && s.input.brake > 0.5 && s.input.throttle < 0.05) obs.brakeHeld = true;
  obs.maxThr = Math.max(obs.maxThr, s.input.throttle);
  if (s.input.source === 'hand' && s.input.throttle > 0.95) obs.handThrottleFull = true;
  if (s.engine) obs.engine = true;
  if (!s.onGround && s.agl > 5) obs.liftoff = true;
  obs.maxAgl = Math.max(obs.maxAgl, s.agl);
  if (t > at(75) && t < at(84)) {
    obs.rollIn = Math.max(obs.rollIn, s.input.roll);
    obs.maxBank = Math.max(obs.maxBank, s.bank);
    if (obs.hdg0 === null) obs.hdg0 = s.hdg;
  }
  if (t > at(86) && t < at(94)) obs.hdgAfterTurn = s.hdg;
  if (s.ap) obs.ap = true;
  if (s.flaps !== startFlaps) obs.flapsChanged = true;
  if (t > at(114) && t < at(117.5) && h.status === 'lost') {
    obs.lost = true;
    obs.lostSamples++;
    if (t > at(115)) obs.lostMaxInput = Math.min(obs.lostMaxInput, Math.max(Math.abs(h.roll), Math.abs(h.pitch), Math.abs(h.yaw)));
  }
  if (s.paused) obs.paused = true;
  if (obs.paused && !s.paused && t > at(148)) obs.resumed = true;
  obs.damage = Math.max(obs.damage, s.dmg);
  if (s.mode === 'crashed') obs.destroyed = true;
  if (!shots.climb && s.agl > 40) {
    shots.climb = true;
    await page.screenshot({ path: `${SHOTS}/hand-climb.png` });
    console.log(`   ${t.toFixed(0)} s  climbing by hand: AGL ${s.agl} m, IAS ${s.ias} m/s, throttle ${s.input.throttle.toFixed(2)}, pitch input ${s.input.pitch.toFixed(2)}`);
  }
  if (!shots.lost && h.status === 'lost' && t > at(114)) {
    shots.lost = true;
    await page.screenshot({ path: `${SHOTS}/hand-lost.png` });
  }
  if (!shots.pause && s.paused) {
    shots.pause = true;
    await page.screenshot({ path: `${SHOTS}/hand-paused.png` });
  }
  await page.waitForTimeout(250);
}
const cmds = await page.evaluate(() => window.__cmds);
console.log('   gesture commands:', cmds.filter((c) => c.src === 'hand').map((c) => `${c.c}@${c.screen}`).join(', '));
const flightCmds = cmds.filter((c) => c.src === 'hand' && c.screen === 'flight').map((c) => c.c);

console.log('results');
check('open hand on the runway = idle throttle with wheel brakes held', obs.brakeHeld);
check('closing the hand drove the throttle to full', obs.handThrottleFull, `max ${obs.maxThr.toFixed(2)}`);
check('engine started from hand throttle', obs.engine);
check('took off and climbed under hand control', obs.liftoff && obs.maxAgl > 40, `max AGL ${obs.maxAgl.toFixed(0)} m`);
check('moving the hand right banked the aircraft right', obs.rollIn > 0.3 && obs.maxBank > 8, `roll input ${obs.rollIn.toFixed(2)}, bank ${obs.maxBank.toFixed(0)}°`);
check('…and it turned', obs.hdg0 !== null && obs.hdgAfterTurn !== null && ((obs.hdgAfterTurn - obs.hdg0 + 360) % 360) > 5 && ((obs.hdgAfterTurn - obs.hdg0 + 360) % 360) < 180, `${obs.hdg0} → ${obs.hdgAfterTurn}`);
check('thumbs-up gesture engaged the autopilot', flightCmds.includes('toggleAutopilot') && obs.ap);
check('victory gesture changed the flaps', flightCmds.includes('cycleFlaps') && obs.flapsChanged);
check('hand leaving the camera was detected as lost', obs.lost);
check('controls returned to neutral while the hand was gone', obs.lostSamples > 0 && obs.lostMaxInput < 0.05, `|input| ${obs.lostMaxInput.toFixed(3)}`);
check('tight-fist hold paused the simulator', flightCmds.includes('pause') && obs.paused);
check('a second fist hold resumed it', obs.resumed);
check('no gesture fired while flying at full throttle with fingers closed', !cmds.some((c) => c.src === 'hand' && c.screen === 'flight' && c.c === 'pause' && c.t < 30));
check('aircraft intact', !obs.destroyed, `damage ${obs.damage}`);
check('input source was the hand', obs.sources.has('hand'), [...obs.sources].join(','));
await browser.close();
process.exit(summary(errors) ? 0 : 1);
