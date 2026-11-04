import type { LngLat } from './geo';

/** One piece of a route between two consecutive geometry points. */
export interface Segment {
  from: LngLat;
  to: LngLat;
  ele: number | null; // elevation at `to`, if known
  length: number; // meters
  waytype: number; // openrouteservice waytype code, -1 if unknown
  surface: number; // openrouteservice surface code, -1 if unknown
}

/** A route as returned by a router, already split into segments. */
export interface RawRoute {
  segments: Segment[];
  /** Index in `segments` where each requested waypoint is reached (first = 0). */
  waypointSegIndex: number[];
}

export interface RouteOptions {
  profile: 'foot-walking' | 'foot-hiking';
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

export interface PlanPrefs {
  /** Unpaved paths are fine (otherwise mildly avoided). */
  unpavedOk: boolean;
}

export interface PlanRequest {
  start: LngLat;
  end: LngLat;
  distanceKm: number;
  prefs: PlanPrefs;
}

export interface RouteStats {
  length: number; // meters
  overlapShare: number; // 0..1, share of length run more than once
  busyShare: number; // 0..1, share on major roads
  unpavedShare: number; // 0..1
  ascent: number; // meters
}

export interface PlannedRoute {
  coords: LngLat[];
  elevations: (number | null)[];
  /** Road type per piece of the route (between coords[i] and coords[i+1]). */
  waytypes: number[];
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
