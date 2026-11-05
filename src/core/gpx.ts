// GPX export. Garmin Connect imports a GPX "track" as a course.
import type { LngLat } from './geo';

const esc = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function toGpx(name: string, coords: LngLat[], elevations: (number | null)[] = []): string {
  const pts = coords
    .map((c, i) => {
      const ele = elevations[i];
      return `      <trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${ele != null ? `<ele>${ele.toFixed(1)}</ele>` : ''}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="LONGCUT" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>running</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** A safe file name like "longcut-25km-sint-niklaas.gpx" (or .fit). */
export function routeFileName(km: number, to: string, ext: 'gpx' | 'fit'): string {
  const slug = to
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `longcut-${km.toFixed(1).replace('.0', '')}km${slug ? `-${slug}` : ''}.${ext}`;
}
