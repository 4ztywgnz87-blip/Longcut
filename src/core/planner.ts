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

/**
 * Length rules, in meters, for a requested distance `target`.
 * - A route should never be shorter than asked. A route that comes out a little short
 *   gets an out-and-back stretch at the finish (see padToTarget).
 * - Up to 500 m longer is ideal: time to walk out. A lot longer (1 km) is not.
 */
export const lengthRules = (target: number) => {
  const extraOk = Math.min(500, target * 0.05); // ideal: 0 … +extraOk
  return {
    extraOk,
    maxOver: Math.max(extraOk, Math.min(1000, target * 0.05)), // longest accepted
    maxShort: Math.min(1500, target * 0.05), // shortest accepted (then padded)
    // aim a bit past the middle: a few hundred meters extra is fine, short needs patching
    aim: target + extraOk * 0.7,
  };
};
const MAX_STEPS = 7;
/**
 * Route requests one plan may use. The public route server refuses ("retry later") after
 * about 35 quick requests from one phone. Easy trips stop early anyway (as soon as 3 good
 * routes are in); this only caps the hard ones. Quality comes first, so it is not tight.
 */
const REQUEST_BUDGET = 40;
/** Routes this good (score) are worth showing without searching further. */
const GOOD_SCORE = 0.15;
/** After a round, a route this good is shown while the search goes on. */
const SHOW_SCORE = 0.2;
/** A route scoring worse than this is worth another round of searching, if requests are left. */
const FAIR_SCORE = 0.25;
/** Fewer requests than this left: not enough for a useful extra round. */
const MIN_ROUND_BUDGET = 8;
/** Extra requests, once, when the budget gave fewer than 3 routes (hard places: rivers, motorways). */
const EXTRA_BUDGET = 20;
/** After this long, stop refining and show the best routes found so far. */
const TIME_BUDGET_MS = 30_000;
/** Rounds of fresh variants to try when the first round gives fewer than 3 good routes. */
const MAX_ROUNDS = 3;
const LOOP_THRESHOLD_M = 250;
/** Asked distance less than this many times the shortest way: "only a little longer". */
const SLIGHT_RATIO = 1.3;
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

