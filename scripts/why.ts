// Shows every candidate the planner tried for one trip and why it was kept or dropped.
// Usage: npx tsx scripts/why.ts
import { readFile } from 'node:fs/promises';
import { BRouterRouter } from '../src/core/brouter';
import { planRoutes } from '../src/core/planner';
import type { LngLat } from '../src/core/geo';

(globalThis as { LONGCUT_DEBUG?: boolean }).LONGCUT_DEBUG = true;
const home: LngLat = [4.178, 51.1934];
const markt: LngLat = [4.1392, 51.1642];
const router = new BRouterRouter({ profileText: await readFile('brouter/longcut-run.brf', 'utf8'), maxConcurrent: 3, minIntervalMs: 150 });
for (const km of [17, 17]) {
  const t0 = Date.now();
  const r = await planRoutes({ start: home, end: markt, distanceKm: km, prefs: { unpavedOk: false, preferGreen: false } }, router);
  console.log(`=> ${km} km: ${r.ok ? r.routes.map((x) => `${(x.stats.length / 1000).toFixed(2)} [${x.label}]`).join(' / ') : r.reason} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
