// Headless smoke run of Pocket Metropolis: loads dist/index.html, gets past the start menu, starts a
// life, lets the town run at 3x, then opens the 3D town and the military base, on desktop and on a
// phone. It screenshots every stage, measures the 3D views against budgets.json and exits non-zero on
// any page or console error, a step that fails or times out, or a budget that is broken.
// Usage: node drive.mjs <outDir> [url] [budgets.json]
import { createRequire } from 'module';
import { mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Playwright is installed globally in the cloud container, not in this repo.
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || '.';
const url = process.argv[3] || 'http://localhost:8765/index.html';
const budgets = JSON.parse(readFileSync(process.argv[4] || join(here, 'budgets.json'), 'utf8'));
mkdirSync(out, { recursive: true });

const STEP_MS = 30000; // one step (a click, a view opening) may take this long
const errors = [];
const failures = [];
const results = [];

// A hard stop: nothing in here may hang forever and look like a pass.
const watchdog = setTimeout(() => {
  console.error('FAIL: the whole run timed out after 6 minutes');
  process.exit(2);
}, 6 * 60 * 1000);

const step = async (name, fn) => {
  try {
    await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${STEP_MS / 1000}s`)), STEP_MS))]);
    return true;
  } catch (e) {
    failures.push(`${name}: ${e.message.split('\n')[0]}`);
    return false;
  }
};

// Draw calls and triangles the renderer reports for one frame, and the median time to draw one.
// The container draws with software GL, so the time is only good for comparing runs here.
const measure = (page, which) =>
  page.evaluate((which) => {
    const pm = window.pocketMetropolis;
    const v = which === 'base' ? pm.militaryScreen.view : pm.view3d;
    const gl = v.gl;
    const camera = v.camera;
    const ctx = gl.getContext();
    const px = new Uint8Array(4);
    const once = () => {
      gl.render(v.scene, camera);
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    };
    for (let i = 0; i < 3; i++) once();
    const info = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    const times = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      once();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { ...info, ms: Math.round(times[4]) };
  }, which);

const check = (device, view, m) => {
  const b = budgets[view]?.[device];
  if (!b) return failures.push(`${device} ${view}: no budget set`);
  const row = { device, view, ...m, budget: `${b.calls} calls, ${b.triangles} tris, ${b.ms} ms` };
  if (m.calls > b.calls) failures.push(`${device} ${view}: ${m.calls} draw calls (budget ${b.calls})`);
  if (m.triangles > b.triangles) failures.push(`${device} ${view}: ${m.triangles} triangles (budget ${b.triangles})`);
  if (m.ms > b.ms) row.warn = `frame ${m.ms} ms over ${b.ms} ms (software GL: warning only)`;
  results.push(row);
};

async function run(device, options) {
  const page = await (await browser.newContext(options)).newPage();
  page.on('pageerror', (e) => errors.push(`${device}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${device}: ${m.text()}`));
  const shot = (name) => page.screenshot({ path: `${out}/${device}-${name}.png`, timeout: 120000 });
  const tag = (name) => `${device} ${name}`;

  // A new browser has no save: the start menu offers "Start playing", then the "Start a life" panel.
  if (!(await step(tag('load'), () => page.goto(url)))) return;
  if (!(await step(tag('start menu'), () => page.locator('[data-sm="continue"]').waitFor()))) return;
  await shot('1-menu');
  if (!(await step(tag('leave start menu'), () => page.locator('[data-sm="continue"]').click()))) return;
  if (!(await step(tag('start a life'), async () => {
    await page.getByText('Start a life').waitFor();
    await page.locator('text=Curious').click();
    await page.locator('text=Calm').click();
    await page.locator('button:visible', { hasText: 'Be born' }).click();
  }))) return;
  await page.waitForTimeout(1000);
  await shot('2-born');

  if (device === 'desktop') {
    // Speed button reads "1×" → "3×"; let the town grow for a bit.
    await step(tag('speed up'), () => page.locator('button:visible', { hasText: '1×' }).first().click());
    await page.waitForTimeout(20000);
    await shot('3-later');
  }

  // Close the Life panel as a player would: on a phone it covers the buttons in the top corner.
  await step(tag('close life panel'), () => page.locator('[aria-label="Close life panel"]').click());

  // The 3D town.
  if (await step(tag('open 3D town'), async () => {
    await page.click('#btn-3d');
    await page.waitForFunction(() => window.pocketMetropolis.view3d?.active);
  })) {
    await page.waitForTimeout(4000);
    await shot('4-town3d');
    await step(tag('measure 3D town'), async () => check(device, 'town3d', await measure(page, 'town')));
    await step(tag('close 3D town'), () => page.evaluate(() => window.pocketMetropolis.close3D()));
  }

  // The military base, with one of each defence so every model is drawn.
  if (await step(tag('open military base'), async () => {
    await page.evaluate(async () => {
      const pm = window.pocketMetropolis;
      const m = pm.warRoom.military;
      m.state.funds = Math.max(m.state.funds, 5000);
      for (const [type, x, y] of [['sandbags', 6, 11], ['mg', 5, 13], ['bunker', 11, 12], ['mortar', 10, 14]]) m.place(type, x, y);
      await pm.militaryScreen.show();
    });
    await page.waitForFunction(() => window.pocketMetropolis.militaryScreen.view?.getModel);
  })) {
    await page.waitForTimeout(4000);
    await shot('5-base');
    await step(tag('measure military base'), async () => check(device, 'base', await measure(page, 'base')));
  }
  await page.context().close();
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  await run('desktop', { viewport: { width: 1280, height: 800 } });
  await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
} finally {
  await browser.close();
  clearTimeout(watchdog);
}

for (const r of results) console.log(`${r.device.padEnd(7)} ${r.view.padEnd(6)} ${String(r.calls).padStart(4)} calls ${String(r.triangles).padStart(7)} tris ${String(r.ms).padStart(5)} ms   budget: ${r.budget}${r.warn ? `   WARN ${r.warn}` : ''}`);
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
if (failures.length) console.log(`failed:\n  ${failures.join('\n  ')}`);
const ok = !errors.length && !failures.length && results.length === 4;
if (ok) console.log('PASS: no page errors, every step ran, every budget held');
else if (!failures.length && !errors.length) console.log(`FAIL: only ${results.length} of 4 views measured`);
process.exit(ok ? 0 : 1);
