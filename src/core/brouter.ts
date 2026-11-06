// Router backed by BRouter (https://brouter.de), using LONGCUT's own running profile.
// Free, no API key. The profile is uploaded once per option combination.
import type { LngLat } from './geo';
import { haversine } from './geo';
import { RouterError } from './types';
import type { RawRoute, ResponseCache, RoadKind, RouteOptions, Router, Segment } from './types';

export interface BRouterOptions {
  /** Contents of longcut-run.brf. */
  profileText: string;
  baseUrl?: string;
  cache?: ResponseCache;
  /** Max requests running at the same time (be kind to the public server). */
  maxConcurrent?: number;
  /** Minimum time between two requests, in ms. */
  minIntervalMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lets at most `n` tasks run at once. */
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  private n: number;
  constructor(n: number) {
    this.n = n;
  }
  /** Change how many may run at once (takes effect for the next tasks). */
  setLimit(n: number) {
    this.n = n;
    while (this.active < this.n && this.queue.length) this.queue.shift()?.();
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.n) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class BRouterRouter implements Router {
  private opts: BRouterOptions;
  private base: string;
  private gate: Semaphore;
  private profileIds = new Map<string, Promise<string>>();
  private lastStart = 0;
  /** Answers from this session: "New routes" and similar plans reuse them. */
  private memory = new Map<string, BRouterResponse>();
  private calmTimer: ReturnType<typeof setTimeout> | undefined;
  /** Number of route requests actually sent (cache hits excluded). */
  requestCount = 0;

  constructor(opts: BRouterOptions) {
    this.opts = opts;
    this.base = opts.baseUrl ?? 'https://brouter.de';
    this.gate = new Semaphore(opts.maxConcurrent ?? 4);
  }

  /** The profile text with the options filled in. */
  profileFor(ro: RouteOptions): string {
    return this.opts.profileText
      .replace(/^assign avoid_unpaved\s*=\s*\w+/m, `assign avoid_unpaved = ${ro.unpavedOk ? 'false' : 'true'}`)
      .replace(/^assign prefer_green\s*=\s*\w+/m, `assign prefer_green  = ${ro.preferGreen ? 'true' : 'false'}`)
      .replace(/^assign prefer_lit\s*=\s*\w+/m, `assign prefer_lit    = ${ro.preferLit ? 'true' : 'false'}`);
  }

  private profileId(ro: RouteOptions): Promise<string> {
    const text = this.profileFor(ro);
    let id = this.profileIds.get(text);
    if (!id) {
      id = this.uploadProfile(text);
      id.catch(() => this.profileIds.delete(text));
      this.profileIds.set(text, id);
    }
    return id;
  }

  private async uploadProfile(text: string): Promise<string> {
    const res = await fetch(`${this.base}/brouter/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    });
    const json = (await res.json()) as { profileid?: string; error?: string };
    if (!json.profileid) throw new RouterError(`Profile upload failed: ${json.error ?? res.status}`, false);
    return json.profileid;
  }

  async route(points: LngLat[], ro: RouteOptions, signal?: AbortSignal): Promise<RawRoute> {
    signal?.throwIfAborted();
    const lonlats = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
    // cache key uses the profile text itself, not the (temporary) server id
    const key = `brouter|${this.profileFor(ro)}|${lonlats}`;
    let json = this.memory.get(key) ?? ((await this.opts.cache?.get(key)) as BRouterResponse | undefined);
    if (!json) {
      const profile = await this.profileId(ro);
      json = await this.get(`${this.base}/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`, ro, signal);
      await this.opts.cache?.set(key, json);
    }
    if (this.memory.size > 400) this.memory.clear();
    this.memory.set(key, json);
    return toRawRoute(json);
  }

  private async get(url: string, ro: RouteOptions, signal?: AbortSignal): Promise<BRouterResponse> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.gate.run(async () => {
        const wait = this.lastStart + (this.opts.minIntervalMs ?? 150) - Date.now();
        this.lastStart = Math.max(Date.now(), this.lastStart + (this.opts.minIntervalMs ?? 150));
        if (wait > 0) await sleep(wait);
        signal?.throwIfAborted();
        this.requestCount++;
        return fetch(url, { signal });
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text) as BRouterResponse;

      // Custom profiles expire on the server after a while: upload again.
      if (/profile|not found/i.test(text) && /custom_/.test(url) && attempt < 1) {
        this.profileIds.clear();
        const fresh = await this.profileId(ro);
        url = url.replace(/profile=custom_\d+/, `profile=${fresh}`);
        continue;
      }
      // The public server is busy ("retry later"): send fewer requests at once for a
      // minute and retry after a short pause, instead of long waits.
      if (res.status === 403 && /retry later/i.test(text)) {
        this.calmDown();
        if (attempt < 3) {
          await sleep(1500 * (attempt + 1));
          signal?.throwIfAborted();
          continue;
        }
        throw new RouterError('The route server is busy.', false, true);
      }
      if (res.status >= 500 && attempt < 3) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const noRoute = /not mapped|island|no route|operation killed|position not/i.test(text);
      throw new RouterError(`BRouter ${res.status}: ${text.slice(0, 200)}`, noRoute);
    }
  }

  private calmDown() {
    this.gate.setLimit(2);
    clearTimeout(this.calmTimer);
    this.calmTimer = setTimeout(() => this.gate.setLimit(this.opts.maxConcurrent ?? 4), 60_000);
  }
}

interface BRouterResponse {
  features: {
    geometry: { coordinates: number[][] };
    properties: { messages: string[][] };
  }[];
}

function roadKind(t: Record<string, string>): RoadKind {
  switch (t.highway) {
    case 'motorway': case 'motorway_link': case 'trunk': case 'trunk_link': case 'primary': case 'primary_link':
      return 'main';
    case 'secondary': case 'secondary_link': case 'tertiary': case 'tertiary_link':
      return 'secondary';
    case 'residential': case 'service': case 'unclassified': case 'living_street': case 'road':
      return 'street';
    case 'cycleway': return 'cycleway';
    case 'footway': case 'pedestrian': return 'footway';
    case 'path': case 'bridleway': return 'path';
    case 'track': return 'track';
    case 'steps': return 'steps';
    default: return 'unknown';
  }
}

const PAVED = new Set(['paved', 'asphalt', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'concrete:plates', 'concrete:lanes', 'metal', 'wood']);
/** Half-paved: gravel, dolomite, crushed stone. Runs fine, so not counted as unpaved. */
const HALF_PAVED = new Set(['compacted', 'fine_gravel', 'gravel', 'pebblestone', 'grass_paver']);

/** Soft ground (dirt, grass, sand, mud, forest paths), or a path or field track with no known surface. */
function isUnpaved(t: Record<string, string>): boolean {
  if (t.surface) return !PAVED.has(t.surface) && !HALF_PAVED.has(t.surface);
  if (t.highway === 'track') return t.tracktype !== 'grade1' && t.tracktype !== 'grade2';
  if (t.highway === 'path' || t.highway === 'bridleway') return true;
  return false;
}

/** BRouter estimates noise from nearby roads (1 = quiet .. 6 = very loud). */
function noiseLevel(t: Record<string, string>): number {
  const n = Number(t.estimated_noise_class ?? 0);
  return n >= 6 ? 1 : n === 5 ? 0.7 : n === 4 ? 0.3 : 0;
}

/**
 * BRouter returns the geometry plus a table of "messages": one row per stretch
 * of road, ending at a geometry point, with that road's OSM tags.
 */
export function toRawRoute(json: BRouterResponse): RawRoute {
  const f = json.features[0];
  const pts = f.geometry.coordinates;
  const [header, ...rows] = f.properties.messages;
  const iLon = header.indexOf('Longitude');
  const iLat = header.indexOf('Latitude');
  const iTags = header.indexOf('WayTags');
  const ends = rows.map((r) => ({
    lon: +r[iLon] / 1e6,
    lat: +r[iLat] / 1e6,
    tags: Object.fromEntries(r[iTags].split(' ').filter(Boolean).map((kv) => kv.split('=', 2))) as Record<string, string>,
  }));

  const segments: Segment[] = [];
  let m = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a: LngLat = [pts[i][0], pts[i][1]];
    const b: LngLat = [pts[i + 1][0], pts[i + 1][1]];
    const tags = ends[Math.min(m, ends.length - 1)]?.tags ?? {};
    segments.push({
      from: a,
      to: b,
      ele: pts[i + 1].length > 2 ? pts[i + 1][2] : null,
      length: haversine(a, b),
      road: roadKind(tags),
      unpaved: isUnpaved(tags),
      noise: noiseLevel(tags),
    });
    const end = ends[m];
    if (end && Math.abs(end.lon - b[0]) < 2e-6 && Math.abs(end.lat - b[1]) < 2e-6) m++;
  }
  return { segments, waypointSegIndex: [] };
}
