import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('GET /healthz', () => {
  it('reports ok and the active profile', async () => {
    const res = await createApp({ profile: 'kpi-tracker' }).request('/healthz');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', profile: 'kpi-tracker' });
  });

  it('does not answer other routes', async () => {
    const res = await createApp({ profile: 'full' }).request('/');
    expect(res.status).toBe(404);
  });
});
