// A zip file with no dependency: deflate for every entry, one fixed time stamp (1980-01-01), entries in the order given. The same files give
// the same bytes, so the release asset of one commit never differs from another build of it.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Forward slashes, no leading slash, no `..`. */
  path: string;
  data: Buffer;
}

// 1980-01-01 00:00:00 in DOS format: date 0x0021 (year 0, month 1, day 1), time 0.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const FLAGS = 0x0800; // the names are UTF-8

function check(path: string) {
  if (
    path === '' ||
    path.startsWith('/') ||
    path.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`zip: "${path}" is not a safe relative path`);
  }
}

export function zip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    check(entry.path);
    const name = Buffer.from(entry.path, 'utf8');
    const packed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(FLAGS, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt16LE(DOS_TIME, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(entry.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Reads a zip made by `zip()` (and any zip that uses deflate or no compression and no data descriptors). For tests and for a check of the asset. */
export function unzip(bytes: Buffer): ZipEntry[] {
  const endAt = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('unzip: not a zip file');
  const count = bytes.readUInt16LE(endAt + 10);
  let at = bytes.readUInt32LE(endAt + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('unzip: a broken directory');
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const packedSize = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localAt = bytes.readUInt32LE(at + 42);
    const path = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt =
      localAt + 30 + bytes.readUInt16LE(localAt + 26) + bytes.readUInt16LE(localAt + 28);
    const packed = bytes.subarray(dataAt, dataAt + packedSize);
    const data = method === 8 ? inflateRawSync(packed) : Buffer.from(packed);
    if (crc32(data) !== crc) throw new Error(`unzip: the checksum of ${path} does not match`);
    entries.push({ path, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
