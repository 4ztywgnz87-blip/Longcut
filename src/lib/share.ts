// Hands a GPX file to the phone: the share sheet on iPhone/Android (so you can pick
// Garmin Connect directly), or a normal download elsewhere.

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled' | 'unsupported';

export function canShareFiles(): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const probe = new File(['x'], 'x.gpx', { type: 'application/gpx+xml' });
  return !!nav.share && !!nav.canShare?.({ files: [probe] });
}

/** Phone: open the share sheet. Elsewhere, or if sharing fails: download the file. */
export async function exportGpx(fileName: string, gpx: string): Promise<ExportOutcome> {
  const file = new File([gpx], fileName, { type: 'application/gpx+xml' });
  if (matchMedia('(pointer: coarse)').matches && canShareFiles()) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
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
