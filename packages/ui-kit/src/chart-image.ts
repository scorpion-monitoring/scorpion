// The chart as a file (an export): the SVG document the adapter draws, on the page's background so that light text stays readable, or
// the same picture as a PNG. Pure except for `rasterise`, which needs a browser.

/** Adds the width, the height and a background to the SVG the library wrote, so the file is a picture on its own anywhere. */
export function standaloneSvg(
  svg: string,
  width: number,
  height: number,
  background: string,
): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return svg;
  let tag = open[0];
  if (!/\swidth=/.test(tag)) tag = tag.replace('<svg', `<svg width="${width}" height="${height}"`);
  if (!/\sxmlns=/.test(tag)) tag = tag.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const rect = `<rect width="100%" height="100%" fill="${background}"/>`;
  return svg.replace(open[0], `${tag}${rect}`);
}

/** The SVG as a PNG at twice the size. Browser only; the SVG is read from a `data:` address, which the page's policy allows for images. */
export function rasterise(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('no canvas'));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no image'))), 'image/png');
    };
    image.onerror = () => reject(new Error('the chart could not be read as an image'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
