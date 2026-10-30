// The demo data (`scorpion seed --demo`, ADR-0046) is data the public API v1 can serve: after a seed, every v1 list answers
// 200 with a body that matches the schema its route declares (the one the OpenAPI document describes), and the rows are
// the fictional ones. The KB's documented `curl` examples run against such an instance.
import { listCategoriesV1Route, listIndicatorsV1Route } from '@scorpion/kpi-framework/public';
import { listMeasurementsV1Route } from '@scorpion/kpi-ingestion/public';
import { listProvidersV1Route } from '@scorpion/registry-organisations/public';
import { listServicesV1Route } from '@scorpion/registry-services/public';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
let token = '';

const SCOPES = [
  'registry.organisations.v1.read',
  'registry.services.v1.read',
  'kpi.framework.v1.read',
  'kpi.ingestion.v1.read',
];

beforeAll(async () => {
  started = await app.start({ publicApi: true, kpi: true, ingestion: true });
  await started.kernel.runDemoSeed(
    { password: 'zebra cloud violin harvest 42' },
    { out: () => {} },
  );
  // The demo administrator makes the token, as the documentation would.
  const admin = await started.signedIn('someone-else');
  const reply = await started.post('/tokens', {
    ...admin,
    body: { name: 'demo-reader', scopes: SCOPES },
  });
  expect(reply.status).toBe(201);
  token = (reply.body as { token: string }).token;
}, 120_000);

const get = (path: string) =>
  started.getV1(path, { headers: { authorization: `Bearer ${token}` } });

/** The schema the route declares for a 200, which is what the generated OpenAPI document describes. */
function schemaOf(route: { responses: Record<number, unknown> }) {
  const response = route.responses[200] as {
    content: { 'application/json': { schema: { parse: (value: unknown) => unknown } } };
  };
  return response.content['application/json'].schema;
}

describe.each([
  ['/providers', listProvidersV1Route, 3],
  ['/services', listServicesV1Route, 4],
  ['/categories', listCategoriesV1Route, 1],
  ['/indicators', listIndicatorsV1Route, 5],
] as const)('GET %s on a seeded instance', (path, route, total) => {
  it('answers 200 with the schema of its route and the demo rows', async () => {
    const reply = await get(`${path}?pageSize=100`);
    expect(reply.status).toBe(200);
    const body = schemaOf(route).parse(reply.body) as {
      metadata: { totalCount: number };
    };
    expect(body.metadata.totalCount).toBe(total);
  });
});

describe('the demo measurements', () => {
  it('are listed for a demo service and match the schema of the route', async () => {
    const services = (await get('/services?pageSize=100')).body as {
      result: { id: string; name: string }[];
    };
    const seqflow = services.result.find((row) => row.name === 'SeqFlow')!;
    const reply = await get(`/measurements?service=${seqflow.id}&pageSize=100`);
    expect(reply.status).toBe(200);
    const body = schemaOf(listMeasurementsV1Route).parse(reply.body) as {
      metadata: { totalCount: number };
    };
    expect(body.metadata.totalCount).toBe(5 * 6);
  });
});

describe('the demo data is fictional', () => {
  it('names no real address: every URL and email is on a reserved domain', async () => {
    const text = JSON.stringify([
      (await get('/providers?pageSize=100')).body,
      (await get('/services?pageSize=100')).body,
    ]);
    const hosts = [...text.matchAll(/https?:\/\/([^/"\\\s]+)/g)].map((match) => match[1]);
    const mails = [...text.matchAll(/[\w.+-]+@([\w.-]+)/g)].map((match) => match[1]);
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of [...hosts, ...mails]) {
      expect(host, host).toMatch(/(^|\.)(example\.org|invalid)$/);
    }
  });
});
