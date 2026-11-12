// Debug trace of one trip: every try of every template, using the cached answers of
// scripts/quality.ts where possible.
// Usage: npx tsx scripts/trace.ts <lon,lat> <lon,lat> <km> [repoDir] [stop lon,lat]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE = '.cache/routes';
const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const cache = {
  async get(k: string) {
    try {
      return JSON.parse(await readFile(`${CACHE}/${hash(k)}.json`, 'utf8'));
    } catch {
      return undefined;
    }
  },
  async set(k: string, v: unknown) {
    await mkdir(CACHE, { recursive: true });
    await writeFile(`${CACHE}/${hash(k)}.json`, JSON.stringify(v));
  },
};
const [a, b, km, dir = '.', stop] = process.argv.slice(2);
const pt = (s: string) => s.split(',').map(Number) as [number, number];
(globalThis as { LONGCUT_DEBUG?: boolean }).LONGCUT_DEBUG = true;
const { BRouterRouter } = await import(path.resolve(dir, 'src/core/brouter.ts'));
const { planRoutes } = await import(path.resolve(dir, 'src/core/planner.ts'));
const router = new BRouterRouter({ profileText: await readFile(path.resolve(dir, 'brouter/longcut-run.brf'), 'utf8'), cache, maxConcurrent: 2, minIntervalMs: 500 });
const t0 = Date.now();
const r = await planRoutes({ start: pt(a), end: pt(b), ...(stop ? { stop: pt(stop) } : {}), distanceKm: +km, prefs: { unpavedOk: false, preferGreen: false }, onProgress: () => {} }, router);
console.log(
  r.ok
    ? r.routes.map((x: { stats: { length: number; busyShare: number; overlapShare: number }; score: number; label: string; extraM?: number; stopM?: number }) => `${(x.stats.length / 1000).toFixed(2)}${x.extraM ? '*' : ''}${x.stopM != null ? ` stop@${(x.stopM / 1000).toFixed(1)}` : ''} s${x.score.toFixed(2)} busy ${(x.stats.busyShare * 100).toFixed(0)}% twice ${(x.stats.overlapShare * 100).toFixed(0)}% [${x.label}]`).join('\n')
    : r.reason,
  `\n${router.requestCount} new requests · ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
