// Renders one map image per test trip from eval/out/results.json into eval/out/img/.
// Usage: npx tsx scripts/screenshots.ts   (serves the repo on :8765 while running)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

interface Result {
  id: number;
  start: [number, number];
  end: [number, number];
  result: { ok: boolean; routes?: { coords: [number, number][]; roads: string[] }[] };
}

async function main() {
  const results = JSON.parse(await readFile(process.argv[2] ?? 'eval/out/results.json', 'utf8')) as Result[];
  await mkdir('eval/out/img', { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1.5 });
    await page.goto('http://127.0.0.1:8765/eval/render.html');
    await page.waitForFunction(() => (window as unknown as { mapReady?: boolean }).mapReady, null, { timeout: 30000 });
    for (const r of results) {
      const routes = r.result.ok ? r.result.routes ?? [] : [];
      await page.evaluate(
        ([routes, s, e]: unknown[]) => (window as unknown as { show: (...a: unknown[]) => Promise<void> }).show(routes, s, e),
        [routes, r.start, r.end],
      );
      await page.waitForTimeout(300);
      await page.screenshot({ path: `eval/out/img/${r.id}.jpg`, type: 'jpeg', quality: 78 });
      console.log(`image ${r.id}`);
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
