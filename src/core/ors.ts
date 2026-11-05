// Router backed by openrouteservice (https://openrouteservice.org).
import type { LngLat } from './geo';
import { haversine } from './geo';
import { RouterError } from './types';
import type { RawRoute, RoadKind, RouteOptions, Router, Segment } from './types';

export interface ResponseCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface OrsOptions {
  apiKey: string;
  baseUrl?: string;
  /** Max requests per minute (free plan allows 40). */
  perMinute?: number;
  cache?: ResponseCache;
  /** How far (m) a point may be from a road and still be snapped onto it. */
  snapRadius?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keeps us under the per-minute limit by delaying requests when needed. */
class RateLimiter {
  private stamps: number[] = [];
  private perMinute: number;
  constructor(perMinute: number) {
    this.perMinute = perMinute;
  }
  async take() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.perMinute) {
        this.stamps.push(now);
        return;
      }
      await sleep(60_000 - (now - this.stamps[0]) + 50);
    }
  }
}

export class OrsRouter implements Router {
  private limiter: RateLimiter;
  private opts: OrsOptions;
  /** Number of requests actually sent to the API (cache hits excluded). */
  requestCount = 0;

  constructor(opts: OrsOptions) {
    this.opts = opts;
    this.limiter = new RateLimiter(opts.perMinute ?? 38);
  }

  async route(points: LngLat[], ro: RouteOptions): Promise<RawRoute> {
    const round = (p: LngLat): LngLat => [+p[0].toFixed(6), +p[1].toFixed(6)];
    const body = {
      coordinates: points.map(round),
      radiuses: points.map(() => this.opts.snapRadius ?? 1500),
      elevation: true,
      instructions: false,
      extra_info: ['waytype', 'surface'],
      options: { avoid_features: ['ferries', 'fords'] },
    };
    const profile = ro.unpavedOk ? 'foot-hiking' : 'foot-walking';
    const url = `${this.opts.baseUrl ?? 'https://api.openrouteservice.org'}/v2/directions/${profile}/geojson`;
    const key = `${profile}|${JSON.stringify(body)}`;

    let json = (await this.opts.cache?.get(key)) as OrsResponse | undefined;
    if (!json) {
      json = await this.post(url, body);
      await this.opts.cache?.set(key, json);
    }
    return toRawRoute(json);
  }

  private async post(url: string, body: unknown): Promise<OrsResponse> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.take();
      this.requestCount++;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: this.opts.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return (await res.json()) as OrsResponse;

      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(res.status === 429 ? 20_000 * (attempt + 1) : 2_000 * (attempt + 1));
        continue;
      }
      // 2009: route not found, 2010: point not near a road, 2004: route too long.
      const code = safeCode(text);
      const noRoute = code === 2009 || code === 2010 || code === 2004;
      throw new RouterError(`openrouteservice ${res.status} (${code ?? '?'}): ${text.slice(0, 200)}`, noRoute);
    }
  }
}

function safeCode(text: string): number | undefined {
  try {
    return (JSON.parse(text) as { error?: { code?: number } }).error?.code;
  } catch {
    return undefined;
  }
}

interface OrsResponse {
  features: {
    geometry: { coordinates: number[][] };
    properties: {
      way_points: number[];
      extras?: Record<string, { values: [number, number, number][] }>;
    };
  }[];
}

// openrouteservice codes: https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/extra-info/
const ORS_ROADS: Record<number, RoadKind> = {
  1: 'main', 2: 'secondary', 3: 'street', 4: 'path', 5: 'track', 6: 'cycleway', 7: 'footway', 8: 'steps',
};
const ORS_UNPAVED = new Set([2, 8, 9, 10, 11, 12, 15, 16, 17]);

/** Turn the API response into a list of segments with road type and surface attached. */
export function toRawRoute(json: OrsResponse): RawRoute {
  const f = json.features[0];
  const pts = f.geometry.coordinates;
  const n = Math.max(0, pts.length - 1);
  const waytype = new Array<number>(n).fill(-1);
  const surface = new Array<number>(n).fill(-1);
  const fill = (arr: number[], values?: [number, number, number][]) => {
    for (const [from, to, v] of values ?? []) for (let i = from; i < to && i < n; i++) arr[i] = v;
  };
  fill(waytype, f.properties.extras?.waytype?.values);
  fill(surface, f.properties.extras?.surface?.values);

  const segments: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a: LngLat = [pts[i][0], pts[i][1]];
    const b: LngLat = [pts[i + 1][0], pts[i + 1][1]];
    segments.push({
      from: a,
      to: b,
      ele: pts[i + 1].length > 2 ? pts[i + 1][2] : null,
      length: haversine(a, b),
      road: ORS_ROADS[waytype[i]] ?? 'unknown',
      unpaved: ORS_UNPAVED.has(surface[i]),
      noise: 0,
    });
  }
  return { segments, waypointSegIndex: f.properties.way_points };
}
