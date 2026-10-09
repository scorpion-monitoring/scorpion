// The two halves of the pages of core.audit must agree: `routes.ts` says who may open a path (the server),
// `index.ts` says what is shown there (the web app). The pages need a permission the module declares, and
// every text exists in every shipped language.
import { ApiError } from '@scorpion/contracts/client';
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import routes, { messages } from './index.ts';
import { loadLogEntry, loadLogs, loadSystem } from './loaders.ts';
import { AUDIT_NAV, AUDIT_ROUTES } from './routes.ts';

describe('the pages of core.audit', () => {
  it('are the same paths in the server half and the browser half', () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      AUDIT_ROUTES.map((route) => route.path).sort(),
    );
  });

  it('are contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(AUDIT_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(AUDIT_NAV);
    expect(typeof manifest.ui).toBe('function');
  });

  it('need a permission the module declares, and none is public', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const route of AUDIT_ROUTES) {
      expect(route.public, route.path).toBeFalsy();
      expect(declared.has(route.permission!), route.path).toBe(true);
    }
  });

  it('have a navigation entry only for a page of the module, with the permission of that page and a text', () => {
    const byPath = new Map(AUDIT_ROUTES.map((route) => [route.path, route.permission]));
    for (const entry of AUDIT_NAV) {
      expect(byPath.get(entry.path), entry.id).toBe(entry.permission);
      expect(entry.section).toBe('admin');
      for (const locale of ['en', 'de']) {
        expect(messages[locale]?.[entry.label], `${locale} ${entry.label}`).toBeTruthy();
      }
    }
  });

  it('have every text in English and German, with the same placeholders', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });

  it('have a text for every key the components use', async () => {
    const { globSync, readFileSync } = await import('node:fs');
    const root = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const file of globSync('**/*.svelte', { cwd: root })) {
      const source = readFileSync(`${root}${file}`, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-z][A-Za-z0-9.]*)'/g)) used.add(match[1]!);
      // A key built from a template string: every value the page can put in it must have a text.
      for (const match of source.matchAll(/\bt\(\s*`([a-z][A-Za-z0-9.]*)\.\$\{/g)) {
        const prefix = match[1]!;
        expect(
          Object.keys(messages.en!).filter((key) => key.startsWith(`${prefix}.`)).length,
          prefix,
        ).toBeGreaterThan(0);
      }
    }
    const known = new Set(
      Object.keys(messages.en!).map((key) => key.replace(/\.(one|other)$/, '')),
    );
    const own = [...used].filter((key) => /^(admin\.(logs|system)|nav\.admin)\./.test(key));
    expect(own.filter((key) => !known.has(key))).toEqual([]);
    expect(own.length).toBeGreaterThan(40);
  });
});

describe('the loaders', () => {
  const answer = (data: unknown, status = 200) =>
    Promise.resolve(
      status < 400
        ? { data, response: new Response(null, { status }) }
        : { error: { title: 'x', status }, response: new Response(null, { status }) },
    );
  const apiOf = (answers: Record<string, object | number>, seen: unknown[] = []) =>
    ({
      GET: (path: string, options?: unknown) => {
        seen.push([path, options]);
        const value = answers[path];
        return typeof value === 'number' ? answer(undefined, value) : answer(value);
      },
    }) as never;
  const context = (api: never, query = '', params: Record<string, string> = {}) =>
    ({ api, params, url: new URL(`https://x.test/admin?${query}`) }) as never;
  const list = (result: unknown[]) => ({
    metadata: { currentPage: 0, pageSize: 50, totalCount: result.length, totalPages: 1 },
    result,
  });

  it('send the filters of the address to the API, with the days as the start and the end of the day', async () => {
    const seen: unknown[] = [];
    const api = apiOf({ '/audit': list([]) }, seen);
    const data = await loadLogs(context(api, 'outcome=denied&from=2026-10-01&method=TRACE'));
    expect(data.query).toMatchObject({ outcome: 'denied', from: '2026-10-01', method: undefined });
    expect(seen[0]).toEqual([
      '/audit',
      {
        params: {
          query: {
            outcome: 'denied',
            from: '2026-10-01T00:00:00.000Z',
            page: '0',
            pageSize: '50',
          },
        },
      },
    ]);
  });

  it('throw when the API refuses, instead of returning a response (defect 12)', async () => {
    await expect(loadLogs(context(apiOf({ '/audit': 403 })))).rejects.toBeInstanceOf(ApiError);
    await expect(
      loadLogEntry(context(apiOf({ '/audit/{id}': 404 }), '', { id: 'x' })),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('leave the retention out when the caller may not read the settings, and fail for any other error', async () => {
    const base = {
      '/system/outbox': { stats: { pending: 0, dead: 0, lagSeconds: 0 }, dead: [] },
      '/system/job-runs': list([]),
    };
    const hidden = await loadSystem(context(apiOf({ ...base, '/settings/{module}': 403 })));
    expect(hidden.retention).toBeNull();
    const shown = await loadSystem(
      context(
        apiOf({
          ...base,
          '/settings/{module}': {
            values: { retentionDays: 365, other: 'x', apiRetentionDays: '9' },
          },
        }),
      ),
    );
    expect(shown.retention).toEqual({ retentionDays: 365 });
    await expect(
      loadSystem(context(apiOf({ ...base, '/settings/{module}': 500 }))),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      loadSystem(context(apiOf({ ...base, '/system/outbox': 403, '/settings/{module}': 403 }))),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
