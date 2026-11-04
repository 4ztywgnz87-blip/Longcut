// Runs the planner on real trips and writes the results to eval/out/results.json.
// Usage: ORS_KEY=... npx tsx scripts/eval.ts [filter]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { OrsRouter } from '../src/core/ors';
import type { ResponseCache } from '../src/core/ors';
import { planRoutes } from '../src/core/planner';
import type { LngLat } from '../src/core/geo';
import type { RouteOptions } from '../src/core/types';

const HOME = 'Nieuwkerken-Waas';
// [start, end, km]. Same start and end = loop.
const CASES: [string, string, number][] = [
  [HOME, 'Grote Markt, Sint-Niklaas', 8],
  [HOME, 'Grote Markt, Sint-Niklaas', 12],
  [HOME, 'Grote Markt, Sint-Niklaas', 15],
  [HOME, 'Grote Markt, Sint-Niklaas', 21],
  [HOME, 'Grote Markt, Sint-Niklaas', 4], // impossible: too short
  [HOME, 'Kemzeke', 10],
  [HOME, 'Beveren-Waas', 15],
  [HOME, 'Beveren-Waas', 25],
  [HOME, 'Stekene', 18],
  [HOME, 'Temse', 20],
  [HOME, 'Lokeren', 25],
  [HOME, 'Lokeren', 32],
  [HOME, 'Sint-Gillis-Waas', 16],
  [HOME, 'Linkeroever, Antwerpen', 30],
  [HOME, 'Antwerpen-Centraal', 40],
  [HOME, 'Gent-Sint-Pieters', 60],
  [HOME, 'Brugge', 100],
  [HOME, HOME, 10],
  [HOME, HOME, 21],
  [HOME, HOME, 32],
  ['Antwerpen-Centraal', 'Museum aan de Stroom', 12],
  ['Antwerpen-Centraal', 'Wilrijk', 15],
  ['Antwerpen-Centraal', 'Antwerpen-Centraal', 15],
  ['Gent-Sint-Pieters', 'Korenmarkt, Gent', 10],
  ['Gent-Sint-Pieters', 'Gentbrugge', 16],
  ['Gent-Sint-Pieters', 'Lochristi', 22],
  ['Korenmarkt, Gent', 'Korenmarkt, Gent', 12],
  ['Grote Markt, Sint-Niklaas', 'Grote Markt, Sint-Niklaas', 50],
  ['Lokeren', 'Gent-Sint-Pieters', 35],
  ['Temse', 'Sint-Niklaas', 9],
];

const OUT = 'eval/out';
const CACHE_DIR = '.cache/ors';

const diskCache: ResponseCache = {
  async get(key) {
    try {
      return JSON.parse(await readFile(`${CACHE_DIR}/${hash(key)}.json`, 'utf8'));
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(`${CACHE_DIR}/${hash(key)}.json`, JSON.stringify(value));
  },
};
const hash = (s: string) => createHash('sha1').update(s).digest('hex');

const geoCache = new Map<string, LngLat>();
async function geocode(q: string): Promise<LngLat> {
  if (geoCache.has(q)) return geoCache.get(q)!;
  const file = `${CACHE_DIR}/geo-${hash(q)}.json`;
  try {
    const p = JSON.parse(await readFile(file, 'utf8')) as LngLat;
    geoCache.set(q, p);
    return p;
  } catch {
    /* not cached yet */
  }
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lat=51.19&lon=4.18&bbox=2.5,49.5,6.4,51.5`;
  const j = (await (await fetch(url)).json()) as { features: { geometry: { coordinates: LngLat } }[] };
  if (!j.features.length) throw new Error(`Not found: ${q}`);
  const p = j.features[0].geometry.coordinates;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(p));
  geoCache.set(q, p);
  return p;
}

async function main() {
  (globalThis as { LONGCUT_DEBUG?: boolean }).LONGCUT_DEBUG = !!process.env.LONGCUT_DEBUG;
  const key = process.env.ORS_KEY;
  if (!key) throw new Error('Set ORS_KEY');
  const filter = process.argv[2];
  const profile = (process.env.PROFILE ?? 'foot-walking') as RouteOptions['profile'];
  const router = new OrsRouter({ apiKey: key, cache: diskCache });
  await mkdir(OUT, { recursive: true });

  const cases = CASES.map(([from, to, km], i) => ({ id: i + 1, from, to, km })).filter(
    (c) => !filter || `${c.id} ${c.from} ${c.to}`.toLowerCase().includes(filter.toLowerCase()),
  );

  const results = [];
  for (const c of cases) {
    const start = await geocode(c.from);
    const end = await geocode(c.to);
    const before = router.requestCount;
    const t0 = Date.now();
    const result = await planRoutes({ start, end, distanceKm: c.km, prefs: { unpavedOk: false } }, router, { profile });
    const seconds = (Date.now() - t0) / 1000;
    const requests = router.requestCount - before;
    results.push({ ...c, start, end, profile, seconds, requests, result });

    const line = result.ok
      ? result.routes
          .map((r) => `${(r.stats.length / 1000).toFixed(2)}km ${(r.deviation * 100).toFixed(1)}% ov${(r.stats.overlapShare * 100).toFixed(0)}% busy${(r.stats.busyShare * 100).toFixed(0)}% [${r.label}]`)
          .join(' | ')
      : `${result.reason} ${'shortestKm' in result ? result.shortestKm.toFixed(2) + 'km' : result.message}`;
    console.log(`#${c.id} ${c.from} → ${c.to} ${c.km}km (${requests} req, ${seconds.toFixed(1)}s): ${line}`);
  }
  const file = `${OUT}/results${filter ? '-partial' : ''}.json`;
  await writeFile(file, JSON.stringify(results));
  console.log(`Wrote ${file}. Requests sent: ${router.requestCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
