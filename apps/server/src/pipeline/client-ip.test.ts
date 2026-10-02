import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { createClientIpResolver } from './client-ip.ts';

/** Just what the resolver reads: the socket's address and the forwarding header. */
function request(peer: string | undefined, forwardedFor?: string): Context {
  return {
    env: peer === undefined ? {} : { incoming: { socket: { remoteAddress: peer } } },
    req: { header: (name: string) => (name === 'x-forwarded-for' ? forwardedFor : undefined) },
  } as unknown as Context;
}

describe('the client address', () => {
  it.each<[string, string[], string | undefined, string | undefined, string | undefined]>([
    // [case, trusted proxies, socket peer, X-Forwarded-For, result]
    ['the socket address, with no proxies configured', [], '203.0.113.7', undefined, '203.0.113.7'],
    ['ignores the header with no proxies configured', [], '203.0.113.7', '1.2.3.4', '203.0.113.7'],
    [
      'ignores the header from a peer that is not a proxy',
      ['10.0.0.1'],
      '203.0.113.7',
      '1.2.3.4',
      '203.0.113.7',
    ],
    [
      'reads the header from a trusted proxy',
      ['10.0.0.1'],
      '10.0.0.1',
      '198.51.100.9',
      '198.51.100.9',
    ],
    ['matches a proxy by CIDR range', ['10.0.0.0/8'], '10.9.8.7', '198.51.100.9', '198.51.100.9'],
    [
      'takes the right-most address that is not a proxy',
      ['10.0.0.1'],
      '10.0.0.1',
      '6.6.6.6, 198.51.100.9',
      '198.51.100.9',
    ],
    [
      'walks past a chain of proxies',
      ['10.0.0.0/8'],
      '10.0.0.1',
      '198.51.100.9, 10.0.0.5, 10.0.0.6',
      '198.51.100.9',
    ],
    [
      'cannot be steered by what a client writes at the left',
      ['10.0.0.1'],
      '10.0.0.1',
      '1.1.1.1, 2.2.2.2, 198.51.100.9',
      '198.51.100.9',
    ],
    [
      'falls back to the proxy when the header is missing',
      ['10.0.0.1'],
      '10.0.0.1',
      undefined,
      '10.0.0.1',
    ],
    [
      'stops at a hop that is not an address',
      ['10.0.0.1'],
      '10.0.0.1',
      'garbage, 10.0.0.5',
      '10.0.0.5',
    ],
    ['stops at a hop with a port', ['10.0.0.1'], '10.0.0.1', '198.51.100.9:443', '10.0.0.1'],
    [
      'takes the leftmost when every hop is a proxy',
      ['10.0.0.0/8'],
      '10.0.0.1',
      '10.0.0.3, 10.0.0.2',
      '10.0.0.3',
    ],
    [
      'reads IPv4 as the dual-stack socket reports it',
      ['10.0.0.1'],
      '::ffff:10.0.0.1',
      '198.51.100.9',
      '198.51.100.9',
    ],
    ['handles IPv6 clients and proxies', ['fd00::/8'], 'fd00::1', '2001:db8::5', '2001:db8::5'],
    ['has no address without a socket', ['10.0.0.1'], undefined, '198.51.100.9', undefined],
  ])('%s', (_case, trusted, peer, forwarded, expected) => {
    expect(createClientIpResolver(trusted)(request(peer, forwarded))).toBe(expected);
  });
});
