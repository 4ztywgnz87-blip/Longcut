// Hands a route file to the phone: the share sheet on iPhone/Android (so you can pick
// Garmin Connect directly), or a normal download elsewhere.

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled';

export const FIT_TYPE = 'application/vnd.ant.fit';
export const GPX_TYPE = 'application/gpx+xml';

function canShare(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  return !!nav.share && !!nav.canShare?.({ files: [file] });
}

/** Phone: open the share sheet. Elsewhere, or if sharing fails: download the file. */
export async function exportFile(fileName: string, data: string | Uint8Array, type: string): Promise<ExportOutcome> {
  const file = new File([data as BlobPart], fileName, { type });
  if (matchMedia('(pointer: coarse)').matches && canShare(file)) {
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
