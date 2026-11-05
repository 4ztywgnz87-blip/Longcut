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
  const detail = [p.name ? street : '', town].filter((x) => x && x !== name).join(', ');
  return { name, detail, coord: f.geometry.coordinates };
}

async function searchPhoton(q: string, near: LngLat | undefined, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: '7', bbox: BELGIUM_BBOX });
  if (near) {
    params.set('lon', near[0].toFixed(4));
    params.set('lat', near[1].toFixed(4));
  }
  // Photon can be slow; stop waiting after 8 s so the search does not hang
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal: anyOf(signal, timeout(8000)) });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return ((await res.json()) as { features: PhotonFeature[] }).features.map(photonPlace);
}

// --- Flemish address register ------------------------------------------------------

interface FlandersResult {
  FormattedAddress: string;
  Location: { Lat_WGS84: number; Lon_WGS84: number };
}

function flandersPlace(r: FlandersResult): Place {
  // "Ten Bos 4, 9100 Sint-Niklaas" → name "Ten Bos 4", detail "9100 Sint-Niklaas"
  const [name, ...rest] = r.FormattedAddress.split(', ');
  return { name, detail: rest.join(', '), coord: [r.Location.Lon_WGS84, r.Location.Lat_WGS84] };
}

async function searchFlanders(q: string, near: LngLat | undefined, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`${FLANDERS}?q=${encodeURIComponent(q)}&c=7`, { signal });
  if (!res.ok) throw new Error(`Flanders ${res.status}`);
  const places = ((await res.json()) as { LocationResult: FlandersResult[] }).LocationResult.map(flandersPlace);
  // this service does not sort by distance, so put the nearest first
  if (near) places.sort((a, b) => haversine(near, a.coord) - haversine(near, b.coord));
  return places;
}

// --- Combined ---------------------------------------------------------------------

/** Same name within 600 m (e.g. a square from both services, or a station's platforms). */
const same = (a: Place, b: Place) =>
  a.name.toLowerCase() === b.name.toLowerCase() && haversine(a.coord, b.coord) < 600;

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
  let photon: Place[] = [];
  const publish = () => {
    if (signal.aborted) return;
    onResults(unique([...flanders.slice(0, 5), ...photon]).slice(0, 9));
  };
  const results = await Promise.allSettled([
    searchFlanders(q, near, signal).then((r) => {
      flanders = r;
      publish();
    }),
    searchPhoton(q, near, signal).then((r) => {
      photon = r;
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
