// The OpenAPI document of the export is the one the running API serves (ADR-0047): the `full` profile's document, as `GET /api/v1/openapi.json` answers
// with the default settings, apart from the `servers` entry that is the address of the request.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportFiles } from './docs-export/run.ts';
import { useIdentityApp } from './testing/identity-app.ts';

const root = resolve(import.meta.dirname, '../../..');
const app = useIdentityApp({ shared: true });

describe('openapi.json of the docs export', () => {
  it('is what GET /api/v1/openapi.json serves, without its servers', async () => {
    const started = await app.start({
      publicApi: true,
      kpi: true,
      ingestion: true,
      analytics: true,
    });
    const served = await started.getV1('/openapi.json');
    expect(served.status).toBe(200);
    const live = { ...(served.body as Record<string, unknown>) };
    expect(live.servers).toBeDefined();
    delete live.servers;
    const files = await exportFiles({ root, firstRelease: () => null });
    expect(JSON.parse(files.get('openapi/full.json')!.toString('utf8'))).toEqual(live);
    expect(files.get('openapi.json')!.equals(files.get('openapi/full.json')!)).toBe(true);
  });
});
