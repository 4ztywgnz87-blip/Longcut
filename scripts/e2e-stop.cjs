// Phone-sized check of the stop: add one, plan, see it on the results, export, remove it.
// Usage: node scripts/e2e-stop.cjs [url] [outDir]
const { chromium, devices } = require('playwright');
const fs = require('fs');

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const out = process.argv[3] || 'eval/out/stop';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
  });
  const ctx = await browser.newContext({ ...devices['iPhone 15'], geolocation: { latitude: 51.1934, longitude: 4.178 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = async (name) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log('shot', name);
  };
  const pick = async (field, query) => {
    await page.locator(field).click();
    await page.fill('#place-query', query);
    await page.waitForSelector('.place-main', { timeout: 15000 });
    await page.locator('.place-main').first().click();
    await page.waitForSelector('.edit-sheet');
  };

  await page.goto(url);
  await page.waitForSelector('.edit-sheet');
  await page.waitForFunction(() => document.querySelector('.field-value')?.textContent === 'Current location', null, { timeout: 15000 });
  await pick('button.field:has-text("Finish")', 'Temse');
  await shot('1-no-stop');
  await pick('.add-stop', 'Grote Markt Sint-Niklaas');
  await page.fill('#km', '25');
  await page.locator('#km').blur();
  await shot('2-with-stop');

  await page.getByRole('button', { name: /^Plan / }).click();
  await page.waitForSelector('.results-sheet', { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector('.tab.pending'), null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  console.log('tabs', (await page.locator('.tab').allTextContents()).join(' / '));
  for (let i = 0; i < (await page.locator('.tab').count()); i++) {
    await page.locator('.tab').nth(i).click();
    console.log(' route', i + 1, await page.locator('.stop-note').textContent());
  }
  await page.locator('.tab').first().click();
  await shot('3-results');

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.getByRole('button', { name: /Send to Garmin/ }).click()]);
  if (download) {
    await download.saveAs(`${out}/${download.suggestedFilename()}`);
    console.log('download', download.suggestedFilename());
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /Saved ·/ }).click();
  await shot('4-saved-list');
  await page.locator('.saved-list li').first().click();
  await shot('5-saved-route');

  await page.locator('.link-btn:has-text("Saved")').click();
  await page.getByRole('button', { name: /Back/ }).click();
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('button', { name: 'Remove stop' }).click();
  await page.waitForTimeout(400);
  console.log('stop rows after remove', await page.locator('.stop-row').count(), 'plus', await page.locator('.add-stop').count());
  await shot('6-removed');
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
