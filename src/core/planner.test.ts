import { describe, expect, it } from 'vitest';
import { haversine } from './geo';
import type { LngLat } from './geo';
import { measure, removeSpurs } from './analyze';
import { planRoutes } from './planner';
import type { RawRoute, RoadKind, Router, Segment } from './types';

/** Fake router: straight lines between points, but 25% longer (like winding roads). */
class FakeRouter implements Router {
  calls = 0;
  async route(points: LngLat[]): Promise<RawRoute> {
    this.calls++;
    const segments: Segment[] = [];
    const waypointSegIndex = [0];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const steps = 10;
      for (let k = 0; k < steps; k++) {
        const p = (t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const from = p(k / steps), to = p((k + 1) / steps);
        segments.push({ from, to, ele: 10, length: haversine(from, to) * 1.25, road: 'street', unpaved: false, noise: 0 });
      }
      waypointSegIndex.push(segments.length);
    }
    return { segments, waypointSegIndex };
  }
}

const home: LngLat = [4.1937, 51.1878];
const parents: LngLat = [4.143, 51.1655]; // ~4.5 km straight line
const prefs = { unpavedOk: false, preferGreen: false };

const seg = (from: LngLat, to: LngLat, road: RoadKind = 'street'): Segment => ({
  from, to, ele: null, length: haversine(from, to), road, unpaved: false, noise: 0,
});

describe('removeSpurs', () => {
  it('cuts a dead-end that is run out and back', () => {
    const a: LngLat = [4, 51], b: LngLat = [4.001, 51], spur: LngLat = [4.001, 51.001], c: LngLat = [4.002, 51];
    const out = removeSpurs([seg(a, b), seg(b, spur), seg(spur, b), seg(b, c)]);
    expect(out.map((s) => s.to)).toEqual([b, c]);
  });
  it('keeps a normal route untouched', () => {
    const pts: LngLat[] = [[4, 51], [4.001, 51], [4.002, 51.001], [4.003, 51]];
    const segs = pts.slice(1).map((p, i) => seg(pts[i], p));
    expect(removeSpurs(segs)).toHaveLength(3);
  });
});

describe('measure', () => {
  it('counts road run twice as overlap, and main roads as busy', () => {
    const a: LngLat = [4, 51], b: LngLat = [4.01, 51], c: LngLat = [4.01, 51.01];
    // a→b on a main road, b→c, c→b (repeat), b→a (repeat on main road)
    const s = measure([seg(a, b, 'main'), seg(b, c), seg(c, b), seg(b, a, 'main')]);
    expect(s.overlapShare).toBeCloseTo(0.5, 2);
    const ab = haversine(a, b), bc = haversine(b, c);
    expect(s.busyShare).toBeCloseTo(ab / (ab + bc), 3);
  });
});

