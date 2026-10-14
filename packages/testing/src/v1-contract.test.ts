// The walker's own tests: which routes it reports, and which files it reads.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findContractTestFiles, pathOf, v1RoutesWithoutContractTest } from './v1-contract.ts';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'v1-walker-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}
const routes: { method: 'get' | 'post'; path: string }[] = [
  { method: 'get', path: '/providers' },
  { method: 'get', path: '/services/{id}' },
  { method: 'post', path: '/measurements' },
];

describe('v1RoutesWithoutContractTest()', () => {
  it('reports a route that no contract-test file names, sorted', () => {
    const root = tree({
      'a/providers.contract.test.ts': "v1ContractTests(listProviders, ctx); // 'GET /providers'",
      'b/node_modules/x/ignored.contract.test.ts': "v1ContractTests(x); 'POST /measurements'",
    });
    const files = findContractTestFiles([root]);
    expect(files).toHaveLength(1);
    expect(v1RoutesWithoutContractTest(routes, files)).toEqual([
      'GET /services/{id}',
      'POST /measurements',
    ]);
  });

  it('does not count a file that names the route but never calls the harness, or a route in a comment-free name clash', () => {
    const root = tree({
      'a/x.contract.test.ts': "it('GET /providers', () => {}); // no harness call here",
      'b/y.contract.test.ts': "v1ContractTests(r, c); 'GET /providers/{id}'",
    });
    expect(v1RoutesWithoutContractTest(routes, findContractTestFiles([root]))).toEqual([
      'GET /providers',
      'GET /services/{id}',
      'POST /measurements',
    ]);
  });

  it('is empty when every route is covered', () => {
    const root = tree({
      'a.contract.test.ts':
        "v1ContractTests(a, c); 'GET /providers'; 'GET /services/{id}'; \"POST /measurements\"",
    });
    expect(v1RoutesWithoutContractTest(routes, findContractTestFiles([root]))).toEqual([]);
  });
});

describe('pathOf()', () => {
  it('fills the parameters (encoded) and appends the query', () => {
    const ctx = {
      call: () => Promise.reject(new Error('unused')),
      token: '',
      tokenWithoutScope: '',
    };
    expect(
      pathOf({ path: '/services/{id}' }, { ...ctx, params: { id: 'a b/c' } }, { page: '1' }),
    ).toBe('/services/a%20b%2Fc?page=1');
    expect(pathOf({ path: '/providers' }, ctx)).toBe('/providers');
    expect(() => pathOf({ path: '/services/{id}' }, ctx)).toThrow(/no value for \{id\}/);
  });
});
