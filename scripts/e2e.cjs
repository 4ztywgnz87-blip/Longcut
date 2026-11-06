// End-to-end check of the app in a phone-sized browser.
// Usage: node scripts/e2e.cjs [url] [outDir]   (app must be served, e.g. `npx vite preview`)
const { chromium, devices } = require('playwright');
const fs = require('fs');

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || 'eval/out/e2e';
fs.mkdirSync(out, { recursive: true });
const NIEUWKERKEN = { latitude: 51.1934, longitude: 4.178 };

(async () => {
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
  });
  const ctx = await browser.newContext({
    ...devices['iPhone 15'],
    geolocation: NIEUWKERKEN,
    permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (name) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log('shot', name);
  };
  const step = (s) => console.log('step:', s);

  await page.goto(url);
  await page.waitForSelector('.edit-sheet');
  await page.waitForFunction(() => document.querySelector('.field-value')?.textContent === 'Current location', null, { timeout: 15000 });
  await shot('1-start');

  step('search finish');
  await page.getByRole('button', { name: /Finish/ }).click();
  await page.fill('#place-query', 'Grote Markt Sint-Niklaas');
  await page.waitForSelector('.place-main', { timeout: 15000 });
  await shot('2-search');
  await page.locator('.place-main').first().click();

  step('distance 15 km');
  await page.fill('#km', '15');
  await page.locator('#km').blur();
  await shot('3-filled');

  step('plan');
  const t0 = Date.now();
  await page.getByRole('button', { name: /^Plan / }).click();
  await page.waitForSelector('.planning-sheet');
  await shot('4-planning');
  await page.waitForSelector('.results-sheet', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('.tab.pending'), null, { timeout: 90000 }); // all routes in
  console.log('plan seconds', ((Date.now() - t0) / 1000).toFixed(1));
  await page.waitForTimeout(1200);
  const km = await page.locator('.big-km b').textContent();
  const tabs = await page.locator('.tab').allTextContents();
  console.log('result km', km, 'tabs', tabs.join(' / '));
  await shot('5-results');

  step('second route');
  if (tabs.length > 1) {
    await page.locator('.tab').nth(1).click();
    await shot('6-alt');
  }

  step('export gpx');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.getByRole('button', { name: /Send to Garmin/ }).click(),
  ]);
  if (download) {
    const p = `${out}/${download.suggestedFilename()}`;
    await download.saveAs(p);
    console.log('download', download.suggestedFilename(), fs.statSync(p).size, 'bytes');
  } else console.log('gpx: no download (share sheet path?)');

  step('recent searches');
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('button', { name: /Finish/ }).click();
  console.log('recent:', (await page.locator('.list-title').allTextContents()).join(', '), '|', (await page.locator('.place-name').allTextContents()).slice(0, 3).join(', '));
  await shot('6c-recent');
  await page.locator('.place-main').first().click();
  await page.getByRole('button', { name: /^Plan / }).click();
  await page.waitForSelector('.results-sheet', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('.tab.pending'), null, { timeout: 90000 }); // all routes in

  step('save');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByRole('button', { name: /Saved ·/ }).click();
  await shot('7-saved');

  step('too short');
  await page.getByRole('button', { name: /Back/ }).click();
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.fill('#km', '3');
  await page.locator('#km').blur();
  await page.getByRole('button', { name: /^Plan / }).click();
  await page.waitForSelector('.problem', { timeout: 30000 });
  console.log('problem:', (await page.locator('.problem').textContent()).trim());
  await shot('8-too-short');

  step('loop 10 km');
  await page.getByRole('button', { name: /Loop/ }).click();
  await page.fill('#km', '10');
  await page.locator('#km').blur();
  await page.getByRole('button', { name: /^Plan / }).click();
  await page.waitForSelector('.results-sheet', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('.tab.pending'), null, { timeout: 90000 }); // all routes in
  console.log('loop km', await page.locator('.big-km b').textContent());
  await shot('9-loop');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