describe('planRoutes', () => {
  it('says so when the distance is shorter than the shortest route', async () => {
    const r = await planRoutes({ start: home, end: parents, distanceKm: 3, prefs }, new FakeRouter());
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'too-short') expect(r.shortestKm).toBeGreaterThan(5);
  });

  for (const km of [10, 25, 60]) {
    it(`A→B ${km} km is never short and at most 1 km long`, async () => {
      const router = new FakeRouter();
      const r = await planRoutes({ start: home, end: parents, distanceKm: km, prefs }, router);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.routes.length).toBe(3);
      for (const route of r.routes) {
        expect(route.stats.length).toBeGreaterThanOrEqual(km * 1000 - 1);
        expect(route.stats.length).toBeLessThanOrEqual(km * 1000 + 1000);
        expect(route.coords[0]).toEqual(home);
        expect(route.coords.at(-1)).toEqual(parents);
      }
    });
  }

  it('plans a loop when start and end are the same', async () => {
    const r = await planRoutes({ start: home, end: home, distanceKm: 21, prefs }, new FakeRouter());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const route of r.routes) {
      expect(route.stats.length).toBeGreaterThanOrEqual(21000 - 1);
      expect(route.stats.length).toBeLessThanOrEqual(22000);
      expect(haversine(route.coords[0], route.coords.at(-1)!)).toBeLessThan(1);
    }
  });

  it('offers several routes, none short, when the direct route almost fits', async () => {
    // the direct route is ~5.6 km (4.5 km × 1.25); ask a bit more than that
    const router = new FakeRouter();
    const direct = await router.route([home, parents]);
    const len = direct.segments.reduce((a, s) => a + s.length, 0);
    const want = Math.round(len + 200) / 1000;
    const r = await planRoutes({ start: home, end: parents, distanceKm: want, prefs }, router);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // the direct route (made long enough) is one option; other routes of that length come with it
    expect(r.routes.length).toBeGreaterThan(1);
    for (const x of r.routes) {
      expect(x.stats.length).toBeGreaterThan(want * 1000 - 1);
      expect(haversine(x.coords.at(-1)!, parents)).toBeLessThan(1);
    }
  });

  it('adds an out-and-back at the finish when only the direct route is found', async () => {
    // every detour fails: only the direct route (200 m short) is left
    const router = new FakeRouter();
    const route = router.route.bind(router);
    router.route = async (points) => {
      if (points.length > 2 && haversine(points[0], home) < 1) throw new TypeError('Failed to fetch');
      return route(points);
    };
    const direct = await route([home, parents]);
    const len = direct.segments.reduce((a, s) => a + s.length, 0);
    const want = Math.round(len + 200) / 1000;
    const r = await planRoutes({ start: home, end: parents, distanceKm: want, prefs }, router);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].stats.length).toBeCloseTo(want * 1000, 0);
    expect(r.routes[0].extraM).toBeGreaterThan(150);
    expect(haversine(r.routes[0].coords.at(-1)!, parents)).toBeLessThan(1);
  });

  it('keeps the routes it found when the connection drops halfway', async () => {
    const router = new FakeRouter();
    const route = router.route.bind(router);
    router.route = async (points) => {
      if (router.calls >= 12) throw new TypeError('Failed to fetch');
      return route(points);
    };
    const r = await planRoutes({ start: home, end: parents, distanceKm: 15, prefs }, router);
    expect(r.ok).toBe(true);
  });

  it('reports a dead connection instead of "no route"', async () => {
    const router: Router = {
      route: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    await expect(planRoutes({ start: home, end: home, distanceKm: 10, prefs }, router)).rejects.toThrow('Failed to fetch');
  });

  describe('with a stop', () => {
    const stop: LngLat = [4.16, 51.2]; // off to the side of home → parents
    const passes = (coords: LngLat[], p: LngLat) => Math.min(...coords.map((c) => haversine(c, p)));

    for (const [name, end] of [['A→B', parents], ['loop', home]] as const) {
      it(`${name}: passes the stop, right length, says where the stop is`, async () => {
        const r = await planRoutes({ start: home, end, stop, distanceKm: 20, prefs }, new FakeRouter());
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.routes.length).toBeGreaterThan(1);
        for (const x of r.routes) {
          expect(passes(x.coords, stop)).toBeLessThan(1);
          expect(x.stats.length).toBeGreaterThanOrEqual(20000 - 1);
          expect(x.stats.length).toBeLessThanOrEqual(21000);
          expect(haversine(x.coords.at(-1)!, end)).toBeLessThan(1);
          expect(x.stopM).toBeGreaterThan(haversine(home, stop));
          expect(x.stopM).toBeLessThan(x.stats.length - haversine(stop, end));
        }
      });
    }

    it('too short when the way via the stop is already longer', async () => {
      const r = await planRoutes({ start: home, end: parents, stop: [4.1, 51.25], distanceKm: 8, prefs }, new FakeRouter());
      expect(r.ok).toBe(false);
    });

    it('keeps a dead-end way in to the stop', async () => {
      // the stop is at the end of a dead-end street: the router goes to the junction,
      // up to the stop and back down the same way
      const junction: LngLat = [4.16, 51.2];
      const tip: LngLat = [4.162, 51.2];
      const router = new FakeRouter();
      const route = router.route.bind(router);
      router.route = async (points) => {
        const j = points.findIndex((p) => haversine(p, tip) < 1);
        if (j < 0) return route(points);
        const raw = await route(points.map((p, k) => (k === j ? junction : p)));
        const i = raw.segments.findIndex((s) => haversine(s.to, junction) < 1);
        const segs = [...raw.segments.slice(0, i + 1), seg(junction, tip), seg(tip, junction), ...raw.segments.slice(i + 1)];
        return { ...raw, segments: segs };
      };
      const r = await planRoutes({ start: home, end: parents, stop: tip, distanceKm: 20, prefs }, router);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const x of r.routes) expect(passes(x.coords, tip)).toBeLessThan(1);
    });
  });
});
