// The walker of M8: every v1 route of the full profile has a contract test (`*.contract.test.ts` that calls
// `v1ContractTests()` and names the route). The walker for the internal API is response-fields.test.ts.
import { resolve } from 'node:path';
import { findContractTestFiles, v1RoutesWithoutContractTest } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { collectRoutes } from './collect-routes.ts';
import { sources } from './generated/profile.ts';

describe('every v1 route has a contract test', () => {
  it('lists no route of the generated profile without one', () => {
    const { v1 } = collectRoutes(sources.map((source) => source.manifest));
    const root = resolve(import.meta.dirname, '../../..');
    const files = findContractTestFiles([
      resolve(root, 'apps/server/src'),
      resolve(root, 'modules'),
    ]);
    expect(v1.length).toBeGreaterThan(0);
    expect(v1RoutesWithoutContractTest(v1, files)).toEqual([]);
  });
});
