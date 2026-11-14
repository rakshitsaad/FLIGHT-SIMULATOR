// Screenshot helper: node tests/e2e/shot.mjs <out.png> [js to eval before the shot] [wait seconds]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out, script, wait] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 400)));
await page.goto(process.env.URL ?? 'http://localhost:5173/');
await page.waitForFunction(() => window.__skybound, null, { timeout: 30000 });
await page.waitForTimeout(3000);
if (script) console.log('eval:', JSON.stringify(await page.evaluate(script)));
await page.waitForTimeout(Number(wait ?? 5) * 1000);
await page.screenshot({ path: out });
console.log('perf', JSON.stringify(await page.evaluate(() => window.__skybound.perf ?? null)));
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
await browser.close();
