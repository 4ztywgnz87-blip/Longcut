// Hands a GPX file to the phone: the share sheet on iPhone/Android (so you can pick
// Garmin Connect directly), or a normal download elsewhere.

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled';

export async function exportGpx(fileName: string, gpx: string): Promise<ExportOutcome> {
  const file = new File([gpx], fileName, { type: 'application/gpx+xml' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // fall through to a download when sharing fails
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
