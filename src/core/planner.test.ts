import { describe, expect, it } from 'vitest';
import { haversine } from './geo';
import type { LngLat } from './geo';
import { measure, removeSpurs } from './analyze';
import { planRoutes } from './planner';
import type { RawRoute, Router, Segment } from './types';

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
        segments.push({ from, to, ele: 10, length: haversine(from, to) * 1.25, waytype: 3, surface: 3 });
      }
      waypointSegIndex.push(segments.length);
    }
    return { segments, waypointSegIndex };
  }
}

const home: LngLat = [4.1937, 51.1878];
const parents: LngLat = [4.143, 51.1655]; // ~4.5 km straight line
const prefs = { unpavedOk: false };

const seg = (from: LngLat, to: LngLat, waytype = 3): Segment => ({
  from, to, ele: null, length: haversine(from, to), waytype, surface: 3,
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
    const s = measure([seg(a, b, 1), seg(b, c), seg(c, b), seg(b, a, 1)]);
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
    it(`A→B ${km} km lands within 0..+3%`, async () => {
      const router = new FakeRouter();
      const r = await planRoutes({ start: home, end: parents, distanceKm: km, prefs }, router);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.routes.length).toBe(3);
      for (const route of r.routes) {
        expect(route.deviation).toBeGreaterThanOrEqual(0);
        expect(route.deviation).toBeLessThanOrEqual(0.03);
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
      expect(Math.abs(route.deviation - 0.015)).toBeLessThan(0.016);
      expect(haversine(route.coords[0], route.coords.at(-1)!)).toBeLessThan(1);
    }
  });
});
