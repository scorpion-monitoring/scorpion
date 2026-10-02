// What a file really is, from its first bytes. The type the client claims (the `Content-Type` of the
// request, the file name) is never looked at: it is the attacker's to choose.

export type Sniffed = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg';

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * The kind of file `bytes` look like, or `undefined`. This only decides which processor gets the
 * file; the processor then has to agree (sharp decodes the raster, the sanitiser parses the SVG),
 * so a file that merely starts like an image is refused later.
 */
export function sniff(bytes: Uint8Array): Sniffed | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // GIF87a / GIF89a
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'gif';
  }
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'webp';
  }
  // SVG is text: after an optional BOM, whitespace, prolog, doctype and comments comes `<svg`.
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('utf8').replace(/^﻿/, '');
  const withoutPreamble = head
    .replace(/^\s+/, '')
    .replace(
      /^(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>\s*)+/i,
      '',
    );
  if (/^<svg[\s>/]/i.test(withoutPreamble)) return 'svg';
  return undefined;
}

/** The MIME type a stored file is served with. Fixed: never taken from the upload. */
export const MIME_OF: Record<Sniffed, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
