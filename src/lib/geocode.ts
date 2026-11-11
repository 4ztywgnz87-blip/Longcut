// Address search. Two free services, no keys:
// - Flemish government address register (geo.api.vlaanderen.be): fast, streets and
//   house numbers in Flanders and Brussels.
// - Photon (OpenStreetMap): slower, but also knows places like stations and parks.
// Both are asked at the same time; whatever answers first is shown first.
import type { LngLat } from '../core/geo';
import { haversine } from '../core/geo';

export interface Place {
  name: string; // main line, e.g. "Grote Markt 1"
  detail: string; // second line, e.g. "Sint-Niklaas"
  coord: LngLat;
}

const PHOTON = 'https://photon.komoot.io';
const FLANDERS = 'https://geo.api.vlaanderen.be/geolocation/v4/Location';
const BELGIUM_BBOX = '2.5,49.45,6.45,51.55';

/** Lower case, no accents or punctuation: for comparing what was typed with names. */
const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// --- Photon --------------------------------------------------------------------

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: Record<string, string | undefined>;
}

function photonPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : '';
  const name = p.name || street || p.city || 'Unnamed place';
  const town = p.city ?? p.town ?? p.village ?? p.locality ?? p.county ?? '';
  const detail = [kindOf(p), p.name ? street : '', town].filter((x) => x && x !== name).join(', ');
  return { name, detail, coord: f.geometry.coordinates };
}

/** A word that tells same-named results apart: the town itself, its station, a bus stop. */
function kindOf(p: PhotonFeature['properties']): string {
  if (p.osm_key === 'place') {
    const v = p.osm_value ?? '';
    return v === 'city' || v === 'town' ? 'Town' : v === 'village' || v === 'hamlet' ? 'Village' : v === 'suburb' || v === 'neighbourhood' || v === 'quarter' ? 'Neighbourhood' : '';
  }
  if ((p.osm_key === 'railway' && /^(station|stop|halt)$/.test(p.osm_value ?? '')) || p.osm_value === 'train_station') return 'Station';
  if (p.osm_value === 'bus_stop') return 'Bus stop';
  return '';
}

/** Towns and villages whose name is what was typed come first; the rest follows the addresses. */
async function searchPhoton(q: string, near: LngLat | undefined, signal?: AbortSignal): Promise<{ towns: Place[]; places: Place[] }> {
  const params = new URLSearchParams({ q, limit: '7', bbox: BELGIUM_BBOX });
  if (near) {
    params.set('lon', near[0].toFixed(4));
    params.set('lat', near[1].toFixed(4));
  }
  // Photon can be slow; stop waiting after 8 s so the search does not hang
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal: anyOf(signal, timeout(8000)) });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const all = ((await res.json()) as { features: PhotonFeature[] }).features;
  const isArea = (f: PhotonFeature) => f.properties.osm_key === 'boundary';
  const found = all.filter((f) => {
    if (f.properties.osm_value === 'motorway_junction') return false;
    // an area is placed at the middle of its territory (often a field): prefer the town's own point
    return !isArea(f) || !all.some((o) => !isArea(o) && o.properties.osm_key === 'place' && o.properties.name === f.properties.name);
  });
  const typed = plain(q);
  const isTown = (f: PhotonFeature) => (f.properties.osm_key === 'place' || isArea(f)) && plain(f.properties.name ?? '').startsWith(typed);
  return { towns: found.filter(isTown).map(photonPlace), places: found.filter((f) => !isTown(f)).map(photonPlace) };
}

// --- Flemish address register ------------------------------------------------------

interface FlandersResult {
  FormattedAddress: string;
  Municipality?: string;
  LocationType?: string;
  Location: { Lat_WGS84: number; Lon_WGS84: number };
}

function flandersPlace(r: FlandersResult): Place {
  // "Ten Bos 4, 9100 Sint-Niklaas" → name "Ten Bos 4", detail "9100 Sint-Niklaas"
  const [name, ...rest] = r.FormattedAddress.split(', ');
  return { name, detail: rest.join(', '), coord: [r.Location.Lon_WGS84, r.Location.Lat_WGS84] };
}

async function askFlanders(q: string, signal?: AbortSignal): Promise<FlandersResult[]> {
  const res = await fetch(`${FLANDERS}?q=${encodeURIComponent(q)}&c=5`, { signal });
  if (!res.ok) throw new Error(`Flanders ${res.status}`);
  return ((await res.json()) as { LocationResult: FlandersResult[] }).LocationResult;
}

/** The municipality you are in, remembered per spot (~1 km), to find streets close to you. */
const townCache = new Map<string, Promise<string | null>>();
function townAt(c: LngLat): Promise<string | null> {
  const key = `${c[0].toFixed(2)},${c[1].toFixed(2)}`;
  let town = townCache.get(key);
  if (!town) {
    town = fetch(`${FLANDERS}?latlon=${c[1]},${c[0]}&c=1`, { signal: timeout(3000) })
      .then((r) => r.json())
      .then((j: { LocationResult: FlandersResult[] }) => j.LocationResult[0]?.Municipality ?? null)
      .catch(() => null);
    townCache.set(key, town);
  }
  return town;
}

