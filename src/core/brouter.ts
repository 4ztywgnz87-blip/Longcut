// Router backed by BRouter (https://brouter.de), using LONGCUT's own running profile.
// Free, no API key. The profile is uploaded once per option combination.
import type { LngLat } from './geo';
import { haversine } from './geo';
import type { ResponseCache } from './ors';
import { RouterError } from './types';
import type { RawRoute, RoadKind, RouteOptions, Router, Segment } from './types';

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
      .replace(/^assign prefer_green\s*=\s*\w+/m, `assign prefer_green  = ${ro.preferGreen ? 'true' : 'false'}`);
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

  async route(points: LngLat[], ro: RouteOptions): Promise<RawRoute> {
    const lonlats = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
    // cache key uses the profile text itself, not the (temporary) server id
    const key = `brouter|${this.profileFor(ro)}|${lonlats}`;
    let json = (await this.opts.cache?.get(key)) as BRouterResponse | undefined;
    if (!json) {
      const profile = await this.profileId(ro);
      json = await this.get(`${this.base}/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`, ro);
      await this.opts.cache?.set(key, json);
    }
    return toRawRoute(json);
  }

  private async get(url: string, ro: RouteOptions): Promise<BRouterResponse> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.gate.run(async () => {
        const wait = this.lastStart + (this.opts.minIntervalMs ?? 150) - Date.now();
        this.lastStart = Math.max(Date.now(), this.lastStart + (this.opts.minIntervalMs ?? 150));
        if (wait > 0) await sleep(wait);
        this.requestCount++;
        return fetch(url);
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
      // The public server asks to slow down with 403 "retry later".
      if (res.status === 403 && /retry later/i.test(text) && attempt < 4) {
        await sleep(5000 * 2 ** attempt);
        continue;
      }
      if (res.status >= 500 && attempt < 3) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const noRoute = /not mapped|island|no route|operation killed|position not/i.test(text);
      throw new RouterError(`BRouter ${res.status}: ${text.slice(0, 200)}`, noRoute);
    }
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

const PAVED = new Set(['paved', 'asphalt', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'concrete:plates', 'metal', 'wood']);

function isUnpaved(t: Record<string, string>): boolean {
  if (t.surface) return !PAVED.has(t.surface);
  if (t.highway === 'track') return t.tracktype !== 'grade1';
  if (t.highway === 'path' || t.highway === 'bridleway') return true;
  return false;
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
    });
    const end = ends[m];
    if (end && Math.abs(end.lon - b[0]) < 2e-6 && Math.abs(end.lat - b[1]) < 2e-6) m++;
  }
  return { segments, waypointSegIndex: [] };
}
