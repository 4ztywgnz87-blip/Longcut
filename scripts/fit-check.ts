// Writes a FIT course from a test route and reads it back with Garmin's decoder.
// Usage: npx tsx scripts/fit-check.ts
import { Decoder, Stream } from '@garmin/fitsdk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { toFit } from '../src/core/fit';
import type { LngLat } from '../src/core/geo';

const coords: LngLat[] = Array.from({ length: 200 }, (_, i) => [4.178 + i * 0.0005, 51.1934 + Math.sin(i / 20) * 0.003]);
const ele = coords.map((_, i) => 5 + (i % 30) / 3);
const bytes = toFit('LONGCUT 15 km to Grote Markt', coords, ele, [{ atM: 3000, name: 'Stop: Bakkerij Peeters' }]);
mkdirSync('eval/out', { recursive: true });
writeFileSync('eval/out/test-course.fit', bytes);

const decoder = new Decoder(Stream.fromByteArray(bytes));
console.log('isFIT', decoder.isFIT(), 'integrity', decoder.checkIntegrity());
const { messages, errors } = decoder.read();
console.log('errors', errors);
console.log('fileId', messages.fileIdMesgs?.[0]);
console.log('course', messages.courseMesgs?.[0]);
console.log('lap distance', messages.lapMesgs?.[0]?.totalDistance);
console.log('records', messages.recordMesgs?.length, messages.recordMesgs?.[0], messages.recordMesgs?.at(-1)?.distance);
console.log('events', messages.eventMesgs?.map((e: { eventType: string }) => e.eventType));
console.log('course points', messages.coursePointMesgs);
