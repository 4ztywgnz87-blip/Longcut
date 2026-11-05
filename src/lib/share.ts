// Saves a route file to the device (Downloads on iPhone, the browser's downloads elsewhere).
// From there: open the file → Share → Garmin Connect. Garmin Connect does not show up
// when sharing straight from a web page, so a download is the shortest reliable path.

export const FIT_TYPE = 'application/vnd.ant.fit';

export function downloadFile(fileName: string, data: string | Uint8Array, type: string): void {
  const file = new File([data as BlobPart], fileName, { type });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
