// The heart of LONGCUT: find a route from A to B (or a loop) with a chosen length.
//
// Idea: put 2-3 extra "via" points on an ellipse around A and B. Every point on
// an ellipse has the same total straight-line distance to A and B, so a wider
// ellipse means a longer route, and the route makes one big detour instead of
// small loops. We grow or shrink the ellipse until the real route length fits.
import { haversine, makeProjection } from './geo';
import type { LngLat } from './geo';
import { measure, removeSpurs, segmentKey } from './analyze';
import { RouterError } from './types';
import type { PlanRequest, PlanResult, PlannedRoute, RouteOptions, Router, Segment } from './types';

/** Accepted length window, relative to the requested distance. */
export const WINDOW = { ideal: [0, 0.03] as const, max: [-0.05, 0.05] as const, aim: 0.015 };
const MAX_STEPS = 7;
/** After this long, stop refining and show the best routes found so far. */
const TIME_BUDGET_MS = 15_000;
const LOOP_THRESHOLD_M = 250;
/** Two alternatives sharing more than this share of road count as "the same route". */
const MAX_SIMILARITY = 0.7;
/** When the search gets stuck, the via points are shifted by these angles (radians). */
const VARIANT_SHIFTS = [0, 0.18, -0.18, 0.36, -0.36];
// Set globalThis.LONGCUT_DEBUG = true to log every search step.
const debug = () => !!(globalThis as { LONGCUT_DEBUG?: boolean }).LONGCUT_DEBUG;

interface Template {
  label: string;
  /** Via points for a given "size" (straight-line length of the shape, in meters). */
  vias: (size: number, variant: number) => LngLat[];
  /** Smallest sensible size. */
  minSize: number;
}

/** Ellipse with foci A and B. `ts` are angles on the ellipse (π = A side, 0 = B side). */
function ellipseTemplate(a: LngLat, b: LngLat, side: 1 | -1, ts: number[], label: string): Template {
  const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const proj = makeProjection(mid);
  const [bx, by] = proj.toXY(b);
  const c = Math.hypot(bx, by); // half the distance A-B
  const ux = bx / c, uy = by / c; // unit vector A→B
  const vx = -uy * side, vy = ux * side; // perpendicular, to the chosen side
  return {
    label,
    minSize: 2 * c * 1.02,
    vias: (size, variant) => {
      const shift = VARIANT_SHIFTS[variant % VARIANT_SHIFTS.length];
      const semiMajor = size / 2;
      const semiMinor = Math.sqrt(Math.max(0, semiMajor ** 2 - c ** 2));
      return ts.map((t0) => {
        const t = Math.min(Math.PI - 0.15, Math.max(0.15, t0 + shift));
        const x = semiMajor * Math.cos(t) * ux + semiMinor * Math.sin(t) * vx;
        const y = semiMajor * Math.cos(t) * uy + semiMinor * Math.sin(t) * vy;
        return proj.toLngLat(x, y);
      });
    },
  };
}

