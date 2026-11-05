// FIT "course" export: Garmin's own file format for routes you follow on the watch.
// Structure follows Garmin's course file type: file_id, course, lap, timer start,
// one record per point, timer stop.
import { Encoder, Profile } from '@garmin/fitsdk';
import type { LngLat } from './geo';
import { haversine } from './geo';

const SEMICIRCLES = 2 ** 31 / 180;
/** Assumed pace for the course's timestamps (Garmin needs them, e.g. for Virtual Partner). */
const SPEED_MS = 3; // ≈ 5:33 min/km

export function toFit(name: string, coords: LngLat[], elevations: (number | null)[] = []): Uint8Array {
  const enc = new Encoder();
  // the SDK's typings don't list message fields, so pass plain objects
  const put = (mesgNum: number, mesg: Record<string, unknown>) => enc.onMesg(mesgNum as never, mesg as never);
  const start = new Date();
  const at = (meters: number) => new Date(start.getTime() + (meters / SPEED_MS) * 1000);
  const semi = (deg: number) => Math.round(deg * SEMICIRCLES);

  const dist: number[] = [0];
  for (let i = 1; i < coords.length; i++) dist.push(dist[i - 1] + haversine(coords[i - 1], coords[i]));
  const total = dist[dist.length - 1] ?? 0;
  const first = coords[0];
  const last = coords[coords.length - 1];
  const end = at(total);

  put(Profile.MesgNum.FILE_ID, {
    type: 'course',
    manufacturer: 'development',
    product: 0,
    timeCreated: start,
    serialNumber: 1,
  });
  // Course names on the watch are short; Garmin cuts them at about 15 characters.
  put(Profile.MesgNum.COURSE, { name: name.slice(0, 30), sport: 'running' });
  put(Profile.MesgNum.LAP, {
    timestamp: start,
    startTime: start,
    startPositionLat: semi(first[1]),
    startPositionLong: semi(first[0]),
    endPositionLat: semi(last[1]),
    endPositionLong: semi(last[0]),
    totalElapsedTime: total / SPEED_MS,
    totalTimerTime: total / SPEED_MS,
    totalDistance: total,
  });
  put(Profile.MesgNum.EVENT, { timestamp: start, event: 'timer', eventType: 'start', eventGroup: 0 });
  coords.forEach((c, i) => {
    const ele = elevations[i];
    put(Profile.MesgNum.RECORD, {
      timestamp: at(dist[i]),
      positionLat: semi(c[1]),
      positionLong: semi(c[0]),
      distance: dist[i],
      ...(ele != null ? { altitude: ele } : {}),
    });
  });
  put(Profile.MesgNum.EVENT, { timestamp: end, event: 'timer', eventType: 'stopAll', eventGroup: 0 });
  return enc.close();
}
