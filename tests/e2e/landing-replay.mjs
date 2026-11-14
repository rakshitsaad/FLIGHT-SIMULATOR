// Final approach → touchdown on Aerona International 09 → graded landing card → replay → flight history.
// The approach is flown by a small closed-loop pilot that writes the same FlightInput the
// keyboard/hand router would (the landing physics itself is covered by the unit tests).
import fs from 'node:fs';
import { SHOTS, check, launch, state, summary, until } from './lib.mjs';
fs.mkdirSync(SHOTS, { recursive: true });
const { browser, page, errors } = await launch({ width: 960, height: 600 });

await page.evaluate(() => window.__skybound.startFlight({ spawnId: 'air-final' }));
await until(page, (s) => s.screen === 'flight', 30, 'flight');
await page.evaluate(() => {
  const k = window.__skybound;
  const sim = k.sim;
  const DEG = Math.PI / 180;
  const cl = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
  const inp = { pitch: 0, roll: 0, yaw: 0, throttle: 0.4, brake: 0, source: 'keyboard' };
  let touched = false;
  sim.command('flapsDown');
  sim.command('flapsDown');
  sim.inputSource = () => {
    const s = sim.state;
    if (s.onGround) touched = true;
    const a = { x: 5200, z: -700, elev: 9, len: 3200 };
    const thrX = a.x - a.len / 2 + 250;
    const cross = s.position.z - a.z;
    const hdgT = 90 - cl(cross * 0.12, -30, 30);
    const err = ((hdgT - s.heading + 540) % 360) - 180;
    inp.roll = cl((cl(err * 1.5, -20, 20) * DEG - s.bank) * 2.5 + s.angularVelocity.z * 0.5);
    const agl = s.altitude - a.elev;
    const pathAlt = Math.max(0, thrX - s.position.x) * Math.tan(3 * DEG);
    const vsT = touched ? -0.3 : agl < 2.5 ? -0.5 : agl < 8 ? -1.2 : cl((pathAlt - agl) * 0.3 - 2.2, -5, 1);
    inp.pitch = touched ? -0.05 : cl((vsT - s.verticalSpeed) * 0.2 - s.angularVelocity.x * 0.8, -0.5, 0.8);
    inp.throttle = touched || agl < 4 ? 0 : cl(0.3 + (31 - s.indicatedAirspeed) * 0.12, 0, 1);
    inp.brake = touched && s.wheelsOnGround >= 2 ? 1 : 0;
    inp.yaw = touched ? cl((((90 - s.heading + 540) % 360) - 180) * 0.15) : 0;
    return inp;
  };
});
let s = await until(page, (s) => s.landing || s.crash, 600, 'landing');
check('touched down and came to a stop on the runway', !!s.landing && !s.crash, s.landing ? s.landing.summary : s.crash);
check('landing graded from real touchdown data', s.landing && s.landing.airport === 'Aerona International' && s.landing.runway === '09' && s.landing.total > 50, s.landing && `${s.landing.grade} ${s.landing.total}/100, sink ${s.landing.verticalSpeed.toFixed(2)} m/s, ${s.landing.touchdownSpeed.toFixed(1)} m/s`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/landing-card.png` });

await page.getByRole('button', { name: 'REPLAY FLIGHT' }).click();
s = await until(page, (s) => s.screen === 'replay' && s.mode === 'replay', 30, 'replay');
check('replay opened', true);
const p0 = await page.evaluate(() => ({ t: window.__skybound.sim.replay.time, d: window.__skybound.sim.replay.duration, n: window.__skybound.sim.replay.record.frames.length }));
await page.waitForTimeout(3000);
const p1 = await page.evaluate(() => window.__skybound.sim.replay.time);
check('replay plays back recorded frames', p1 > p0.t + 1, `${p0.n} frames, ${p0.d.toFixed(0)} s recorded`);
await page.click('[data-cam="cinematic"]');
await page.waitForTimeout(1500);
check('replay camera can be switched', (await state(page)).camera === 'cinematic');
await page.click('.replay-chart', { position: { x: 300, y: 50 } });
const seek = await page.evaluate(() => window.__skybound.sim.replay.time);
check('speed/altitude chart seeks the replay', Math.abs(seek - p1) > 1, `t=${seek.toFixed(1)}`);
await page.click('[data-cam="chase"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/replay.png` });
await page.getByRole('button', { name: /SAVE FLIGHT/ }).click();
await page.getByRole('button', { name: 'EXIT REPLAY' }).click();
s = await until(page, (s) => s.screen === 'history', 20, 'history');
await page.waitForSelector('.history-row');
const rows = await page.$$eval('.history-row', (r) => r.map((x) => x.textContent));
check('flight appears in FLIGHT HISTORY with its landing grade and star', rows.length > 0 && /Landing [SABCD]/.test(rows[0]) && rows[0].includes('★'), rows[0]?.slice(0, 120));
await page.screenshot({ path: `${SHOTS}/history.png` });
await browser.close();
process.exit(summary(errors) ? 0 : 1);
