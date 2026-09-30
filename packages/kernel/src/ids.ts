import { randomBytes } from 'node:crypto';

let lastMs = 0;
let counter = 0;

/**
 * A UUIDv7 (RFC 9562): 48-bit millisecond timestamp, then a 12-bit counter, then random bits.
 * Ids created by one process sort in creation order, even within the same millisecond, which
 * keeps primary-key indexes append-mostly.
 */
function uuidv7(now: number = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    // Start below the top of the range, so a burst within one millisecond has room to count up.
    counter = randomBytes(2).readUInt16BE() & 0x7ff;
  } else {
    counter += 1;
    if (counter > 0xfff) {
      lastMs += 1;
      counter = 0;
    }
  }

  const bytes = randomBytes(16);
  bytes.writeUIntBE(lastMs, 0, 6);
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const ids = { uuidv7 };
