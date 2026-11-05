import type { LngLat } from '../core/geo';
import { haversine } from '../core/geo';

/** A small elevation profile. Hidden when there is no elevation data. */
export default function ElevationSpark({ coords, elevations }: { coords: LngLat[]; elevations: (number | null)[] }) {
  const pts: [number, number][] = [];
  let d = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) d += haversine(coords[i - 1], coords[i]);
    const e = elevations[i];
    if (e != null) pts.push([d, e]);
  }
  if (pts.length < 2 || d === 0) return null;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const range = Math.max(20, max - min); // flat land stays flat
  const W = 300, H = 40;
  const step = Math.max(1, Math.floor(pts.length / 150));
  const xy = pts
    .filter((_, i) => i % step === 0 || i === pts.length - 1)
    .map(([x, y]) => [(x / d) * W, H - 2 - ((y - min) / range) * (H - 6)] as const);
  const path = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${path}L${W},${H}L0,${H}Z`} className="spark-area" />
        <path d={path} className="spark-line" />
      </svg>
      <figcaption>
        <span>{Math.round(min)} m</span>
        <span>{Math.round(max)} m</span>
      </figcaption>
    </figure>
  );
}
