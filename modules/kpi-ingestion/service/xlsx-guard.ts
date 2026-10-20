// The guard in front of the XLSX reader (ADR-0041 decision 2, plan §7 item 4). `read-excel-file` has no inflation cap: a 63 kB
// zip bomb that inflates to 60 MB ran for 60 s and ended in a stack overflow. The reader is therefore only ever called with
// bytes that passed this function. Two stages, both before the reader sees the file:
//
//  1. the end-of-central-directory record and the central directory, read without inflating anything: refuse what is not a
//     zip (or is a password-protected workbook, which Office stores as an OLE2 file), what has too many entries, an
//     encrypted entry, or declared uncompressed sizes that add up to more than the cap;
//  2. a declared size can lie, so inflate with the streaming `Unzip` of `fflate` in slices of 4 KiB of input (one slice
//     inflates to at most about 4 MB) and count the real output; stop as soon as the count passes the cap.
//
// Pure apart from the inflating, which writes nothing and keeps no output. Nothing here throws on bad input: every failure is a
// code, and the sentence for a person is `describeGuardFailure`.
import { Unzip, UnzipInflate } from 'fflate';

/** The most an XLSX may inflate to (the plan: 20 MiB). */
export const MAX_INFLATED_BYTES = 20 * 1024 * 1024;
/** The most entries a workbook zip holds (a normal one has 10 to 20). */
export const MAX_ZIP_ENTRIES = 1000;
/** Input slice for the bounded count: one slice inflates to at most about 4 MB (deflate's ratio is at most 1032:1). */
const SLICE = 4096;

export type GuardCode =
  | 'not-a-zip'
  | 'encrypted'
  | 'zip64'
  | 'corrupt'
  | 'too-many-entries'
  | 'declared-too-large'
  | 'inflated-too-large';

export type GuardResult = { ok: true; inflated: number } | { ok: false; code: GuardCode };

export interface GuardLimits {
  maxInflatedBytes?: number;
  maxEntries?: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** The sentences for a person; they never repeat anything from the file. */
export function describeGuardFailure(code: GuardCode): string {
  switch (code) {
    case 'not-a-zip':
      return 'The file is not an XLSX workbook (it may be cut short, or another kind of file).';
    case 'encrypted':
      return 'The workbook is password-protected or encrypted; save it without a password and upload it again.';
    case 'zip64':
      return 'The workbook uses an archive format that is not accepted here.';
    case 'corrupt':
      return 'The workbook is damaged and cannot be read.';
    case 'too-many-entries':
      return 'The workbook holds too many parts to be a normal spreadsheet.';
    case 'declared-too-large':
    case 'inflated-too-large':
      return 'The workbook is too large when unpacked (at most 20 MiB).';
  }
}

/** Reads the central directory: counts, sizes and flags, never the data. */
function scan(bytes: Uint8Array, limits: Required<GuardLimits>): GuardResult | { entries: number } {
  if (bytes.length < 22) return { ok: false, code: 'not-a-zip' };
  if (OLE2.every((byte, i) => bytes[i] === byte)) return { ok: false, code: 'encrypted' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end record is in the last 22 + 65 535 bytes (a comment of up to 64 kB follows its fixed part).
  let eocd = -1;
  for (let i = bytes.length - 22, stop = Math.max(0, bytes.length - 22 - 0xffff); i >= stop; i--)
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) return { ok: false, code: 'not-a-zip' };

  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryAt = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryAt === 0xffffffff)
    return { ok: false, code: 'zip64' };
  if (entries === 0) return { ok: false, code: 'not-a-zip' };
  if (entries > limits.maxEntries) return { ok: false, code: 'too-many-entries' };
  if (directoryAt + directorySize > eocd) return { ok: false, code: 'corrupt' };

  let at = directoryAt;
  let declared = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL)
      return { ok: false, code: 'corrupt' };
    const flags = view.getUint16(at + 8, true);
    // Bit 0: encrypted; bit 6: strong encryption.
    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0) return { ok: false, code: 'encrypted' };
    const uncompressed = view.getUint32(at + 24, true);
    if (uncompressed === 0xffffffff) return { ok: false, code: 'zip64' };
    declared += uncompressed;
    if (declared > limits.maxInflatedBytes) return { ok: false, code: 'declared-too-large' };
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  if (at > eocd) return { ok: false, code: 'corrupt' };
  return { entries };
}

/**
 * Whether `bytes` may go to the XLSX reader. On success `inflated` is the real size of everything inside (what the second
 * stage counted), which is what the reader will allocate at most.
 */
export function guardXlsx(bytes: Uint8Array, limits: GuardLimits = {}): GuardResult {
  const full = {
    maxInflatedBytes: limits.maxInflatedBytes ?? MAX_INFLATED_BYTES,
    maxEntries: limits.maxEntries ?? MAX_ZIP_ENTRIES,
  };
  let scanned: ReturnType<typeof scan>;
  try {
    scanned = scan(bytes, full);
  } catch {
    return { ok: false, code: 'corrupt' };
  }
  if ('ok' in scanned) return scanned;

  // Stage 2: the real output, counted while inflating in small slices.
  let inflated = 0;
  let failure: GuardCode | undefined;
  const unzip = new Unzip((file) => {
    if (failure) return;
    file.ondata = (error, chunk) => {
      if (failure) return;
      if (error) {
        failure = 'corrupt';
        return;
      }
      inflated += chunk.length;
      if (inflated > full.maxInflatedBytes) {
        failure = 'inflated-too-large';
        file.terminate();
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let from = 0; from < bytes.length && !failure; from += SLICE)
      unzip.push(
        bytes.subarray(from, Math.min(from + SLICE, bytes.length)),
        from + SLICE >= bytes.length,
      );
  } catch {
    failure ??= 'corrupt';
  }
  if (failure) return { ok: false, code: failure };
  return { ok: true, inflated };
}
