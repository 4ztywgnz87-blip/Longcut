// Cleaning up and measuring a route.
import type { LngLat } from './geo';
import type { RouteStats, Segment } from './types';

// openrouteservice codes, see https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/
export const WAYTYPE = {
  stateRoad: 1, // main roads (primary/trunk)
  road: 2, // secondary/tertiary roads
  street: 3,
  path: 4,
  track: 5,
  cycleway: 6,
  footway: 7,
  steps: 8,
} as const;
const UNPAVED_SURFACES = new Set([2, 8, 9, 10, 11, 12, 15, 16, 17]);

const same = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/**
 * Removes every place where the route turns around on the spot and comes back
 * the same way (dead-end spurs, U-turns at a waypoint). Works like a stack:
 * a segment that exactly reverses the previous one cancels it out.
 */
export function removeSpurs(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const top = out[out.length - 1];
    if (top && same(top.from, s.to) && same(top.to, s.from)) out.pop();
    else out.push(s);
  }
  return out;
}

export const segmentKey = (s: Segment) => {
  const a = `${s.from[0].toFixed(6)},${s.from[1].toFixed(6)}`;
  const b = `${s.to[0].toFixed(6)},${s.to[1].toFixed(6)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

export function measure(segments: Segment[]): RouteStats {
  let length = 0;
  let busy = 0;
  let unpaved = 0;
  const seen = new Map<string, number>();
  let repeated = 0;

  for (const s of segments) {
    length += s.length;
    if (s.waytype === WAYTYPE.stateRoad) busy += s.length;
    else if (s.waytype === WAYTYPE.road) busy += s.length * 0.5;
    if (UNPAVED_SURFACES.has(s.surface)) unpaved += s.length;
    const k = segmentKey(s);
    const n = seen.get(k) ?? 0;
    if (n > 0) repeated += s.length;
    seen.set(k, n + 1);
  }

  return {
    length,
    overlapShare: length ? repeated / length : 0,
    busyShare: length ? busy / length : 0,
    unpavedShare: length ? unpaved / length : 0,
    ascent: ascent(segments),
  };
}

/** Total climb in meters, ignoring small wiggles in the elevation data. */
function ascent(segments: Segment[]): number {
  let total = 0;
  let low: number | null = null;
  let high: number | null = null;
  for (const s of segments) {
    if (s.ele == null) continue;
    if (low == null || high == null) {
      low = high = s.ele;
      continue;
    }
    if (s.ele > high) high = s.ele;
    if (s.ele < high - 2) {
      // a real descent: bank the climb so far
      total += high - low;
      low = high = s.ele;
    } else if (s.ele < low) {
      low = high = s.ele;
    }
  }
  if (low != null && high != null) total += high - low;
  return Math.round(total);
}
