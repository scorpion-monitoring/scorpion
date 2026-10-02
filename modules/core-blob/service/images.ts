// Turns an upload into what is stored. Nothing the client sent survives unchanged:
//  - a raster is decoded and written again by sharp, so metadata (EXIF, GPS, ICC, text chunks),
//    trailing bytes and polyglot payloads are gone, and it is scaled down to `maxDimension`;
//  - an SVG is parsed and rebuilt by DOMPurify without script, foreignObject, style, animation or
//    any reference that leaves the file (packages/sanitize).
// The header of a raster is checked against the pixel limit before anything is decoded.
import { Invalid } from '@scorpion/contracts';
import { InvalidSvg, sanitizeSvg } from '@scorpion/sanitize';
import sharp from 'sharp';
import { MIME_OF, sniff, type Sniffed } from './sniff.ts';
import type { BlobSettings } from '../settings-schema.ts';

// No file cache: uploads are processed once and the process must not keep pixels around.
sharp.cache(false);

export interface Processed {
  data: Buffer;
  mime: string;
}

const refuse = (message: string) =>
  new Invalid('The file is not acceptable.', [{ in: 'body', path: 'file', message }]);
const megabytes = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;

/** The raster formats that are stored, and the format each is written as (a GIF becomes a PNG). */
const RASTER_FORMAT = { png: 'png', jpeg: 'jpeg', webp: 'webp', gif: 'gif' } as const;

async function processRaster(
  bytes: Buffer,
  kind: Exclude<Sniffed, 'svg'>,
  settings: BlobSettings,
): Promise<Processed> {
  const input = sharp(bytes, {
    limitInputPixels: settings.maxPixels,
    failOn: 'error',
    animated: false,
  });
  try {
    const meta = await input.metadata();
    if (meta.format !== RASTER_FORMAT[kind])
      throw refuse('The file is not the kind of image it looks like.');
    if (!meta.width || !meta.height) throw refuse('The image has no size.');
    if (meta.width * meta.height > settings.maxPixels) {
      throw refuse(`The image has more than ${settings.maxPixels.toLocaleString('en')} pixels.`);
    }
    // `rotate()` applies the EXIF orientation, so dropping the metadata does not turn the picture.
    const pipeline = input.rotate().resize({
      width: settings.maxDimension,
      height: settings.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const out =
      kind === 'jpeg'
        ? pipeline.jpeg({ quality: 85 })
        : kind === 'webp'
          ? pipeline.webp({ quality: 85 })
          : pipeline.png({ compressionLevel: 9 }); // a GIF keeps its first frame, as a PNG
    return { data: await out.toBuffer(), mime: MIME_OF[kind === 'gif' ? 'png' : kind] };
  } catch (error) {
    if (error instanceof Invalid) throw error;
    // sharp's messages name internals ("Input buffer has corrupt header"); say what the person can act on.
    throw refuse(
      /pixel limit/i.test(String((error as Error).message))
        ? `The image has more than ${settings.maxPixels.toLocaleString('en')} pixels.`
        : 'The file is damaged or is not an image this server can read.',
    );
  }
}

function processSvg(bytes: Buffer): Processed {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw refuse('The SVG is not valid UTF-8 text.');
  }
  try {
    return { data: Buffer.from(sanitizeSvg(text), 'utf8'), mime: MIME_OF.svg };
  } catch (error) {
    if (error instanceof InvalidSvg) throw refuse('The file is not a usable SVG image.');
    throw error;
  }
}

/**
 * Checks and rewrites an upload. `Invalid` (422) for a file that is empty, too big, not an image, or
 * damaged; the message says what to change and never repeats the content.
 */
export async function processUpload(bytes: Uint8Array, settings: BlobSettings): Promise<Processed> {
  if (bytes.byteLength === 0) throw refuse('The file is empty.');
  if (bytes.byteLength > settings.maxBytes) {
    throw refuse(`The file is larger than ${megabytes(settings.maxBytes)}.`);
  }
  const kind = sniff(bytes);
  if (!kind) throw refuse('Only PNG, JPEG, WebP, GIF and SVG images are accepted.');
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const processed =
    kind === 'svg' ? processSvg(buffer) : await processRaster(buffer, kind, settings);
  if (processed.data.byteLength > settings.maxBytes) {
    throw refuse(
      `The image is larger than ${megabytes(settings.maxBytes)} after it was prepared for storage.`,
    );
  }
  return processed;
}
