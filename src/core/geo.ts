// Small geometry helpers. Coordinates are [lng, lat] like GeoJSON.

export type LngLat = [number, number];

const R = 6371008.8; // mean earth radius in meters
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in meters. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Local flat projection around an origin, in meters.
 * Accurate enough for the distances we plan (< 100 km).
 */
export function makeProjection(origin: LngLat) {
  const kx = (Math.PI / 180) * R * Math.cos(rad(origin[1]));
  const ky = (Math.PI / 180) * R;
  return {
    toXY: (p: LngLat): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLngLat: (x: number, y: number): LngLat => [origin[0] + x / kx, origin[1] + y / ky],
  };
}

export function pathLength(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

export { deg, rad };
