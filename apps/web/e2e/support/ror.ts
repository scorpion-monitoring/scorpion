// A valid ROR id that no other test used. A ROR id names one organisation, and the specs of a run share one
// database, so each use takes a fresh one: `0`, six characters of the Crockford base32 alphabet and the two check
// digits (ISO 7064 mod 97-10), which the server verifies.
import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function uniqueRorId(): string {
  let body = '';
  for (let i = 0; i < 6; i += 1) body += ALPHABET[randomInt(ALPHABET.length)];
  let n = 0n;
  for (const char of body) n = n * 32n + BigInt(ALPHABET.indexOf(char));
  return `0${body}${String(98n - ((n * 100n) % 97n)).padStart(2, '0')}`;
}
