// The contract test of the one v1 route public-api owns: GET /api/v1/openapi.json, through the harness of
// packages/testing. It is public on purpose (ADR-0037), so the harness skips the token cases.
import { specRoute } from '@scorpion/public-api/public';
import { beforeAll } from 'vitest';
import { v1ContractTests, type V1ContractContext } from '@scorpion/testing';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
beforeAll(async () => {
  started = await app.start({ publicApi: true });
});

const call: V1ContractContext['call'] = async ({ method, path, headers }) => {
  const reply = await started.call(method, path, { v1: true, headers });
  return { status: reply.status, headers: reply.res.headers, body: reply.body };
};

// 'GET /openapi.json' is the name the walker looks for (v1RoutesWithoutContractTest).
v1ContractTests(specRoute, {
  call,
  token: '',
  tokenWithoutScope: '',
  publicReason: 'GET /openapi.json is the documentation of the API (ADR-0037)',
});