/**
 * Streets and addresses, plus whole municipalities (kept apart: see searchPlaces).
 * The service returns at most 5 matches in alphabetical order, so "Grote Markt" alone
 * would never show the one around the corner: ask a second time with your own town added.
 */
async function searchFlanders(q: string, near: LngLat | undefined, signal?: AbortSignal): Promise<{ places: Place[]; towns: Place[] }> {
  const town = near ? await Promise.race([townAt(near), new Promise<null>((r) => setTimeout(() => r(null), 400))]) : null;
  const local = town && !plain(q).includes(plain(town)) ? askFlanders(`${q}, ${town}`, signal).catch(() => []) : Promise.resolve([]);
  const [wide, close] = await Promise.all([askFlanders(q, signal), local]);
  const seen = new Set<string>();
  const all = [...close, ...wide].filter((r) => !seen.has(r.FormattedAddress) && !!seen.add(r.FormattedAddress));
  const isTown = (r: FlandersResult) => r.LocationType === 'basisregisters_gemeente';
  // A municipality is offered only when it is what was typed: "Kemzeke" must not give
  // "Stekene" (the merged municipality it belongs to), a postal code may give its town.
  const typed = plain(q);
  const towns = all.filter((r) => isTown(r) && (/^\d{4}$/.test(typed) || plain(r.FormattedAddress).startsWith(typed))).map(flandersPlace);
  const places = all.filter((r) => !isTown(r)).map(flandersPlace);
  // this service does not sort by distance, so put the nearest first
  if (near) places.sort((a, b) => haversine(near, a.coord) - haversine(near, b.coord));
  return { places, towns };
}

// --- Combined ---------------------------------------------------------------------

/** Same name within 600 m (e.g. a square from both services, or a station's platforms), or shown the same. */
const same = (a: Place, b: Place) =>
  a.name.toLowerCase() === b.name.toLowerCase() && (haversine(a.coord, b.coord) < 600 || a.detail === b.detail);

function unique(places: Place[]): Place[] {
  const out: Place[] = [];
  for (const p of places) if (!out.some((o) => same(o, p))) out.push(p);
  return out;
}

/**
 * Searches both services at once. `onResults` is called each time a service answers,
 * with all results so far (Flemish addresses first, then other places).
 * Resolves when both have answered or failed; rejects only if both failed.
 */
export async function searchPlaces(
  query: string,
  near: LngLat | undefined,
  signal: AbortSignal,
  onResults: (places: Place[]) => void,
): Promise<void> {
  const q = query.trim();
  if (q.length < 2) return onResults([]);
  let flanders: Place[] = [];
  let towns: Place[] = [];
  let photon: Place[] = [];
  let photonTowns: Place[] = [];
  const publish = () => {
    if (signal.aborted) return;
    // The register puts a municipality at the middle of its territory, which can be a field.
    // Photon knows the actual town centre, so the register's town only fills in when Photon has none.
    const extra = towns.filter((t) => !photonTowns.some((p) => p.name.toLowerCase() === t.name.toLowerCase()));
    onResults(unique([...photonTowns.slice(0, 3), ...flanders.slice(0, 5), ...photon, ...extra]).slice(0, 9));
  };
  const results = await Promise.allSettled([
    searchFlanders(q, near, signal).then((r) => {
      flanders = r.places;
      towns = r.towns;
      publish();
    }),
    searchPhoton(q, near, signal).then((r) => {
      photon = r.places;
      photonTowns = r.towns;
      publish();
    }),
  ]);
  if (results.every((r) => r.status === 'rejected') && !signal.aborted) throw new Error('Search failed');
}

/** Aborts when any of the given signals aborts. */
function anyOf(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const ctl = new AbortController();
  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) ctl.abort();
    else sig.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl.signal;
}

/** Gives up on a request after `ms`. */
function timeout(ms: number): AbortSignal {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), ms);
  return ctl.signal;
}

/** Name of the place at a coordinate, for points picked on the map or by GPS. */
export async function reverseGeocode(coord: LngLat): Promise<Place> {
  const fallback: Place = { name: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`, detail: 'Dropped pin', coord };
  try {
    const res = await fetch(`${FLANDERS}?latlon=${coord[1]},${coord[0]}&c=1`, { signal: timeout(3000) });
    const r = ((await res.json()) as { LocationResult: FlandersResult[] }).LocationResult[0];
    if (r && haversine(coord, [r.Location.Lon_WGS84, r.Location.Lat_WGS84]) < 300) return { ...flandersPlace(r), coord };
  } catch {
    /* try Photon */
  }
  try {
    const res = await fetch(`${PHOTON}/reverse?lon=${coord[0]}&lat=${coord[1]}&limit=1`, { signal: timeout(6000) });
    const f = ((await res.json()) as { features: PhotonFeature[] }).features[0];
    return f ? { ...photonPlace(f), coord } : fallback;
  } catch {
    return fallback;
  }
}
