// The two halves of the pages of core.notifications must agree: `routes.ts` says who may open a path (the server),
// `index.ts` says what is shown there (the web app). The pages need a permission the module declares, and
// every text exists in every shipped language.
import { ApiError } from '@scorpion/contracts/client';
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import routes, { messages } from './index.ts';
import { loadStatus } from './loaders.ts';
import { NOTIFICATION_NAV, NOTIFICATION_ROUTES } from './routes.ts';

describe('the pages of core.notifications', () => {
  it('are the same paths in the server half and the browser half', () => {
    expect(routes.map((route) => route.path).sort()).toEqual(
      NOTIFICATION_ROUTES.map((route) => route.path).sort(),
    );
  });

  it('are contributed to the registries of the shell, as the manifest says', () => {
    expect(manifest.contributes?.['ui.routes']).toEqual(NOTIFICATION_ROUTES);
    expect(manifest.contributes?.['ui.nav']).toEqual(NOTIFICATION_NAV);
    expect(typeof manifest.ui).toBe('function');
  });

  it('need a permission the module declares, and none is public', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    for (const route of NOTIFICATION_ROUTES) {
      expect(route.public, route.path).toBeFalsy();
      expect(declared.has(route.permission!), route.path).toBe(true);
    }
  });

  it('have a navigation entry only for a page of the module, with the permission of that page and a text', () => {
    const byPath = new Map(NOTIFICATION_ROUTES.map((route) => [route.path, route.permission]));
    for (const entry of NOTIFICATION_NAV) {
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
    const own = [...used].filter((key) => /^(admin\.notifications|nav\.admin)\./.test(key));
    expect(own.filter((key) => !known.has(key))).toEqual([]);
    expect(own.length).toBeGreaterThan(30);
  });
});

describe('the loader', () => {
  const answer = (data: unknown, status = 200) =>
    Promise.resolve(
      status < 400
        ? { data, response: new Response(null, { status }) }
        : { error: { title: 'x', status }, response: new Response(null, { status }) },
    );
  const status = {
    emailTransport: 'none',
    transportIsNone: true,
    webhookEnabled: false,
    counts: { queued: 0, sending: 0, sent: 0, dead: 1 },
    sentWithoutTransport: 3,
    lastErrors: [],
  };
  const list = {
    metadata: { currentPage: 0, pageSize: 20, totalCount: 1, totalPages: 1 },
    result: [{ id: 'd' }],
  };
  const apiOf = (deliveries: object | number, seen: unknown[] = []) =>
    ({
      GET: (path: string, options?: unknown) => {
        seen.push([path, options]);
        if (path === '/notifications/status') return answer(status);
        return typeof deliveries === 'number' ? answer(undefined, deliveries) : answer(deliveries);
      },
    }) as never;
  const context = (api: never, query = '') =>
    ({ api, params: {}, url: new URL(`https://x.test/admin/notifications?${query}`) }) as never;

  it('sends the filters of the address to the API', async () => {
    const seen: unknown[] = [];
    const data = await loadStatus(context(apiOf(list, seen), 'status=dead&channel=sms'));
    expect(data.query).toMatchObject({ status: 'dead', channel: undefined });
    expect(data.deliveries).toEqual({ rows: [{ id: 'd' }], total: 1 });
    expect(seen).toContainEqual([
      '/notifications/deliveries',
      { params: { query: { page: '0', pageSize: '20', status: 'dead' } } },
    ]);
  });

  it('shows the counts without a list when the caller may not list deliveries, and fails for any other error', async () => {
    expect((await loadStatus(context(apiOf(403)))).deliveries).toBeNull();
    await expect(loadStatus(context(apiOf(500)))).rejects.toBeInstanceOf(ApiError);
  });
});
