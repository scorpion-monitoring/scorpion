// The service catalogue, rendered on the server with a stand-in for the shell (`ShellHarness.svelte`): what a
// person must never see wrong. Labels come from the API's answer (the vocabulary, the registry, the
// organisation), never from the page; the chosen filters are removable badges; the link to the wizard and to a
// service page appear only when the API says the caller may create and the page is offered; the icon has an
// alt text from the name; an empty answer says so. The address handling is in `query.test.ts` of the module,
// the clicks and the counts changing over the filtered set are in `e2e/services.spec.ts`. The page belongs to
// the module, so it is loaded by path, as in membership-pages.test.ts.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ShellHarness from './test/ShellHarness.svelte';

const offered = vi.hoisted(() => ({ value: false }));
vi.mock('../../../modules/registry-services/ui/offered.ts', () => ({
  isOffered: () => offered.value,
  NOT_OFFERED: [],
}));

const ui = (file: string) =>
  import(
    /* @vite-ignore */ new URL(`../../../modules/registry-services/ui/${file}`, import.meta.url)
      .pathname
  );
const { messages } = (await ui('messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const { DEFAULT_QUERY } = (await ui('query.ts')) as {
  DEFAULT_QUERY: Record<string, unknown>;
};
const Catalogue = ((await ui('Catalogue.svelte')) as { default: Component }).default;

const draw = (data: unknown, locale = 'en') =>
  render(ShellHarness, { props: { page: Catalogue, data, userId: 'me', messages, locale } }).body;

const org = (id: string, abbreviation: string, name = `${abbreviation} institute`) => ({
  id,
  abbreviation,
  name,
});
const row = (over: Record<string, unknown>) => ({
  id: 's-1',
  slug: 'galaxy',
  name: 'Galaxy',
  stage: 'PROD',
  license: 'MIT',
  public: false,
  provider: org('o-1', 'IPK'),
  consortia: [],
  ...over,
});
const facets = [
  {
    id: 'stage',
    label: 'Stage',
    labels: { en: 'Stage' },
    values: [
      { key: 'PROD', label: 'In production', count: 2, selected: false },
      { key: 'DEV', label: 'In development', count: 0, selected: true },
    ],
  },
  {
    id: 'license',
    label: 'Licence',
    labels: { en: 'Licence' },
    values: [
      { key: 'MIT', label: 'MIT', count: 1, selected: false },
      { key: ':none', label: 'Unknown', count: 1, selected: false, empty: true },
    ],
  },
];
const data = (over: Record<string, unknown> = {}) => ({
  query: DEFAULT_QUERY,
  services: [row({})],
  total: 1,
  facets,
  canCreate: false,
  ...over,
});

describe('the catalogue page', () => {
  it('draws a row with its name, provider, consortia as badges and the stage as the label the API gave', () => {
    const html = draw(
      data({
        services: [
          row({
            consortia: [org('c-1', 'NFDI'), org('c-2', 'DNBI', 'de.NBI')],
            iconUrl: '/base/api/internal/files/abc',
          }),
        ],
      }),
    );
    expect(html).toContain('Galaxy');
    expect(html).toContain('IPK institute');
    expect(html).toContain('NFDI');
    expect(html).toContain('DNBI');
    // The stage term PROD is shown as the vocabulary's label, which came with the facet.
    expect(html).toContain('In production');
    expect(html).not.toMatch(/>\s*PROD\s*</);
  });

  it('gives the icon an alt text from the name of the service, and draws none for a service without one', () => {
    const html = draw(
      data({
        services: [
          row({ iconUrl: '/base/api/internal/files/abc' }),
          row({ id: 's-2', slug: 'other', name: 'Other' }),
        ],
        total: 2,
      }),
    );
    expect(html).toContain('src="/base/api/internal/files/abc"');
    expect(html).toContain('alt="Icon of Galaxy"');
    expect([...html.matchAll(/<img\b/g)]).toHaveLength(1);
  });

  it('draws the facets from the API with their labels and counts, and the services with none under the label the API gave', () => {
    const html = draw(data());
    expect(html).toContain('In production');
    expect(html).toContain('In development');
    expect(html).toContain('Unknown');
    expect(html).toContain('Licence');
    expect(html).toMatch(/<legend[^>]*>Stage<\/legend>/);
    // A chosen value that nothing in the set has stays visible with its count.
    expect(html).toMatch(/In development[\s\S]{0,400}\(0\)|In development[\s\S]{0,400}>0</);
  });

  it('draws one removable badge for each chosen value, named by facet and value, and none without a choice', () => {
    expect(draw(data())).not.toContain('Chosen filters');
    const html = draw(
      data({
        query: { ...DEFAULT_QUERY, filters: { stage: ['DEV', 'PROD'], license: [':none'] } },
      }),
    );
    expect(html).toContain('Chosen filters');
    expect(html).toContain('aria-label="Remove the filter Stage: In development"');
    expect(html).toContain('aria-label="Remove the filter Stage: In production"');
    expect(html).toContain('aria-label="Remove the filter Licence: Unknown"');
    expect([...html.matchAll(/aria-label="Remove the filter/g)]).toHaveLength(3);
  });

  it('says so when no service matches, and shows no row', () => {
    const html = draw(data({ services: [], total: 0 }));
    expect(html).toContain('No service matches.');
    expect(html).not.toContain('Galaxy');
  });

  it('is in German when the person reads German, and takes the labels as the API gave them', () => {
    const html = draw(
      data({
        facets: [
          {
            ...facets[0],
            label: 'Stufe',
            values: [{ key: 'PROD', label: 'Im Betrieb', count: 2, selected: false }],
          },
        ],
      }),
      'de',
    );
    expect(html).toContain('Dienste');
    expect(html).toContain('Im Betrieb');
    expect(html).toContain('Betrieben von');
    expect(html).not.toContain('Operated by');
  });

  it('has no link to the wizard or to a service page while those pages are not offered', () => {
    offered.value = false;
    const html = draw(data({ canCreate: true }));
    expect(html).not.toContain('href="/services/new"');
    expect(html).not.toContain('href="/services/galaxy"');
    expect(html).toContain('Galaxy');
  });

  it('links to the service page, and to the wizard only for a caller the API says may create, once they are offered', () => {
    offered.value = true;
    try {
      const may = draw(data({ canCreate: true }));
      expect(may).toContain('href="/services/new"');
      expect(may).toContain('href="/services/galaxy"');
      const mayNot = draw(data({ canCreate: false }));
      expect(mayNot).not.toContain('href="/services/new"');
      expect(mayNot).toContain('href="/services/galaxy"');
    } finally {
      offered.value = false;
    }
  });

  it('sorts by the columns it names, marks the sorted one, and pages with the sizes 10, 20 and 50', () => {
    const html = draw(data({ query: { ...DEFAULT_QUERY, sort: 'provider', dir: 'desc' } }));
    expect(html).toMatch(/aria-sort="descending"[^>]*>[\s\S]{0,200}Operated by/);
    expect(html).toContain('aria-sort="none"');
    for (const size of ['10', '20', '50']) expect(html).toContain(`<option value="${size}"`);
    expect(html).not.toContain('<option value="100"');
  });

  it('renders no raw HTML: a hostile name is escaped', () => {
    const html = draw(data({ services: [row({ name: '<img src=x onerror=alert(1)>' })] }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
