import type { TransportEntry } from './types.ts';

/**
 * Accepts every message and does nothing: a deployment without mail still works, the row is
 * recorded as `sent` with transport `none`, and the status shows it (ADR 0020).
 */
export const noneTransport: TransportEntry = {
  id: 'none',
  channel: 'email',
  create: () => ({ id: 'none', send: () => Promise.resolve() }),
};
