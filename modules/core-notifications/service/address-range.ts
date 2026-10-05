// Which IP addresses a webhook may be sent to (ADR 0020). Written in-house, no dependency. The rule
// is "public unicast only": everything that is loopback, private, link-local, unique-local, shared,
// multicast, documentation, reserved or a cloud metadata address is refused, in IPv4, IPv6 and the
// IPv4 forms inside IPv6 (mapped, NAT64, 6to4, compatible). A form we cannot parse is refused.
import { isIP } from 'node:net';

export type RefusalReason =
  | 'invalid'
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'metadata'
  | 'shared'
  | 'unique-local'
  | 'multicast'
  | 'reserved'
  | 'documentation'
  | 'transition';

/** `null` when the address is public and may be connected to, else why not. */
export type Classification = RefusalReason | null;

type V4Rule = { net: number; bits: number; reason: RefusalReason };

const v4 = (a: number, b: number, c: number, d: number) =>
  ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

const V4_RULES: readonly V4Rule[] = [
  { net: v4(0, 0, 0, 0), bits: 8, reason: 'unspecified' },
  { net: v4(10, 0, 0, 0), bits: 8, reason: 'private' },
  { net: v4(100, 64, 0, 0), bits: 10, reason: 'shared' }, // carrier-grade NAT; Alibaba metadata is 100.100.100.200
  { net: v4(127, 0, 0, 0), bits: 8, reason: 'loopback' },
  { net: v4(169, 254, 169, 254), bits: 32, reason: 'metadata' }, // listed first so it is named
  { net: v4(169, 254, 0, 0), bits: 16, reason: 'link-local' },
  { net: v4(172, 16, 0, 0), bits: 12, reason: 'private' },
  { net: v4(192, 0, 0, 0), bits: 24, reason: 'reserved' }, // IETF protocol assignments; Oracle metadata is 192.0.0.192
  { net: v4(192, 0, 2, 0), bits: 24, reason: 'documentation' },
  { net: v4(192, 88, 99, 0), bits: 24, reason: 'transition' },
  { net: v4(192, 168, 0, 0), bits: 16, reason: 'private' },
  { net: v4(198, 18, 0, 0), bits: 15, reason: 'reserved' }, // benchmarking
  { net: v4(198, 51, 100, 0), bits: 24, reason: 'documentation' },
  { net: v4(203, 0, 113, 0), bits: 24, reason: 'documentation' },
  { net: v4(224, 0, 0, 0), bits: 4, reason: 'multicast' },
  { net: v4(240, 0, 0, 0), bits: 4, reason: 'reserved' }, // includes 255.255.255.255
];

function parseV4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null; // no leading zeros: "010" is octal to some stacks
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function classifyV4Number(value: number): Classification {
  for (const rule of V4_RULES) {
    const mask = rule.bits === 0 ? 0 : (~0 << (32 - rule.bits)) >>> 0;
    if ((value & mask) >>> 0 === (rule.net & mask) >>> 0) return rule.reason;
  }
  return null;
}

/** Eight 16-bit groups, or null. Handles `::`, an embedded dotted IPv4 and a zone id. */
function parseV6(input: string): number[] | null {
  let text = input;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const value = parseV4(dotted[1]!);
    if (value === null) return null;
    text = `${text.slice(0, dotted.index)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1]!.split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

const embedded = (high: number, low: number) => ((high << 16) | low) >>> 0;

function classifyV6(g: number[]): Classification {
  const [a, b, c, d, e, f, gg, h] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const firstFiveZero = a === 0 && b === 0 && c === 0 && d === 0 && e === 0;
  if (firstFiveZero && f === 0 && gg === 0 && h === 0) return 'unspecified';
  if (firstFiveZero && f === 0 && gg === 0 && h === 1) return 'loopback';
  // ::ffff:a.b.c.d (mapped) is judged as the IPv4 address it carries.
  if (firstFiveZero && f === 0xffff) return classifyV4Number(embedded(gg, h)) ?? null;
  // NAT64 64:ff9b::/96 carries an IPv4 address; the local-use block 64:ff9b:1::/48 is refused.
  if (a === 0x64 && b === 0xff9b) {
    if (c === 0 && d === 0 && e === 0 && f === 0) {
      return classifyV4Number(embedded(gg, h)); // an IPv6-only host reaches public IPv4 this way
    }
    if (c === 1) return 'transition';
  }
  // The rest of ::/8 (IPv4-compatible ::a.b.c.d, and the reserved block) is refused outright.
  if (a >>> 8 === 0) return 'reserved';
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return 'reserved'; // discard-only 100::/64
  if (a === 0x2001 && b === 0) return 'transition'; // Teredo
  if (a === 0x2001 && b === 0xdb8) return 'documentation';
  if (a === 0x3fff && b < 0x1000) return 'documentation'; // 3fff::/20
  if (a === 0x2001 && b < 0x200) return 'reserved'; // 2001::/23 IETF protocol assignments
  if (a === 0x2002) return classifyV4Number(embedded(b, c)) ?? 'transition'; // 6to4: never public
  if ((a & 0xfe00) === 0xfc00) return 'unique-local'; // fc00::/7, includes fd00:ec2::254
  if ((a & 0xffc0) === 0xfe80) return 'link-local';
  if ((a & 0xffc0) === 0xfec0) return 'private'; // deprecated site-local
  if (a >>> 8 === 0xff) return 'multicast';
  // Global unicast is 2000::/3; everything else is unassigned and refused.
  if (a >>> 13 !== 1) return 'reserved';
  return null;
}

/** Classifies an IP literal (no brackets, no port). Anything that is not an IP literal is `invalid`. */
export function classifyAddress(address: string): Classification {
  const kind = isIP(address);
  if (kind === 4) {
    const value = parseV4(address);
    return value === null ? 'invalid' : classifyV4Number(value);
  }
  if (kind === 6) {
    const groups = parseV6(address);
    return groups ? classifyV6(groups) : 'invalid';
  }
  return 'invalid';
}

export const isPublicAddress = (address: string): boolean => classifyAddress(address) === null;
