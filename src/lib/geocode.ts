// Address search with Photon (OpenStreetMap data, free, no key).
import type { LngLat } from '../core/geo';

export interface Place {
  name: string; // main line, e.g. "Grote Markt 1"
  detail: string; // second line, e.g. "Sint-Niklaas"
  coord: LngLat;
}

const BASE = 'https://photon.komoot.io';
const BELGIUM_BBOX = '2.5,49.45,6.45,51.55';

interface PhotonFeature {
  geometry: { coordinates: LngLat };
  properties: Record<string, string | undefined>;
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : '';
  const name = p.name || street || p.city || 'Unnamed place';
  const town = p.city ?? p.town ?? p.village ?? p.locality ?? p.county ?? '';
  const detail = [p.name ? street : '', town].filter((x) => x && x !== name).join(', ');
  return { name, detail, coord: f.geometry.coordinates };
}

export async function searchPlaces(query: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, limit: '7', bbox: BELGIUM_BBOX });
  if (near) {
    params.set('lon', near[0].toFixed(4));
    params.set('lat', near[1].toFixed(4));
  }
  const res = await fetch(`${BASE}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as { features: PhotonFeature[] };
  return json.features.map(toPlace);
}

/** Name of the place at a coordinate, for points picked on the map or by GPS. */
export async function reverseGeocode(coord: LngLat): Promise<Place> {
  const fallback: Place = { name: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`, detail: 'Dropped pin', coord };
  try {
    const res = await fetch(`${BASE}/reverse?lon=${coord[0]}&lat=${coord[1]}&limit=1`);
    if (!res.ok) return fallback;
    const json = (await res.json()) as { features: PhotonFeature[] };
    if (!json.features.length) return fallback;
    return { ...toPlace(json.features[0]), coord };
  } catch {
    return fallback;
  }
}
