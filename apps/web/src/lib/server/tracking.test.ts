import type { ApiClient } from '@scorpion/contracts/client';
import { describe, expect, it, vi } from 'vitest';
import { createTrackingOrigin } from './tracking.ts';

const answering = (...answers: (() => Promise<unknown>)[]) => {
  const GET = vi.fn();
  for (const answer of answers) GET.mockImplementationOnce(answer);
  return { api: { GET } as unknown as ApiClient, GET };
};
const ok = (body: unknown) => () =>
  Promise.resolve({ data: body, error: undefined, response: new Response() });
const status = (code: number) => () =>
  Promise.resolve({ data: undefined, error: {}, response: new Response(null, { status: code }) });
const down = () => Promise.reject(new TypeError('fetch failed'));

describe('createTrackingOrigin()', () => {
  it('gives the origin of the Matomo address while tracking is on', async () => {
    const { api } = answering(
      ok({
        enabled: true,
        url: 'https://example.org/matomo/',
        siteId: 1,
        cookieless: true,
        respectDoNotTrack: true,
      }),
    );
    expect(await createTrackingOrigin(api)()).toBe('https://example.org');
  });

  it('gives null when tracking is off, the profile has no module, or the API fails', async () => {
    for (const answer of [ok({ enabled: false }), status(404), status(503), down]) {
      const { api } = answering(answer);
      expect(await createTrackingOrigin(api)()).toBeNull();
    }
  });

  it('asks once per few seconds, and again after that', async () => {
    let now = 0;
    const { api, GET } = answering(ok({ enabled: false }), ok({ enabled: false }));
    const origin = createTrackingOrigin(api, { ttlMs: 5000, now: () => now });
    await Promise.all([origin(), origin(), origin()]);
    now = 4999;
    await origin();
    expect(GET).toHaveBeenCalledTimes(1);
    now = 5000;
    await origin();
    expect(GET).toHaveBeenCalledTimes(2);
  });
});
