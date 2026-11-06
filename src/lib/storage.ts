// Favorites and saved routes, kept on this device (no account).
import type { LngLat } from '../core/geo';
import type { RoadKind, RouteStats } from '../core/types';
import type { Place } from './geocode';

/** A long list of repeating values, stored short: [value, how many times]. */
export type Runs<T> = [T, number][];
export const toRuns = <T,>(xs: T[]): Runs<T> => {
  const out: Runs<T> = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && last[0] === x) last[1]++;
    else out.push([x, 1]);
  }
  return out;
};
export const fromRuns = <T,>(runs: Runs<T>): T[] => runs.flatMap(([x, n]) => Array<T>(n).fill(x));

export interface SavedRoute {
  id: string;
  savedAt: number;
  from: Place;
  to: Place;
  requestedKm: number;
  lengthM: number;
  ascent: number;
  coords: LngLat[];
  elevations: (number | null)[];
  /** Added later: older saved routes don't have these. */
  stats?: RouteStats;
  roads?: Runs<RoadKind>;
  unpaved?: Runs<boolean>;
  extraM?: number;
  loop?: boolean;
}

export interface Settings {
  distanceKm: number;
  preferGreen: boolean;
  unpavedOk: boolean;
  /** Surface choice; older saved settings only have unpavedOk. */
  surface?: 'paved' | 'mixed' | 'trail';
  preferLit: boolean;
}

const KEYS = { favorites: 'longcut.favorites', recent: 'longcut.recent', routes: 'longcut.routes', settings: 'longcut.settings' };
const MAX_ROUTES = 60;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const MAX_RECENT = 6;

/** Places you picked lately, newest first. */
export const recentPlaces = {
  list: (): Place[] => read<Place[]>(KEYS.recent, []),
  add(p: Place): void {
    if (p.name === 'Current location') return;
    const rest = recentPlaces.list().filter((r) => !sameSpot(r.coord, p.coord));
    write(KEYS.recent, [p, ...rest].slice(0, MAX_RECENT));
  },
};

export const favorites = {
  list: (): Place[] => read<Place[]>(KEYS.favorites, []),
  has: (p: Place) => favorites.list().some((f) => sameSpot(f.coord, p.coord)),
  toggle(p: Place): Place[] {
    const list = favorites.list();
    const next = favorites.has(p) ? list.filter((f) => !sameSpot(f.coord, p.coord)) : [p, ...list];
    write(KEYS.favorites, next);
    return next;
  },
};

export const savedRoutes = {
  list: (): SavedRoute[] => read<SavedRoute[]>(KEYS.routes, []),
  add(r: Omit<SavedRoute, 'id' | 'savedAt'>): SavedRoute | null {
    // round coordinates to ~10 cm to keep storage small
    const route: SavedRoute = {
      ...r,
      coords: r.coords.map((c) => [+c[0].toFixed(6), +c[1].toFixed(6)] as LngLat),
      elevations: r.elevations.map((e) => (e == null ? null : Math.round(e * 10) / 10)),
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      savedAt: Date.now(),
    };
    const next = [route, ...savedRoutes.list()].slice(0, MAX_ROUTES);
    return write(KEYS.routes, next) ? route : null;
  },
  remove(id: string): SavedRoute[] {
    const next = savedRoutes.list().filter((r) => r.id !== id);
    write(KEYS.routes, next);
    return next;
  },
};

export const settings = {
  get: (): Settings => ({ distanceKm: 15, preferGreen: false, unpavedOk: false, preferLit: false, ...read<Partial<Settings>>(KEYS.settings, {}) }),
  set: (s: Settings) => write(KEYS.settings, s),
};

function sameSpot(a: LngLat, b: LngLat) {
  return Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
}
