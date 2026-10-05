import { describe, expect, it } from 'vitest';
import { canMove, TRANSITIONS, type DeliveryStatus } from './delivery.ts';

describe('the delivery status machine', () => {
  const all: DeliveryStatus[] = ['queued', 'sending', 'sent', 'dead'];
  const allowed = new Set(['queued>sending', 'sending>sent', 'sending>queued', 'sending>dead']);
  const cases = all.flatMap((from) => all.map((to) => [from, to] as const));
  it.each(cases)('%s → %s', (from, to) => {
    expect(canMove(from, to)).toBe(allowed.has(`${from}>${to}`));
  });
  it('has no way out of sent or dead (a requeue is a later sprint)', () => {
    expect(TRANSITIONS.sent).toEqual([]);
    expect(TRANSITIONS.dead).toEqual([]);
  });
});
