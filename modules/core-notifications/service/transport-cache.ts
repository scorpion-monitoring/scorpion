// One built transport per registry id, rebuilt when it could be stale (ADR 0020).
//
// A transport holds what it read from the settings and the secrets store when it was built. It is
// rebuilt when (1) the settings it uses are different from the ones it was built from (the
// settings port caches for 5 s, ADR 0017, so a change made by another process shows here within
// that bound), (2) it is older than the TTL (5 s: a secret changed by another process has no other
// way to be noticed), or (3) `invalidate()` was called, which the handlers of `settings.changed@1`
// and `settings.secret.changed@1` do at once in the process that hears the event.
import type { Logger } from '@scorpion/kernel';
import type { NotificationSettings } from '../settings-schema.ts';
import { TransportError, type Transport, type TransportEntry } from './transports/types.ts';

/** The bound, in ms, for a change in another process to reach this one. Same as the settings port. */
export const TRANSPORT_TTL_MS = 5_000;

export interface TransportCacheOptions {
  entries: ReadonlyMap<string, TransportEntry>;
  settings: () => Promise<NotificationSettings>;
  secret: (name: string) => Promise<string | undefined>;
  log: Logger;
  ttlMs?: number;
  now?: () => number;
}

export interface TransportCache {
  /** The transport with this id, built from the current settings. `TransportError('unknown-transport')` for an id nobody registered. */
  get(id: string): Promise<Transport>;
  /** Forget everything built so far; the next `get` rebuilds. */
  invalidate(): void;
  /** Closes every transport (shutdown, tests). */
  close(): void;
}

interface Built {
  transport: Transport;
  fingerprint: string;
  builtAt: number;
  generation: number;
}

export function createTransportCache(options: TransportCacheOptions): TransportCache {
  const ttl = options.ttlMs ?? TRANSPORT_TTL_MS;
  const now = options.now ?? Date.now;
  const built = new Map<string, Built>();
  const building = new Map<string, Promise<Built>>();
  let generation = 0;

  const fingerprintOf = (settings: NotificationSettings) =>
    JSON.stringify([settings.smtp, settings.webhook]);

  return {
    async get(id) {
      const entry = options.entries.get(id);
      if (!entry) throw new TransportError('unknown-transport');
      const settings = await options.settings();
      const fingerprint = fingerprintOf(settings);
      const current = built.get(id);
      if (
        current &&
        current.fingerprint === fingerprint &&
        current.generation === generation &&
        now() - current.builtAt < ttl
      ) {
        return current.transport;
      }
      const key = `${id}:${fingerprint}:${generation}`;
      let pending = building.get(key);
      if (!pending) {
        const startedAt = now();
        const forGeneration = generation;
        pending = (async () => {
          const transport = await entry.create({ settings, secret: options.secret });
          return { transport, fingerprint, builtAt: startedAt, generation: forGeneration };
        })().finally(() => building.delete(key));
        building.set(key, pending);
      }
      const next = await pending;
      if (current && current.transport !== next.transport) current.transport.close?.();
      built.set(id, next);
      return next.transport;
    },
    invalidate() {
      generation += 1;
    },
    close() {
      for (const entry of built.values()) entry.transport.close?.();
      built.clear();
    },
  };
}
