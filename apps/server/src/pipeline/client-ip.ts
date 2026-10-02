import { BlockList, isIP } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/** `::ffff:10.0.0.1` is the IPv4 address 10.0.0.1 as a dual-stack socket reports it. */
function normalise(address: string | undefined): string | undefined {
  const value = address?.trim();
  if (!value) return undefined;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  const candidate = mapped ? mapped[1]! : value;
  return isIP(candidate) === 0 ? undefined : candidate.toLowerCase();
}

function family(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 4 ? 'ipv4' : 'ipv6';
}

export type ClientIpResolver = (c: Context) => string | undefined;

/** The address of the socket the request arrived on; `undefined` where there is no socket (tests). */
function peerAddress(c: Context): string | undefined {
  try {
    return normalise(getConnInfo(c).remote.address);
  } catch {
    return undefined;
  }
}

/**
 * Works out the client's address. `X-Forwarded-For` is read only when the request came from one of
 * the `trusted` proxies (addresses or CIDR ranges, `TRUSTED_PROXIES`); then the list is walked from
 * the right, past every trusted proxy, and the first address that is not a proxy is the client.
 * Anything a client puts at the left of the header is never reached, so it cannot pick its own
 * address. A hop that is not an IP address ends the walk at the last valid one. With no trusted
 * proxies configured, the header is ignored.
 */
export function createClientIpResolver(trusted: readonly string[]): ClientIpResolver {
  const proxies = new BlockList();
  for (const entry of trusted) {
    const [address = '', prefix] = entry.split('/');
    const kind = family(address);
    if (prefix === undefined) proxies.addAddress(address, kind);
    else proxies.addSubnet(address, Number(prefix), kind);
  }
  const isProxy = (address: string) => proxies.check(address, family(address));

  return (c) => {
    const peer = peerAddress(c);
    if (peer === undefined || !isProxy(peer)) return peer;
    const hops = (c.req.header('x-forwarded-for') ?? '').split(',');
    let client = peer;
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = normalise(hops[i]);
      if (hop === undefined) break;
      client = hop;
      if (!isProxy(hop)) break;
    }
    return client;
  };
}