function templates(req: PlanRequest, isLoop: boolean, slight = false): Template[] {
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
  // One via point alone tends to produce out-and-back routes, so use 2 or 3. Only when the
  // route has to be just a little longer than the shortest way, one point to the side is
  // tried as well: a single gentle bend, where 2 or 3 points often snap to longer ways around.
  const one = slight
    ? [ellipseTemplate(a, b, 1, at([P / 2]), 'left · 1 via'), ellipseTemplate(a, b, -1, at([P / 2]), 'right · 1 via')]
    : [];
  return [
    ...one,
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
  segments: Segment[];
  keys: Map<string, number>; // segment key → length, for comparing routes
}

const deviation = (length: number, target: number) => (length - target) / target;
const totalLength = (segs: Segment[]) => segs.reduce((sum, s) => sum + s.length, 0);

function scoreRoute(segments: Segment[], target: number, req: PlanRequest) {
  const stats = measure(segments);
  const dev = deviation(stats.length, target);
  const { extraOk } = lengthRules(target);
  // per km: too long is worse than a little short (short gets an out-and-back,
  // which also counts as run twice)
  const overKm = Math.max(0, stats.length - target - extraOk) / 1000;
  const shortKm = Math.max(0, target - stats.length) / 1000;
  const devPenalty = overKm * 0.5 + shortKm * 0.25 + (shortKm * 1000 / target) * 4;
  const score =
    devPenalty +
    stats.overlapShare * 4 +
    stats.busyShare * 3 +
    stats.noisyShare * 1.5 +
    (req.prefs.unpavedOk ? 0 : stats.unpavedShare * 0.5);
  return { stats, dev, score };
}

/** A signal that fires when either one fires. */
function anySignal(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const ctl = new AbortController();
  const fire = () => ctl.abort();
  if (a.aborted || b.aborted) ctl.abort();
  a.addEventListener('abort', fire, { once: true });
  b.addEventListener('abort', fire, { once: true });
  return ctl.signal;
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
  onFail: (e: unknown) => void,
  onTry: (segments: Segment[]) => void,
  stop: AbortSignal,
  calib: Calibration,
  lead: boolean,
  budget: Budget,
): Promise<Attempt | null> {
  // The first template measures how long a route gets for a given shape size; the others
  // wait for that and start from a better first guess (fewer tries, fewer requests).
  if (!lead) await calib.ready;
  try {
    return await fitTemplateInner(t, req, router, ro, target, calib.ratio ? rulesAim(target) / calib.ratio : initialSize, deadline, onBusy, onFail, onTry, stop, calib, budget);
  } finally {
    if (lead) calib.release();
  }
}

const rulesAim = (target: number) => lengthRules(target).aim;

interface Budget {
  left: number;
}

interface Calibration {
  /** Route length per meter of shape size, measured by the first try. */
  ratio: number | null;
  ready: Promise<void>;
  release: () => void;
}

function newCalibration(): Calibration {
  let release = () => {};
  const ready = new Promise<void>((r) => (release = r));
  // don't let the others wait long if the first try is slow
  setTimeout(() => release(), 2500);
  return { ratio: null, ready, release: () => release() };
}

async function fitTemplateInner(
  t: Template,
  req: PlanRequest,
  router: Router,
  ro: RouteOptions,
  target: number,
  initialSize: number,
  deadline: number,
  onBusy: () => void,
  onFail: (e: unknown) => void,
  onTry: (segments: Segment[]) => void,
  stop: AbortSignal,
  calib: Calibration,
  budget: Budget,
): Promise<Attempt | null> {
  const rules = lengthRules(target);
  const aim = rules.aim;
  // How far from good a length is. Short counts double: it needs an extra out-and-back.
  const miss = (len: number) => {
    const d = len - target;
    if (d >= 0 && d <= rules.extraOk) return 0;
    return d < 0 ? -d * 2 : d - rules.extraOk;
  };
  const signal = anySignal(req.signal, stop);
  let size = Math.max(initialSize, t.minSize);
  let variant = 0;
  let below: Attempt | null = null;
  let above: Attempt | null = null;
  let best: Attempt | null = null;
  let previous: number | null = null;

  for (let step = 0; step < MAX_STEPS && Date.now() < deadline && !stop.aborted; step++) {
    if (budget.left <= 0) break;
    budget.left--;
    let segments: Segment[];
    try {
      const raw = await beforeDeadline(router.route([req.start, ...t.vias(size, variant), req.end], ro, signal), deadline);
      if (!raw) break; // out of time: keep the best try so far
      segments = removeSpurs(raw.segments);
    } catch (e) {
      // enough good routes were found elsewhere: stop here
      if (stop.aborted && !req.signal?.aborted) break;
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
      if (req.signal?.aborted) throw e;
      // the connection dropped: keep what was found so far instead of losing everything
      onFail(e);
      break;
    }
    const length = totalLength(segments);
    const attempt = { size, segments, length };
    if (calib.ratio === null && length > 0) {
      calib.ratio = length / size;
      calib.release();
    }
    if (debug()) console.log(`  [${t.label}] step ${step} v${variant} size ${(size / 1000).toFixed(2)}km → ${(length / 1000).toFixed(2)}km`);
    if (!best || miss(length) < miss(best.length)) best = attempt;
    // every try of an acceptable length is a route to choose from, not only the closest one:
    // a try that is 200 m longer may well be the quieter route
    if (length >= target - rules.maxShort && length <= target + rules.maxOver) onTry(segments);
    if (stop.aborted) break;

    if (length >= target && length <= target + rules.extraOk) break;

    // Stuck: the length barely changed, so the via points keep snapping to the same roads.
    const stuck = previous !== null && Math.abs(length - previous) / target < 0.01;
    previous = length;
    if (stuck) {
      variant++;
      below = above = null;
    }

    if (length < aim) below = !below || length > below.length ? attempt : below;
    else above = !above || length < above.length ? attempt : above;

    // Jumpy: almost the same size gives very different lengths, typically because a
    // via point flips to the other side of a railway or motorway. Move the points.
    if (!stuck && below && above && Math.abs(above.size - below.size) / size < 0.06 && (above.length - below.length) / target > 0.08) {
      variant++;
      below = above = null;
      size = Math.max(t.minSize, size * (aim / length));
      continue;
    }

    let next: number;
    if (below && above && above.length > below.length && !stuck) {
      // interpolate between the two closest tries
      const f = (aim - below.length) / (above.length - below.length);
      next = below.size + f * (above.size - below.size);
    } else {
      // roads are not straight: scale size by how far off we are
      next = size * (aim / length);
    }
    next = Math.max(t.minSize, next);
    // the same shape again would give the same route: move the via points instead
    if (Math.abs(next - size) / size < 0.005) variant++;
    size = next;
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
  let slight = false;
  let directFits: Segment[] | null = null;
  if (!isLoop) {
    let direct: Segment[];
    try {
      direct = removeSpurs((await router.route([req.start, req.end], ro, req.signal)).segments);
    } catch (e) {
      if (e instanceof RouterError && e.noRoute) return { ok: false, reason: 'no-route', message: e.message };
      throw e;
    }
    const len = totalLength(direct);
    shortestKm = len / 1000;
    const rules = lengthRules(target);
    if (len > target + rules.maxOver) return { ok: false, reason: 'too-short', shortestKm };
    // the direct route already fits: it is one of the routes to choose from
    if (len >= target - rules.maxShort) directFits = direct;
    detour = Math.min(1.6, Math.max(1.1, len / crow));
    slight = target / len < SLIGHT_RATIO;
  }

  // 2. Try every template in parallel, each adjusting its own size.
  const initial = isLoop ? target / detour : Math.max(crow * 1.05, target / detour);
  const deadline = Date.now() + TIME_BUDGET_MS;
  let busy = false;
  let failure: unknown;
  const { maxShort, maxOver } = lengthRules(target);
  const found: Candidate[] = [];
  let chosen: Candidate[] = [];
  const base = (req.variation ?? 0) * MAX_ROUNDS;
  const isShort = (c: Candidate) => c.route.stats.length < target - 1;
  const calib = newCalibration();
  const budget: Budget = { left: REQUEST_BUDGET - 1 }; // the direct route used one

  /**
   * The best 3 different routes. At most `shorts` of them may be short (those get an
   * out-and-back at the finish): preferably 1, 2 only when nothing better came out.
   */
  // A really good route found early is shown right away (req.onProgress). The final choice
  // is made as usual; the shown route (or a better, very similar one) stays in the first tab.
  const shown: Candidate[] = [];
  const ranked = () =>
    found
      .filter((c) => c.route.stats.length >= target - maxShort && c.route.stats.length <= target + maxOver)
      .sort((x, y) => x.route.score - y.route.score);
  const pick = (shorts: number) => {
    const out: Candidate[] = [];
    let n = 0;
    for (const c of ranked()) {
      if (isShort(c) && n >= shorts) continue;
      if (!out.every((o) => similarity(c, o) <= MAX_SIMILARITY)) continue;
      out.push(c);
      if (isShort(c)) n++;
      if (out.length === 3) break;
    }
    return out;
  };
  const best = () => {
    const one = pick(1);
    return one.length === 3 ? one : pick(2);
  };

  // 3. Rounds: if fewer than 3 good, different routes came out, try fresh variants.
  // Within the normal budget, keep going until at most one route is short; the extra
  // budget is only for getting 3 routes at all.
  let extra = true;
  let polishing = false;
  let stop = new AbortController();
  /** A route of acceptable length came in: keep it, show it if it is the first good one, stop when there are enough. */
  const consider = (segments: Segment[], label: string) => {
    const c = toCandidate(segments, target, req, label);
    // the same route again (another shape that snapped to the same roads) adds nothing
    if (found.some((f) => Math.abs(f.route.stats.length - c.route.stats.length) < 1 && similarity(f, c) > 0.999)) return;
    found.push(c);
    if (!shown.length && req.onProgress && !req.signal?.aborted) {
      const first = ranked().find((x) => !isShort(x) && x.route.score <= GOOD_SCORE);
      if (first) {
        shown.push(first);
        req.onProgress([first.route]);
      }
    }
    const now = pick(1);
    // only stop early when all three are really good, not just the right length
    if (now.length === 3 && now.every((x) => (polishing ? x.route.score <= FAIR_SCORE : !isShort(x) && x.route.score <= GOOD_SCORE))) stop.abort();
  };
  if (directFits) {
    // The direct route (made exactly long enough) is shown at once; the search for
    // alternatives goes on behind it, without the extra requests (they are scarce here).
    const padded = await padToTarget(directFits, target, req, router, ro);
    const c = toCandidate(padded.segments, target, req, 'direct', padded.extra);
    found.push(c);
    shown.push(c);
    if (!req.signal?.aborted) req.onProgress?.([c.route]);
    extra = false;
  }
  // A busy server ("retry later") doesn't end the search: requests pause and continue
  // until the time budget runs out.
  for (let round = 0; round < MAX_ROUNDS + 1 && Date.now() < deadline; round++) {
    // Three routes are in: go on only while one of them is clearly mediocre and there are
    // requests left. The first route is on screen by then, so this costs no waiting.
    polishing = round > 0 && pick(1).length === 3;
    if (polishing && (budget.left < MIN_ROUND_BUDGET || pick(1).every((c) => c.route.score <= FAIR_SCORE))) break;
    if (budget.left <= 0) {
      // only a little longer than the shortest way: there are few real alternatives, two will do
      if (!extra || chosen.length === 3 || (slight && chosen.length === 2)) break;
      extra = false;
      budget.left = EXTRA_BUDGET;
    }
    const roundReq = { ...req, variation: base + round };
    // As soon as 3 really good routes are in, stop the other searches:
    // fewer requests, so faster and kinder to the route server.
    stop = new AbortController();
    const signal = stop.signal;
    await Promise.all(
      templates(roundReq, isLoop, slight).map((t, i) =>
        fitTemplate(t, req, router, ro, target, initial, deadline, () => (busy = true), (e) => (failure ??= e), (segs) => consider(segs, t.label), signal, calib, i === 0, budget),
      ),
    );
    chosen = best();
    // Nothing shown yet and the search goes on: show the best route so far, if it is a
    // decent one (it keeps the first tab, so a mediocre route must not get there).
    if (!shown.length && req.onProgress && !req.signal?.aborted) {
      const first = chosen.find((c) => !isShort(c) && c.route.score <= SHOW_SCORE);
      if (first) {
        shown.push(first);
        req.onProgress([first.route]);
      }
    }
    if (failure) break; // no connection: more rounds would fail the same way
  }
  // keep the first tab what it was: the shown route, or the chosen one most like it
  if (shown.length && chosen.length) {
    const lead = chosen.includes(shown[0]) ? shown[0] : chosen.reduce((a, c) => (similarity(c, shown[0]) > similarity(a, shown[0]) ? c : a));
    chosen = [lead, ...chosen.filter((c) => c !== lead)];
  }
  if (!chosen.length) {
    if (failure) throw failure;
    if (busy) return { ok: false, reason: 'busy' };
    return { ok: false, reason: 'no-route', message: 'Could not find a route of this length here.' };
  }
  // 4. Routes that came out a little short get an out-and-back at the finish.
  const routes = await Promise.all(
    chosen.map(async (c) => {
      if (!isShort(c)) return c.route;
      const padded = await padToTarget(c.segments, target, req, router, ro);
      return toCandidate(padded.segments, target, req, c.route.label, padded.extra).route;
    }),
  );
  return { ok: true, shortestKm, routes };
}

/** The first `len` meters of a path (the last piece is cut to fit). */
function takeLength(segs: Segment[], len: number): Segment[] {
  const out: Segment[] = [];
  let done = 0;
  for (let i = 0; i < segs.length && done < len - 0.01; i++) {
    const s = segs[i];
    if (done + s.length <= len) {
      out.push(s);
      done += s.length;
      continue;
    }
    const f = (len - done) / s.length;
    const to: LngLat = [s.from[0] + (s.to[0] - s.from[0]) * f, s.from[1] + (s.to[1] - s.from[1]) * f];
    const startEle = i > 0 ? segs[i - 1].ele : s.ele;
    const ele = s.ele != null && startEle != null ? startEle + (s.ele - startEle) * f : s.ele;
    out.push({ ...s, to, ele, length: len - done });
    done = len;
  }
  return out;
}

/** The same path run the other way. */
function reversePath(segs: Segment[]): Segment[] {
  return segs
    .map((s, i) => ({ ...s, from: s.to, to: s.from, ele: i > 0 ? segs[i - 1].ele : s.ele }))
    .reverse();
}

/**
 * Makes a route that is a little short exactly as long as asked, by adding an
 * out-and-back at the finish: run past the finish and come back. If there is no
 * road on past the finish, turn around and run back a bit along the route instead.
 */
async function padToTarget(
  segments: Segment[],
  target: number,
  req: PlanRequest,
  router: Router,
  ro: RouteOptions,
): Promise<{ segments: Segment[]; extra: number }> {
  const need = target - totalLength(segments);
  if (need < 1 || !segments.length) return { segments, extra: 0 };
  const half = need / 2;
  const end = segments[segments.length - 1].to;
  let out: Segment[] | null = null;
  // a few meters short: turn around on the route itself, not worth asking the route server
  if (need >= 20) try {
    // keep going in the direction you arrive from
    const back = takeLength(reversePath(segments), 150);
    const proj = makeProjection(end);
    const [bx, by] = proj.toXY(back[back.length - 1]?.to ?? end);
    const d = Math.hypot(bx, by) || 1;
    const reach = half * 1.4 + 100;
    const target2 = proj.toLngLat((-bx / d) * reach, (-by / d) * reach);
    const raw = await router.route([end, target2], ro, req.signal);
    const path = removeSpurs(raw.segments);
    if (totalLength(path) >= half) out = takeLength(path, half);
  } catch (e) {
    if (req.signal?.aborted) throw e;
    // no road on past the finish: fall back to the route itself
  }
  if (!out) out = takeLength(reversePath(segments), half);
  return { segments: [...segments, ...out, ...reversePath(out)], extra: need };
}

/** Share of road two routes have in common (0 = nothing, 1 = identical). */
function similarity(a: Candidate, b: Candidate): number {
  let shared = 0;
  for (const [k, len] of a.keys) if (b.keys.has(k)) shared += len;
  return shared / Math.min(a.route.stats.length, b.route.stats.length);
}

function toCandidate(segments: Segment[], target: number, req: PlanRequest, label: string, extra = 0): Candidate {
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
    extraM: extra,
  };
  return { route, keys, segments };
}
