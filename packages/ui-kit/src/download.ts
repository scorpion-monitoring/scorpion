// Handing the person a file the page made (an export): a click on a link to a blob URL. Browser only.

/** Saves a blob under a name by a click on a link to a blob URL, which is freed at once. Browser only. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
