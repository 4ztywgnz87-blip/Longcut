import type { LngLat } from './geo';

/** Kind of road, from busiest to quietest. */
export type RoadKind =
  | 'main' // primary/trunk: busy
  | 'secondary' // secondary/tertiary: can be busy
  | 'street' // residential, service, unclassified
  | 'cycleway'
  | 'footway' // footway, pedestrian
  | 'path'
  | 'track' // farm and forest tracks
  | 'steps'
  | 'unknown';

/** One piece of a route between two consecutive geometry points. */
export interface Segment {
  from: LngLat;
  to: LngLat;
  ele: number | null; // elevation at `to`, if known
  length: number; // meters
  road: RoadKind;
  unpaved: boolean;
  /** 0 = quiet, 1 = right next to a motorway or very busy road. */
  noise: number;
}

/** A route as returned by a router, already split into segments. */
export interface RawRoute {
  segments: Segment[];
  /** Index in `segments` where each requested waypoint is reached (first = 0). */
  waypointSegIndex: number[];
}

export interface RouteOptions {
  unpavedOk: boolean;
  preferGreen: boolean;
  /** Prefer streets with street lights (optional so older callers keep working). */
  preferLit?: boolean;
}

export interface Router {
  route(points: LngLat[], opts: RouteOptions): Promise<RawRoute>;
}

export class RouterError extends Error {
  /** true when the router could not find a road near a point, or no path at all. */
  readonly noRoute: boolean;
  constructor(message: string, noRoute: boolean) {
    super(message);
    this.noRoute = noRoute;
  }
}

export type PlanPrefs = RouteOptions;

export interface PlanRequest {
  start: LngLat;
  end: LngLat;
  distanceKm: number;
  prefs: PlanPrefs;
  /** 0 for the first plan; 1, 2, … for "again" to get different routes. */
  variation?: number;
}

export interface RouteStats {
  length: number; // meters
  overlapShare: number; // 0..1, share of length run more than once
  busyShare: number; // 0..1, share on major roads
  noisyShare: number; // 0..1, share next to loud roads (weighted)
  unpavedShare: number; // 0..1
  ascent: number; // meters
}

export interface PlannedRoute {
  coords: LngLat[];
  elevations: (number | null)[];
  /** Road kind per piece of the route (between coords[i] and coords[i+1]). */
  roads: RoadKind[];
  /** Whether each piece of the route is unpaved. */
  unpaved: boolean[];
  stats: RouteStats;
  score: number; // lower is better
  /** Distance deviation from the requested distance, as a fraction (+0.02 = 2% longer). */
  deviation: number;
  label: string; // which template produced it, for debugging
}

export type PlanResult =
  | { ok: true; routes: PlannedRoute[]; shortestKm: number }
  | { ok: false; reason: 'too-short'; shortestKm: number }
  | { ok: false; reason: 'no-route'; message: string };
