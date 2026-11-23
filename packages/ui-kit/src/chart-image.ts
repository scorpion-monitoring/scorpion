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

/** One entry of the legend of an exported picture: the series' name and how it is drawn. */
export interface LegendEntry {
  name: string;
  color: string;
  marker: 'circle' | 'rect' | 'triangle' | 'diamond';
  line: 'solid' | 'dashed' | 'dotted';
}

const ROW = 20;
const PAD = 8;
/** An estimate of the width of a character at the legend's 12 px: enough to keep entries from overlapping. */
const CHAR = 7;

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The dash pattern of a line style, as SVG wants it. */
export const DASHES = { solid: undefined, dashed: '5 3', dotted: '1.5 2.5' } as const;

/** The marker of a series as an SVG shape centred on (x, y). */
export function markerSvg(
  marker: LegendEntry['marker'],
  x: number,
  y: number,
  color: string,
): string {
  switch (marker) {
    case 'rect':
      return `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="${color}"/>`;
    case 'triangle':
      return `<polygon points="${x},${y - 4} ${x + 4},${y + 3.5} ${x - 4},${y + 3.5}" fill="${color}"/>`;
    case 'diamond':
      return `<polygon points="${x},${y - 4.5} ${x + 4.5},${y} ${x},${y + 4.5} ${x - 4.5},${y}" fill="${color}"/>`;
    default:
      return `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`;
  }
}

/** Where the entries of a legend go in a picture `width` wide: rows that wrap, never past the edge. Pure, for the test. */
export function legendLayout(
  names: readonly string[],
  width: number,
): { positions: { x: number; y: number }[]; height: number } {
  const positions: { x: number; y: number }[] = [];
  let x = PAD;
  let y = PAD;
  for (const name of names) {
    const wide = 30 + name.length * CHAR;
    if (x > PAD && x + wide > width - PAD) {
      x = PAD;
      y += ROW;
    }
    positions.push({ x, y });
    x += wide + 16;
  }
  return { positions, height: names.length === 0 ? 0 : y + ROW + PAD };
}

/**
 * The chart's SVG with its legend below it, as one picture: the legend of the page is HTML beside the chart, so the file draws its own.
 * Every name is escaped; the colours come from the chart's own palette. Answers the document and its height (the chart's and the legend's).
 */
export function withLegend(
  svg: string,
  width: number,
  height: number,
  background: string,
  text: string,
  entries: readonly LegendEntry[],
): { svg: string; height: number } {
  const plain = { svg: standaloneSvg(svg, width, height, background), height };
  if (entries.length < 2) return plain;
  const source = svg.replace(/^\s*<\?xml[^>]*>\s*/, '');
  const inner = standaloneSvg(source, width, height, 'transparent');
  if (inner === source) return plain;
  const { positions, height: legendHeight } = legendLayout(
    entries.map((entry) => entry.name),
    width,
  );
  const items = entries
    .map((entry, index) => {
      const { x, y } = positions[index]!;
      const middle = height + y + ROW / 2;
      const dash = DASHES[entry.line];
      return (
        `<line x1="${x}" y1="${middle}" x2="${x + 22}" y2="${middle}" stroke="${entry.color}" stroke-width="2"` +
        `${dash ? ` stroke-dasharray="${dash}"` : ''}/>` +
        markerSvg(entry.marker, x + 11, middle, entry.color) +
        `<text x="${x + 30}" y="${middle + 4}" font-size="12" font-family="system-ui, sans-serif" fill="${text}">${escapeXml(entry.name)}</text>`
      );
    })
    .join('');
  const total = height + legendHeight;
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}">` +
      `<rect width="100%" height="100%" fill="${background}"/>${inner}<g>${items}</g></svg>`,
    height: total,
  };
}