/** Loop: a square-ish shape that starts and ends at A, pointing in `heading` (radians). */
function loopTemplate(a: LngLat, heading: number, label: string): Template {
  const proj = makeProjection(a);
  return {
    label,
    minSize: 400,
    vias: (size, variant) => {
      const h = heading + VARIANT_SHIFTS[variant % VARIANT_SHIFTS.length];
      // circle through A; perimeter of the inscribed square ≈ size
      const r = size / (4 * Math.SQRT2);
      const cx = r * Math.sin(h), cy = r * Math.cos(h);
      const back = Math.atan2(-cy, -cx); // angle from center to A
      return [1, 2, 3].map((k) => {
        const ang = back + (k * Math.PI) / 2;
        return proj.toLngLat(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      });
    },
  };
}

function templates(req: PlanRequest, isLoop: boolean): Template[] {
  const { start: a, end: b } = req;
  // "Again" asks for a new set: each variation moves the via points elsewhere.
  const k = req.variation ?? 0;
  if (isLoop) {
    const turn = (k * 37) % 90; // degrees
    return [0, 90, 180, 270].map((d) => loopTemplate(a, ((d + turn) * Math.PI) / 180, `loop ${d + turn}°`));
  }
  const P = Math.PI;
  const shift = [0, 0.3, -0.3, 0.55, -0.55, 0.15, -0.15][k % 7];
  const at = (ts: number[]) => ts.map((t) => Math.min(P - 0.15, Math.max(0.15, t + shift)));
  // One via point alone tends to produce out-and-back routes, so use 2 or 3.
  return [
    ellipseTemplate(a, b, 1, at([(2 * P) / 3, P / 3]), 'left · 2 vias'),
    ellipseTemplate(a, b, -1, at([(2 * P) / 3, P / 3]), 'right · 2 vias'),
    ellipseTemplate(a, b, 1, at([(5 * P) / 6, P / 2, P / 6]), 'left · 3 vias'),
    ellipseTemplate(a, b, -1, at([(5 * P) / 6, P / 2, P / 6]), 'right · 3 vias'),
  ];
}

interface Attempt {
  size: number;
  segments: Segment[];
  length: number;
}

interface Candidate {
  route: PlannedRoute;
  keys: Map<string, number>; // segment key → length, for comparing routes
}

const deviation = (length: number, target: number) => (length - target) / target;
const totalLength = (segs: Segment[]) => segs.reduce((sum, s) => sum + s.length, 0);

function scoreRoute(segments: Segment[], target: number, req: PlanRequest) {
  const stats = measure(segments);
  const dev = deviation(stats.length, target);
  const [lo, hi] = WINDOW.ideal;
  const devPenalty = dev < lo ? (lo - dev) * 25 : dev > hi ? (dev - hi) * 25 : 0;
  const score =
    devPenalty +
    stats.overlapShare * 4 +
    stats.busyShare * 3 +
    stats.noisyShare * 1.5 +
    (req.prefs.unpavedOk ? 0 : stats.unpavedShare * 0.5);
  return { stats, dev, score };
}

/** Resolves with the result, or with null once the deadline has passed. */
function beforeDeadline<T>(p: Promise<T>, deadline: number): Promise<T | null> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(null), left);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Try one template: adjust its size until the route length fits. */
async function fitTemplate(
  t: Template,
  req: PlanRequest,
  router: Router,
  ro: RouteOptions,
  target: number,
  initialSize: number,
  deadline: number,
  onBusy: () => void,
): Promise<Attempt | null> {
  const aim = target * (1 + WINDOW.aim);
  let size = Math.max(initialSize, t.minSize);
  let variant = 0;
  let below: Attempt | null = null;
  let above: Attempt | null = null;
  let best: Attempt | null = null;
  let previous: number | null = null;
  const closeness = (len: number) => Math.abs(deviation(len, aim));

  for (let step = 0; step < MAX_STEPS && Date.now() < deadline; step++) {
    let segments: Segment[];
    try {
      const raw = await beforeDeadline(router.route([req.start, ...t.vias(size, variant), req.end], ro), deadline);
      if (!raw) break; // out of time: keep the best try so far
      segments = removeSpurs(raw.segments);
    } catch (e) {
      if (e instanceof RouterError && e.noRoute) {
        // a via point landed somewhere unroutable (water, closed area): shift the points
        variant++;
        continue;
      }
      if (e instanceof RouterError && e.busy) {
        // the server keeps refusing: keep what this template found so far
        onBusy();
        break;
      }
      throw e;
    }
    const length = totalLength(segments);
    const attempt = { size, segments, length };
    if (debug()) console.log(`  [${t.label}] step ${step} v${variant} size ${(size / 1000).toFixed(2)}km → ${(length / 1000).toFixed(2)}km`);
    if (!best || closeness(length) < closeness(best.length)) best = attempt;

    const dev = deviation(length, target);
    if (dev >= WINDOW.ideal[0] && dev <= WINDOW.ideal[1]) break;

    // Stuck: the length barely changed, so the via points keep snapping to the same roads.
    const stuck = previous !== null && Math.abs(length - previous) / target < 0.01;
    previous = length;
    if (stuck) {
      variant++;
      below = above = null;
    }

    if (length < aim) below = !below || length > below.length ? attempt : below;
    else above = !above || length < above.length ? attempt : above;

    let next: number;
    if (below && above && above.length > below.length && !stuck) {
      // interpolate between the two closest tries
      const f = (aim - below.length) / (above.length - below.length);
      next = below.size + f * (above.size - below.size);
    } else {
      // roads are not straight: scale size by how far off we are
      next = size * (aim / length);
    }
    size = Math.max(t.minSize, next);
  }
  return best;
}

