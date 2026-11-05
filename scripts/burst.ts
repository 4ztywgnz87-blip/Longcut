// Plans several routes back to back with the app's router settings, to see how the
// public BRouter server copes. Usage: npx tsx scripts/burst.ts
import { readFile } from 'node:fs/promises';
import { BRouterRouter } from '../src/core/brouter';
import { planRoutes } from '../src/core/planner';
import type { LngLat } from '../src/core/geo';

const home: LngLat = [4.178, 51.1934];
const trips: [LngLat, number, number][] = [
  [[4.1392, 51.1642], 15, 0],
  [[4.1392, 51.1642], 15, 1],
  [[4.1392, 51.1642], 21, 0],
  [home, 10, 0],
  [home, 10, 1],
];
const router = new BRouterRouter({ profileText: await readFile('brouter/longcut-run.brf', 'utf8'), maxConcurrent: 4, minIntervalMs: 120 });
for (const [end, km, variation] of trips) {
  const before = router.requestCount;
  const t0 = Date.now();
  try {
    const r = await planRoutes({ start: home, end, distanceKm: km, prefs: { unpavedOk: false, preferGreen: false }, variation }, router);
    console.log(`${km} km v${variation}: ${r.ok ? r.routes.map((x) => (x.stats.length / 1000).toFixed(2)).join('/') : r.reason} · ${router.requestCount - before} requests · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    console.log(`${km} km v${variation}: ERROR ${(e as Error).message.slice(0, 80)} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
