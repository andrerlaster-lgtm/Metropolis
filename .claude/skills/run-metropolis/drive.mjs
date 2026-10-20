// Headless smoke run of Pocket Metropolis: loads dist/index.html, starts a life,
// lets the town run at 3x, and screenshots desktop + phone. Prints page errors.
// Usage: node drive.mjs <outDir> [url]
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

// Playwright is installed globally in the cloud container, not in this repo.
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const out = process.argv[2] || '.';
const url = process.argv[3] || 'http://localhost:8765/index.html';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
};

const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
watch(page, 'desktop');
await page.goto(url);
await page.getByText('Start a life').waitFor();
await page.screenshot({ path: `${out}/1-start.png` });

// First visit opens the "Start a life" panel: pick two traits and start.
await page.locator('text=Curious').click();
await page.locator('text=Calm').click();
await page.locator('button:visible', { hasText: 'Be born' }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/2-born.png` });

// Speed button reads "1×" → "3×"; let the town grow for a bit.
await page.locator('button:visible', { hasText: '1×' }).first().click();
await page.waitForTimeout(20000);
await page.screenshot({ path: `${out}/3-later.png` });

const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
watch(phone, 'mobile');
await phone.goto(url);
await phone.getByText('Start a life').waitFor();
await phone.screenshot({ path: `${out}/4-mobile.png` });

await browser.close();
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
process.exit(errors.length ? 1 : 0);
