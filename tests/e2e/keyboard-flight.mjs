// Keyboard fallback: start a flight from the menu, take off, retract gear, switch cameras, open the weather panel, pause.
import fs from 'node:fs';
import { SHOTS, check, launch, state, summary, until } from './lib.mjs';
fs.mkdirSync(SHOTS, { recursive: true });
const { browser, page, errors } = await launch();

console.log('menu → FLY NOW');
await page.click('[data-menu="fly"]');
let s = await until(page, (s) => s.screen === 'flight' && !s.loading, 90, 'terrain loaded');
check('flight screen is active on the runway', s.screen === 'flight' && s.onGround && s.mode === 'flying', `alt ${s.alt} m, fps ${s.fps}`);
check('engine is off until throttle is added', s.engine === false);

console.log('take-off roll');
await page.keyboard.down('ShiftLeft');
s = await until(page, (s) => s.thr > 0.98, 60, 'full throttle');
await page.keyboard.up('ShiftLeft');
check('Shift raises the throttle to 100%', s.thr > 0.98);
s = await until(page, (s) => s.engine && s.ias > 31, 180, 'rotation speed');
check('engine started and the aircraft accelerated down the runway', s.engine && s.onGround, `IAS ${s.ias} m/s after ${s.t} s`);
const x0 = s.x;
await page.keyboard.down('KeyS');
s = await until(page, (s) => !s.onGround && s.agl > 30, 120, 'climb');
await page.keyboard.up('KeyS');
check('S (pull) rotates and the aircraft climbs away', s.agl > 30 && s.vs > 0, `AGL ${s.agl} m, VS ${s.vs} m/s, pitch ${s.pitch}°`);
check('it flew along the runway heading', s.x > x0 + 100 && Math.abs(s.hdg - 90) < 25, `heading ${s.hdg}`);
await page.screenshot({ path: `${SHOTS}/kb-climb.png` });

console.log('systems');
await page.keyboard.press('KeyG');
s = await until(page, (s) => s.gear < 0.05, 60, 'gear up');
check('G retracts the landing gear', !s.gearDown && s.gear < 0.05);
await page.keyboard.press('KeyF');
s = await state(page);
check('F extends flaps', s.flaps === 1);
await page.keyboard.press('KeyR');
await page.keyboard.down('KeyD');
s = await until(page, (s) => s.bank > 15, 60, 'bank right');
await page.keyboard.up('KeyD');
check('D banks right', s.bank > 15, `bank ${s.bank}°`);
await page.keyboard.down('KeyA');
s = await until(page, (s) => s.bank < 2, 60, 'roll back');
await page.keyboard.up('KeyA');
await page.keyboard.press('KeyZ');
s = await until(page, (s) => s.ap, 10, 'autopilot');
check('Z engages the autopilot', s.ap);

console.log('cameras');
for (const [key, mode] of [['Digit1', 'cockpit'], ['Digit4', 'instruments'], ['Digit3', 'cinematic'], ['Digit2', 'chase']]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(2500);
  s = await state(page);
  check(`camera → ${mode}`, s.camera === mode && s.mode === 'flying');
  await page.screenshot({ path: `${SHOTS}/kb-cam-${mode}.png` });
}
const before = (await state(page)).steps;
await page.waitForTimeout(1500);
check('simulation kept running through camera switches', (await state(page)).steps > before);

console.log('weather');
await page.keyboard.press('Tab');
s = await until(page, (s) => s.panel === 'weather', 10, 'weather panel');
await page.click('[data-preset="storm"]');
s = await until(page, (s) => s.wx.windSpeed > 12 && s.wx.rain > 0.6, 60, 'storm builds');
check('storm preset changes wind, rain and turbulence in the running sim', s.wx.preset === 'storm' && s.wx.turbulence > 0.5, `wind ${s.wx.windSpeed.toFixed(1)} m/s, rain ${s.wx.rain.toFixed(2)}`);
await page.screenshot({ path: `${SHOTS}/kb-storm.png` });
await page.click('[data-preset="clear"]');
await page.keyboard.press('Tab');

console.log('pause');
await page.keyboard.press('Escape');
s = await until(page, (s) => s.paused, 10, 'pause');
const frozen = s.steps;
await page.waitForTimeout(1500);
s = await state(page);
check('Esc pauses the simulation', s.paused && s.steps === frozen);
await page.screenshot({ path: `${SHOTS}/kb-paused.png` });
await page.keyboard.press('Escape');
s = await until(page, (s) => !s.paused, 10, 'resume');
check('Esc resumes', !s.paused);
check('no damage during the flight', s.dmg === 0, `damage ${s.dmg}`);

await browser.close();
process.exit(summary(errors) ? 0 : 1);
