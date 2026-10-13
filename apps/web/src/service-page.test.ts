// The service page, its edit form and the two public pages, rendered on the server with a stand-in for the shell
// (`ShellHarness.svelte`): what a person must never see wrong. The page draws what the API returned and decides
// nothing, so each test hands it the answer for one kind of caller (a plain User, a member, a manager, a
// Reviewer, an Admin) and looks at the buttons, the fields and the words. The public pages are rendered with a
// harness in which reading the session or the navigation throws, and with different visitors: the output is the
// same for all of them. The clicks, the failures of a save and the whole journeys are in `e2e/services.spec.ts`;
// the patch is `edit-state.test.ts` of the module.
import { readFileSync } from 'node:fs';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ShellHarness from './test/ShellHarness.svelte';

const root = new URL('../../../modules/', import.meta.url).pathname;
const mod = (file: string) => import(/* @vite-ignore */ `${root}${file}`);
const { messages } = (await mod('registry-services/ui/messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const { messages: organisationMessages } = (await mod('registry-organisations/ui/messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const Service = ((await mod('registry-services/ui/Service.svelte')) as { default: Component })
  .default;
const ServiceEdit = (
  (await mod('registry-services/ui/ServiceEdit.svelte')) as { default: Component }
).default;
const PublicService = (
  (await mod('registry-services/ui/PublicService.svelte')) as { default: Component }
).default;
const PublicOrganisation = (
  (await mod('registry-organisations/ui/PublicOrganisation.svelte')) as { default: Component }
).default;
const { createSchemaFixture } = (await mod('registry-services/test/create-schema-fixture.ts')) as {
  createSchemaFixture: () => { steps: { fields: { key: string }[] }[]; roles: unknown[] };
};
const { editableFields } = (await mod('registry-services/service/field-rules.ts')) as {
  editableFields: (level: { edit: boolean; identity: boolean }, keys: string[]) => string[];
};

const schema = createSchemaFixture();
const keys = schema.steps.flatMap((step) => step.fields.map((field) => field.key));

const A = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a01';
const B = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a02';
const SECRET = 'team-secret@example.org';

const service = (extra: Record<string, unknown> = {}) => ({
  id: '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1aff',
  slug: 'blast-tool',
  name: 'Blast Tool',
  stage: 'PROD',
  license: 'Apache-2.0',
  iconUrl: '/api/internal/files/abc',
  public: false,
  description: 'Aligns <b>sequences</b>.',
  url: 'https://blast.example.org',
  sameAs: ['https://wikidata.example.org/Q1'],
  values: {},
  contactEmail: SECRET,
  contactType: 'support',
  organisations: [
    { role: 'provider', id: A, abbreviation: 'IPK', name: 'Leibniz IPK' },
    { role: 'consortium', id: B, abbreviation: 'DENBI', name: 'de.NBI' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  editableFields: [] as string[],
  allowedActions: [] as string[],
  ...extra,
});

const profile = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  '@id': 'https://scorpion.example/services/1',
  name: 'Blast Tool',
  alternateName: 'blast-tool',
};

const callers = {
  'a plain User': {
    editableFields: editableFields({ edit: false, identity: false }, keys),
    allowedActions: [],
  },
  'a member': {
    editableFields: editableFields({ edit: true, identity: false }, keys),
    allowedActions: ['edit'],
  },
  'a manager': {
    editableFields: editableFields({ edit: true, identity: true }, keys),
    allowedActions: ['edit'],
  },
  'a Reviewer who may publish': { editableFields: [], allowedActions: ['publish'] },
  'a Reviewer, the service being public': { editableFields: [], allowedActions: ['unpublish'] },
  'an Admin': {
    editableFields: editableFields({ edit: true, identity: true }, keys),
    allowedActions: ['edit', 'publish'],
  },
} as const;

const data = (extra: Record<string, unknown> = {}, record: Record<string, unknown> = {}) => ({
  service: service(record),
  profile,
  schema,
  licence: { id: 'Apache-2.0', name: 'Apache License 2.0', deprecated: false },
  organisations: {
    provider: { options: [{ id: A, abbreviation: 'IPK', name: 'Leibniz IPK' }], truncated: false },
    consortium: { options: [{ id: B, abbreviation: 'DENBI', name: 'de.NBI' }], truncated: false },
  },
  ...extra,
});

const draw = (page: Component, pageData: unknown, props: Record<string, unknown> = {}) =>
  render(ShellHarness, {
    props: { page, data: pageData, userId: 'me', messages, locale: 'en', ...props },
  });

describe('the service page', () => {
  it('shows the record in words: the stage from the options of the server, the licence by name, a badge, links with rel', () => {
    const { body, head } = draw(Service, data());
    expect(body).toContain('Blast Tool');
    // The stage is the label the server sent for the term, never the term.
    expect(body).toContain('In production');
    expect(body).not.toMatch(/>\s*PROD\s*</);
    expect(body).toContain('Apache License 2.0');
    expect(body).toContain('(Apache-2.0)');
    expect(body).toContain('Private');
    expect(body).toContain('Only signed-in people can read this service.');
    expect(body).toContain('alt="Icon of Blast Tool"');
    expect(body).toContain('src="/api/internal/files/abc"');
    // Text is text: the description's markup is escaped.
    expect(body).toContain('Aligns &lt;b>sequences&lt;/b>.');
    for (const link of ['https://blast.example.org', 'https://wikidata.example.org/Q1']) {
      expect(body).toMatch(new RegExp(`href="${link}"[^>]*rel="noopener noreferrer"`));
    }
    // The block in the head is the audited component's, written from the profile.
    expect(head).toContain('<script type="application/ld+json">');
    expect(head).toContain('"alternateName":"blast-tool"');
    expect(head).toContain('<title>Blast Tool</title>');
  });

  it('links who operates it and what it is part of to their organisation pages, with the words of the catalogue', () => {
    const { body } = draw(Service, data());
    expect(body).toContain('Operated by');
    expect(body).toContain('Part of');
    expect(body).toContain(`href="/organisations/${A}"`);
    expect(body).toContain(`href="/organisations/${B}"`);
    expect(body).toContain('Leibniz IPK');
    expect(body).toContain('de.NBI');
  });

  it('says Public when the record is, with the link to its public page', () => {
    const { body } = draw(Service, data({}, { public: true }));
    expect(body).toContain('Public');
    expect(body).toContain('Anyone, signed in or not, can read this service.');
    expect(body).toContain('href="/public/services/blast-tool"');
    expect(draw(Service, data()).body).not.toContain('/public/services/');
  });

  it('shows the contact point only when the API returned it', () => {
    expect(draw(Service, data()).body).toContain(`mailto:${SECRET}`);
    const hidden = draw(
      Service,
      data({}, { contactEmail: undefined, contactType: undefined }),
    ).body;
    expect(hidden).not.toContain('mailto:');
    expect(hidden).not.toContain('Contact');
  });

  /** The texts of the buttons and links that act, in the order of the page. */
  const buttons = (body: string) =>
    [...body.split('<dialog')[0]!.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
      match[1]!
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );

  it.each([
    ['a plain User', callers['a plain User'], []],
    ['a member', callers['a member'], ['Edit']],
    ['a manager', callers['a manager'], ['Edit']],
    ['a Reviewer who may publish', callers['a Reviewer who may publish'], ['Make public']],
    ['an Admin', callers['an Admin'], ['Edit', 'Make public']],
  ])('draws the buttons of %s from allowedActions and nothing else', (_who, caller, expected) => {
    expect(
      buttons(draw(Service, data({}, caller)).body).filter((text) => text !== 'Close'),
    ).toEqual(expected);
  });

  it('draws Make private for the Reviewer of a public service', () => {
    const caller = callers['a Reviewer, the service being public'];
    expect(buttons(draw(Service, data({}, { ...caller, public: true })).body)).toContain(
      'Make private',
    );
  });

  it('draws no button for a plain User, and no form', () => {
    const { body } = draw(Service, data({}, callers['a plain User']));
    expect(body).not.toContain('<button');
    expect(body).not.toContain('<form');
    expect(body).not.toContain('Edit Blast Tool');
  });

  it('holds the text of the publication dialogs only for a caller who may publish or unpublish', () => {
    const message = 'The contact point is never public.';
    expect(draw(Service, data({}, callers['a Reviewer who may publish'])).body).toContain(message);
    expect(draw(Service, data({}, callers['a plain User'])).body).not.toContain(message);
    expect(draw(Service, data({}, callers['a member'])).body).not.toContain(message);
  });
});

describe('the edit form', () => {
  const edit = (who: keyof typeof callers, extra: Record<string, unknown> = {}) =>
    draw(ServiceEdit, data(extra, callers[who])).body;

  it('draws for a member every field but the short name and the owner, which are fixed with the reason', () => {
    const body = edit('a member');
    expect(body).toContain('Edit Blast Tool');
    for (const label of ['Name', 'Licence', 'Stage', 'Description', 'Web address of the service']) {
      expect(body, label).toContain(label);
    }
    expect(body).toContain('Part of');
    // The two identity fields are text, in a list, and the line says why.
    expect(body).toContain('Fixed values');
    expect(body).toContain('Short name (used in the address)');
    expect(body).toContain('blast-tool');
    expect(body).toContain('Only a manager of the provider or an administrator can change these.');
    expect(body).not.toMatch(/<input[^>]*id="[^"]*"[^>]*value="blast-tool"/);
  });

  it('draws the short name and the owner as controls for a manager, with no fixed values', () => {
    const body = edit('a manager');
    expect(body).not.toContain('Fixed values');
    expect(body).not.toContain('Only a manager of the');
    expect(body).toMatch(/value="blast-tool"/);
    // The owner may be changed only to an organisation the loader listed.
    expect(body).toContain('Leibniz IPK (IPK)');
  });

  it('offers a save only when something changed, and Cancel always', () => {
    const body = edit('a member');
    expect(body).not.toContain('Save changes');
    expect(body).toContain('Cancel');
    expect(body).toContain('Nothing has changed yet.');
  });

  it('draws the icon block only when the API lets the caller change the icon', () => {
    expect(edit('a member')).toContain('Upload an icon');
    expect(edit('a member')).toContain('alt="Icon of Blast Tool"');
    const without = draw(
      ServiceEdit,
      data(
        {},
        { editableFields: callers['a member'].editableFields.filter((key) => key !== 'icon') },
      ),
    ).body;
    expect(without).not.toContain('Upload an icon');
  });

  it('draws a field nobody has a control for as an error, not as nothing', () => {
    // A field type of a contributing module whose widget is not registered: the page says so.
    const odd = {
      ...schema,
      steps: [
        {
          ...schema.steps[0],
          fields: [
            ...schema.steps[0]!.fields,
            {
              key: 'odd',
              path: '/odd',
              type: 'odd',
              widget: 'no-such-widget',
              label: 'services.field.name.label',
              required: false,
              config: {},
              deferred: false,
            },
          ],
        },
        ...schema.steps.slice(1),
      ],
    };
    const body = draw(
      ServiceEdit,
      data({ schema: odd }, { editableFields: [...callers['a member'].editableFields, 'odd'] }),
    ).body;
    expect(body).toContain('cannot be shown here');
    expect(body).toContain('no-such-widget');
  });

  it('says the identity line in German with the label of the role from the server', () => {
    const body = draw(ServiceEdit, data({}, callers['a member']), {
      locale: 'de',
    }).body;
    expect(body).toContain('Nur wer den');
  });
});

describe('the public pages: nothing is drawn from a role or a session', () => {
  const publicService = {
    id: 'x',
    slug: 'blast-tool',
    name: 'Blast Tool',
    logoUrl: '/a/b/api/internal/files/abc',
    description: 'Aligns sequences.',
    url: 'https://blast.example.org',
    sameAs: ['https://wikidata.example.org/Q1'],
    license: 'Apache-2.0',
    stage: 'PROD',
    provider: { id: A, name: 'Leibniz IPK', public: true },
    consortia: [{ id: B, name: 'de.NBI', public: true }],
  };
  const publicProfile = { ...profile, license: 'https://spdx.org/licenses/Apache-2.0' };
  const publicOrganisation = {
    id: A,
    name: 'Leibniz IPK',
    abbreviation: 'IPK',
    logoUrl: '/a/b/api/internal/files/def',
    description: 'A research institute.',
    website: 'https://ipk.example.org',
    rorId: '02skbsp27',
    sameAs: [],
    services: [{ id: 'x', slug: 'blast-tool', name: 'Blast Tool' }],
  };
  const orgProfile = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Leibniz IPK',
  };

  const pages = [
    ['the service', PublicService, { service: publicService, profile: publicProfile }, messages],
    [
      'the organisation',
      PublicOrganisation,
      { organisation: publicOrganisation, profile: orgProfile },
      {
        en: { ...messages.en, ...organisationMessages.en },
        de: { ...messages.de, ...organisationMessages.de },
      },
    ],
  ] as const;

  it.each(pages)(
    'reads neither the session nor the navigation to draw %s',
    (_name, page, pageData, bundle) => {
      // The harness throws when a public page asks who is signed in; reaching the end of the render is the proof.
      const { body, head } = render(ShellHarness, {
        props: {
          page,
          data: pageData,
          userId: null,
          messages: bundle,
          locale: 'en',
          anonymousOnly: true,
        },
      });
      expect(body.length).toBeGreaterThan(100);
      expect(head).toContain('application/ld+json');
    },
  );

  it.each(pages)(
    'is the same page for an anonymous visitor and for every signed-in one (%s)',
    (_name, page, pageData, bundle) => {
      const as = (userId: string | null) =>
        render(ShellHarness, {
          props: { page, data: pageData, userId, messages: bundle, locale: 'en' },
        });
      const anonymous = as(null);
      for (const who of ['admin', 'reviewer', 'member', 'me']) {
        expect(as(who).body, who).toBe(anonymous.body);
        expect(as(who).head, who).toBe(anonymous.head);
      }
    },
  );

  it.each(pages)(
    'has no control, no form and no private field (%s)',
    (_name, page, pageData, bundle) => {
      const { body, head } = render(ShellHarness, {
        props: {
          page,
          data: pageData,
          userId: null,
          messages: bundle,
          locale: 'en',
          anonymousOnly: true,
        },
      });
      for (const text of [body, head]) {
        expect(text).not.toContain('<button');
        expect(text).not.toContain('<form');
        expect(text).not.toContain('<input');
        expect(text).not.toMatch(/mailto:|contact|Edit|Make public|Make private|member/i);
      }
    },
  );

  it('draws the public service with its words, its logo, and links to the public pages of who operates it', () => {
    const { body, head } = render(ShellHarness, {
      props: { page: PublicService, data: pages[0][2], userId: null, messages, locale: 'en' },
    });
    expect(body).toContain('Blast Tool');
    expect(body).toContain('src="/a/b/api/internal/files/abc"');
    expect(body).toContain('alt="Icon of Blast Tool"');
    expect(body).toContain(`href="/public/organisations/${A}"`);
    expect(body).toContain(`href="/public/organisations/${B}"`);
    expect(body).toContain('href="https://spdx.org/licenses/Apache-2.0"');
    expect(body).toMatch(/href="https:\/\/blast.example.org"[^>]*rel="noopener noreferrer"/);
    expect(head).toContain('<script type="application/ld+json">');
    expect(head).toContain('<title>Blast Tool</title>');
  });

  it('draws the public organisation with its public services as links to their public pages', () => {
    const { body } = render(ShellHarness, {
      props: {
        page: PublicOrganisation,
        data: pages[1][2],
        userId: null,
        messages: pages[1][3],
        locale: 'en',
      },
    });
    expect(body).toContain('Leibniz IPK');
    expect(body).toContain('href="/public/services/blast-tool"');
    expect(body).toMatch(/href="https:\/\/ror.org\/02skbsp27"[^>]*rel="noopener noreferrer"/);
  });

  it('are written without a reading of the session, the navigation, the record of a caller or a role', () => {
    for (const file of [
      'registry-services/ui/PublicService.svelte',
      'registry-organisations/ui/PublicOrganisation.svelte',
    ]) {
      // The comments say what the page does not read; the code is what counts.
      const source = readFileSync(`${root}${file}`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      for (const word of [
        'session(',
        'navigation(',
        'allowedActions',
        'editableFields',
        'contactEmail',
        'contactType',
        'myMembership',
        'roles',
        'api.',
      ]) {
        expect(source, `${file} mentions ${word}`).not.toContain(word);
      }
    }
  });
});
