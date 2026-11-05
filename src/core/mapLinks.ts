// Links that open a route in Google Maps or Apple Maps.
// These apps only accept a few points in a link, so the route there is an approximation.
import type { LngLat } from './geo';
import { haversine } from './geo';

const fmt = (p: LngLat) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;

/** Picks `n` points spread evenly (by distance) along the route, excluding start and end. */
export function sampleAlong(coords: LngLat[], n: number): LngLat[] {
  if (coords.length < 3 || n <= 0) return [];
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  const out: LngLat[] = [];
  let j = 0;
  for (let k = 1; k <= n; k++) {
    const target = (total * k) / (n + 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    out.push(coords[j]);
  }
  return out;
}

/** Google Maps allows up to 9 waypoints in a directions link. */
export function googleMapsUrl(coords: LngLat[]): string {
  const start = coords[0];
  const end = coords[coords.length - 1];
  const via = sampleAlong(coords, 9);
  const params = new URLSearchParams({
    api: '1',
    origin: fmt(start),
    destination: fmt(end),
    travelmode: 'walking',
    waypoints: via.map(fmt).join('|'),
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Apple Maps links only take a start and destination, plus one stop via a second daddr. */
export function appleMapsUrl(coords: LngLat[]): string {
  const start = coords[0];
  const end = coords[coords.length - 1];
  const mid = sampleAlong(coords, 1)[0] ?? end;
  return `https://maps.apple.com/?saddr=${fmt(start)}&daddr=${fmt(mid)}+to:${fmt(end)}&dirflg=w`;
}
