// A small valid PNG made without an image library, for tests that upload a file through a module
// that stores it (an avatar). Different sizes give different files, so a test can tell two uploads apart.
import { deflateSync } from 'node:zlib';

const table = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes: Buffer) => {
  let c = -1;
  for (const byte of bytes) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A `size` x `size` RGB PNG of one colour. */
export function makePng(size = 8, colour: [number, number, number] = [10, 120, 200]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill(colour).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The text that {@link makeJpegWithExif} hides in the EXIF block. */
export const JPEG_EXIF_MARK = 'SECRET-OWNER-MARK';

/**
 * A 16 x 16 JPEG whose EXIF block carries {@link JPEG_EXIF_MARK} as the copyright, for the test that a
 * stored file has no metadata. A constant (made once with sharp), so no test package needs sharp.
 */
export function makeJpegWithExif(): Buffer {
  return Buffer.from(
    '/9j/4QDaRXhpZgAASUkqAAgAAAAHABIBAwABAAAAAQAAABoBBQABAAAAYgAAABsBBQABAAAAagAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAJiCAgASAAAAcgAAAGmHBAABAAAAhAAAAAAAAAA4YwAA6AMAADhjAADoAwAAU0VDUkVULU9XTkVSLU1BUksABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAABAAAAADoAQAAQAAABAAAAAAAAAA/9sAQwAQCwwODAoQDg0OEhEQExgoGhgWFhgxIyUdKDozPTw5Mzg3QEhcTkBEV0U3OFBtUVdfYmdoZz5NcXlwZHhcZWdj/9sAQwEREhIYFRgvGhovY0I4QmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj/8AAEQgAEAAQAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAF/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABUBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AjgAqh//Z',
    'base64',
  );
}