export async function planRoutes(
  req: PlanRequest,
  router: Router,
  ro: RouteOptions = req.prefs,
): Promise<PlanResult> {
  const target = req.distanceKm * 1000;
  const crow = haversine(req.start, req.end);
  const isLoop = crow < LOOP_THRESHOLD_M;

  // 1. Shortest route: tells us if the distance is possible, and how winding roads are here.
  let detour = 1.3;
  let shortestKm = 0;
  if (!isLoop) {
    let direct: Segment[];
    try {
      direct = removeSpurs((await router.route([req.start, req.end], ro)).segments);
    } catch (e) {
      if (e instanceof RouterError && e.noRoute) return { ok: false, reason: 'no-route', message: e.message };
      throw e;
    }
    const len = totalLength(direct);
    shortestKm = len / 1000;
    if (len > target * (1 + WINDOW.max[1])) return { ok: false, reason: 'too-short', shortestKm };
    if (len >= target * (1 + WINDOW.max[0])) {
      // the direct route already fits
      return { ok: true, shortestKm, routes: [toCandidate(direct, target, req, 'direct').route] };
    }
    detour = Math.min(1.6, Math.max(1.1, len / crow));
  }

  // 2. Try every template in parallel, each adjusting its own size.
  const initial = isLoop ? target / detour : Math.max(crow * 1.05, target / detour);
  const deadline = Date.now() + TIME_BUDGET_MS;
  let busy = false;
  const found = await Promise.all(
    templates(req, isLoop).map(async (t) => {
      const a = await fitTemplate(t, req, router, ro, target, initial, deadline, () => (busy = true));
      return a ? toCandidate(a.segments, target, req, t.label) : null;
    }),
  );

  // 3. Keep routes inside the allowed window, best first, and skip near-duplicates.
  const [lo, hi] = WINDOW.max;
  const ranked = found
    .filter((c): c is Candidate => c !== null && c.route.deviation >= lo && c.route.deviation <= hi)
    .sort((x, y) => x.route.score - y.route.score);
  const chosen: Candidate[] = [];
  for (const c of ranked) {
    if (chosen.every((o) => similarity(c, o) <= MAX_SIMILARITY)) chosen.push(c);
    if (chosen.length === 3) break;
  }
  if (!chosen.length) {
    if (busy) return { ok: false, reason: 'busy' };
    return { ok: false, reason: 'no-route', message: 'Could not find a route of this length here.' };
  }
  return { ok: true, shortestKm, routes: chosen.map((c) => c.route) };
}

/** Share of road two routes have in common (0 = nothing, 1 = identical). */
function similarity(a: Candidate, b: Candidate): number {
  let shared = 0;
  for (const [k, len] of a.keys) if (b.keys.has(k)) shared += len;
  return shared / Math.min(a.route.stats.length, b.route.stats.length);
}

function toCandidate(segments: Segment[], target: number, req: PlanRequest, label: string): Candidate {
  const { stats, dev, score } = scoreRoute(segments, target, req);
  const keys = new Map<string, number>();
  for (const s of segments) keys.set(segmentKey(s), s.length);
  const route: PlannedRoute = {
    coords: segments.length ? [segments[0].from, ...segments.map((s) => s.to)] : [],
    elevations: segments.length ? [segments[0].ele, ...segments.map((s) => s.ele)] : [],
    roads: segments.map((s) => s.road),
    unpaved: segments.map((s) => s.unpaved),
    stats,
    score,
    deviation: dev,
    label,
  };
  return { route, keys };
}
