import { describe, expect, it } from 'vitest';
import {
  csrfTokenFor,
  csrfTokenMatches,
  hashSessionId,
  isSessionIdFormat,
  newSessionId,
} from './session-id.ts';

describe('session ids', () => {
  it('are 256 random bits as 43 URL-safe characters, never repeated', () => {
    const made = new Set(Array.from({ length: 200 }, newSessionId));
    expect(made.size).toBe(200);
    for (const id of made) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(id, 'base64url')).toHaveLength(32);
    }
  });

  it.each([
    ['a fresh id', newSessionId(), true],
    ['empty', '', false],
    ['one character short', newSessionId().slice(1), false],
    ['one character long', `${newSessionId()}a`, false],
    ['padding', `${newSessionId().slice(1)}=`, false],
    ['a space', ` ${newSessionId().slice(1)}`, false],
    ['a quote', `'${newSessionId().slice(1)}`, false],
    ['non-ASCII', `é${newSessionId().slice(2)}`, false],
    ['a newline', `${newSessionId().slice(1)}\n`, false],
  ])('format check: %s', (_name, value, expected) => {
    expect(isSessionIdFormat(value)).toBe(expected);
  });

  it('are stored as a SHA-256 hex hash that does not contain the id', () => {
    const id = newSessionId();
    const hash = hashSessionId(id);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashSessionId(id));
    expect(hash).not.toContain(id);
  });
});

describe('the CSRF token', () => {
  it('belongs to one session, is stable, and is not the stored hash', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(csrfTokenFor(a)).toBe(csrfTokenFor(a));
    expect(csrfTokenFor(a)).not.toBe(csrfTokenFor(b));
    expect(csrfTokenFor(a)).not.toBe(hashSessionId(a));
    // Someone who has read the table (the hash) can still not compute it.
    expect(csrfTokenFor(a)).not.toBe(csrfTokenFor(hashSessionId(a)));
  });

  it.each<[string, (id: string) => string | undefined, boolean]>([
    ['the right token', (id) => csrfTokenFor(id), true],
    ['no token', () => undefined, false],
    ['an empty token', () => '', false],
    ['the session id itself', (id) => id, false],
    ['the token of another session', () => csrfTokenFor(newSessionId()), false],
    ['the token with a character cut off', (id) => csrfTokenFor(id).slice(1), false],
    ['the token with a character added', (id) => `${csrfTokenFor(id)}a`, false],
  ])('matches only %s', (_name, present, expected) => {
    const id = newSessionId();
    expect(csrfTokenMatches(id, present(id))).toBe(expected);
  });
});
