// Route quality check: plans 19 real trips and saves the results, so two versions of the
// planner can be compared (busy roads, run twice, unpaved, noise, padded, score, requests).
//
//   npx tsx scripts/quality.ts <label> [repoDir]      → eval/out/quality-<label>.json
//   npx tsx scripts/quality.ts compare <labelA> <labelB>
//
// To compare with an older version: `git worktree add ../old <commit>` and run with
// repoDir=../old. Responses are cached in .cache/routes, so a second run is cheap.
// Run-to-run variance exists (the request budget is shared in the order the server answers):
// repeat a trip a few times before calling a difference real. Be gentle with brouter.de.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE = '.cache/routes';
const OUT = 'eval/out';
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

/** Fixed coordinates for the test trips, so the check doesn't depend on a search service. */
const COORDS: Record<string, [number, number]> = {
  'Nieuwkerken-Waas': [4.178, 51.1934], 'Grote Markt, Sint-Niklaas': [4.1393, 51.1642], Kemzeke: [4.0784, 51.2071],
  'Beveren-Waas': [4.2573, 51.2137], Stekene: [4.0365, 51.2095], Temse: [4.2135, 51.1265], Lokeren: [3.9905, 51.1045],
  'Sint-Gillis-Waas': [4.1235, 51.2195], 'Linkeroever, Antwerpen': [4.3745, 51.2245], 'Antwerpen-Centraal': [4.4211, 51.2172],
  Wilrijk: [4.3945, 51.1685], 'Gent-Sint-Pieters': [3.7105, 51.0362], Lochristi: [3.832, 51.0985], 'Korenmarkt, Gent': [3.7219, 51.0549],
};

async function geo(q: string): Promise<[number, number]> {
  if (COORDS[q]) return COORDS[q];
  const f = `${CACHE}/geo-${hash(q)}.json`;
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    /* not cached */
  }
  const j = (await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lat=51.19&lon=4.18&bbox=2.5,49.5,6.4,51.5`)).json()) as {
    features: { geometry: { coordinates: [number, number] } }[];
  };
  const p = j.features[0].geometry.coordinates;
  await mkdir(CACHE, { recursive: true });
  await writeFile(f, JSON.stringify(p));
  return p;
}

const HOME = 'Nieuwkerken-Waas';
const TRIPS: [string, string, number][] = [
  [HOME, 'Grote Markt, Sint-Niklaas', 8], [HOME, 'Grote Markt, Sint-Niklaas', 15], [HOME, 'Grote Markt, Sint-Niklaas', 21],
  [HOME, 'Kemzeke', 10], [HOME, 'Beveren-Waas', 15], [HOME, 'Beveren-Waas', 25], [HOME, 'Stekene', 18], [HOME, 'Temse', 20],
  [HOME, 'Lokeren', 25], [HOME, 'Lokeren', 32], [HOME, 'Sint-Gillis-Waas', 16], [HOME, 'Linkeroever, Antwerpen', 30],
  [HOME, 'Antwerpen-Centraal', 40], [HOME, HOME, 10], [HOME, HOME, 21], [HOME, HOME, 32],
  ['Antwerpen-Centraal', 'Wilrijk', 15], ['Gent-Sint-Pieters', 'Lochristi', 22], ['Korenmarkt, Gent', 'Korenmarkt, Gent', 12],
];

type Row = { to: string; km: number; calls: number; secs: number; routes: { len: number; score: number; busy: number; over: number; unp: number; noisy: number; extra: number }[] };

async function run(label: string, dir: string) {
  const { BRouterRouter } = await import(path.resolve(dir, 'src/core/brouter.ts'));
  const { planRoutes } = await import(path.resolve(dir, 'src/core/planner.ts'));
  const router = new BRouterRouter({ profileText: await readFile(path.resolve(dir, 'brouter/longcut-run.brf'), 'utf8'), cache, maxConcurrent: 2, minIntervalMs: 500 });
  const rows: Row[] = [];
  for (const [from, to, km] of TRIPS) {
    const start = await geo(from), end = await geo(to);
    let calls = 0;
    const route = router.route.bind(router);
    router.route = (...a: unknown[]) => (calls++, route(...a));
    const t0 = Date.now();
    const r = await planRoutes({ start, end, distanceKm: km, prefs: { unpavedOk: false, preferGreen: false }, onProgress: () => {} }, router);
    router.route = route;
    const routes = r.ok ? r.routes : [];
    rows.push({
      to, km, calls, secs: (Date.now() - t0) / 1000,
      routes: routes.map((x: { stats: Record<string, number>; score: number; extraM?: number }) => ({
        len: x.stats.length, score: x.score, busy: x.stats.busyShare, over: x.stats.overlapShare, unp: x.stats.unpavedShare, noisy: x.stats.noisyShare, extra: x.extraM ?? 0,
      })),
    });
    console.log(label, to, km, 'km:', routes.map((x: { stats: { length: number }; score: number; extraM?: number }) => `${(x.stats.length / 1000).toFixed(2)}${x.extraM ? '*' : ''} s${x.score.toFixed(2)}`).join(' '), `· ${calls} calls`);
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/quality-${label}.json`, JSON.stringify(rows));
}

async function compare(a: string, b: string) {
  const A: Row[] = JSON.parse(await readFile(`${OUT}/quality-${a}.json`, 'utf8'));
  const B: Row[] = JSON.parse(await readFile(`${OUT}/quality-${b}.json`, 'utf8'));
  const agg = (rows: Row[]) => {
    const rs = rows.flatMap((t) => t.routes);
    const best = rows.filter((t) => t.routes.length).map((t) => Math.min(...t.routes.map((r) => r.score)));
    const avg = (f: (r: Row['routes'][number]) => number) => (rs.reduce((s, r) => s + f(r), 0) / rs.length) * 100;
    return {
      trips_with_routes: rows.filter((t) => t.routes.length).length, routes: rs.length,
      best_score: best.reduce((s, x) => s + x, 0) / best.length, busy_pct: avg((r) => r.busy), twice_pct: avg((r) => r.over),
      unpaved_pct: avg((r) => r.unp), noisy_pct: avg((r) => r.noisy), padded: rs.filter((r) => r.extra >= 20).length,
      calls: rows.reduce((s, t) => s + t.calls, 0) / rows.length,
    };
  };
  const x = agg(A), y = agg(B);
  for (const k of Object.keys(x) as (keyof typeof x)[]) console.log(k.padEnd(18), a, x[k].toFixed(2).padStart(7), ' ', b, y[k].toFixed(2).padStart(7));
  for (let i = 0; i < A.length; i++) {
    const s = (t: Row) => Math.min(9, ...t.routes.map((r) => r.score));
    console.log(`${A[i].to.slice(0, 24).padEnd(24)} ${String(A[i].km).padStart(3)}  best ${s(A[i]).toFixed(2)} → ${s(B[i]).toFixed(2)}  routes ${A[i].routes.length}/${B[i].routes.length}`);
  }
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === 'compare') await compare(x, y);
else await run(cmd ?? 'now', x ?? '.');
