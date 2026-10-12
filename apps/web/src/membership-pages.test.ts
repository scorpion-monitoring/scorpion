// The member and manager screens of registry.organisations, rendered on the server with a stand-in for the
// shell (`ShellHarness.svelte`). The pages draw buttons from `allowedActions` and `editableFields` of the API
// and the manager section from `summary.manages`; these tests fix the states that a person must never see
// wrong: the own request, the own role, the remove buttons, the read-only name, the hidden manager section.
// Clicks and dialogs are the Playwright journeys. The pages belong to the module and the module boundary rule
// allows no import of a module's internals from the web app, so they are loaded by path, as in json-ld.test.ts.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ShellHarness from './test/ShellHarness.svelte';

const ui = (file: string) =>
  import(
    /* @vite-ignore */ new URL(
      `../../../modules/registry-organisations/ui/${file}`,
      import.meta.url,
    ).pathname
  );
const { messages } = (await ui('messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const Account = ((await ui('AccountOrganisations.svelte')) as { default: Component }).default;
const AdminMemberships = ((await ui('admin/Memberships.svelte')) as { default: Component }).default;
const Detail = ((await ui('Organisation.svelte')) as { default: Component }).default;

const ME = 'user-me';
const draw = (page: Component, data: unknown, userId: string | null = ME, locale = 'en') =>
  render(ShellHarness, { props: { page, data, userId, messages, locale } }).body;
/** The accessible names of the buttons of the markup. */
const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*?aria-label="([^"]*)"/g)]
    .map((match) => match[1]!)
    .filter((name) => !/^(Page \d+|Previous|Next)/.test(name));

const types = [
  { id: 'provider', labels: { en: 'Provider', de: 'Anbieter' }, membership: true },
  { id: 'funder', labels: { en: 'Funder', de: 'Förderer' }, membership: false },
];
const ref = (id: string, abbreviation = id.toUpperCase()) => ({
  id,
  type: 'provider',
  abbreviation,
  name: `${abbreviation} institute`,
});
const NOW = '2026-10-10T10:00:00.000Z';
const row = (over: Record<string, unknown>) => ({
  id: 'm-1',
  organisation: ref('org-1', 'IPK'),
  userId: 'someone',
  username: 'alice',
  state: 'approved',
  role: 'member',
  requestedAt: NOW,
  decidedAt: NOW,
  roleChangedAt: null,
  allowedActions: [],
  ...over,
});
const found = (over: Record<string, unknown>) => ({
  ...ref('org-2', 'BIO'),
  typeKnown: true,
  memberCount: 3,
  myMembership: null,
  ...over,
});
const record = (editableFields: string[]) => ({
  ...ref('org-1', 'IPK'),
  typeKnown: true,
  memberCount: 4,
  myMembership: { state: 'approved', role: 'manager' },
  description: 'About us',
  website: null,
  rorId: null,
  sameAs: [],
  editableFields,
});
const account = (over: Record<string, unknown> = {}) => ({
  search: { q: undefined, type: undefined, page: 0 },
  own: [],
  ownTotal: 0,
  summary: { pending: 0, manages: false },
  found: [],
  foundTotal: 0,
  types,
  sections: [],
  ...over,
});

describe('Profile → Organisations', () => {
  it('shows nothing of the manager section to a person who manages nothing', () => {
    const html = draw(Account, account({ found: [found({})], foundTotal: 1 }));
    expect(html).toContain('Your memberships');
    expect(html).toContain('Find an organisation');
    expect(html).not.toContain('My organisations');
    expect(html).not.toContain('Edit organisation');
    expect(html).not.toMatch(/Approve|Reject|Make manager/);
  });

  it('does not draw the manager section when the API says manages, but no organisation came back', () => {
    const html = draw(Account, account({ summary: { pending: 0, manages: true } }));
    expect(html).not.toContain('My organisations');
  });

  it('says "Pending" and offers to withdraw on an own request, "Member" and leave on an approved row', () => {
    const own = [
      row({ id: 'a', userId: ME, state: 'requested', organisation: ref('o-a', 'AAA') }),
      row({ id: 'b', userId: ME, state: 'approved', organisation: ref('o-b', 'BBB') }),
      row({ id: 'c', userId: ME, state: 'rejected', organisation: ref('o-c', 'CCC') }),
    ];
    const html = draw(Account, account({ own, ownTotal: 3 }));
    expect(html).toContain('>Pending<');
    expect(html).toContain('>Member<');
    expect(html).toContain('>Rejected<');
    expect(buttons(html)).toEqual(['Withdraw the request for AAA', 'Leave BBB']);
  });

  it('puts a badge in words on the rows the person already has and a join button only where it can work', () => {
    const rows = [
      found({ id: 'o-1', abbreviation: 'NONE' }),
      found({
        id: 'o-2',
        abbreviation: 'PEND',
        myMembership: { state: 'requested', role: 'member' },
      }),
      found({
        id: 'o-3',
        abbreviation: 'MEMB',
        myMembership: { state: 'approved', role: 'member' },
      }),
      found({
        id: 'o-4',
        abbreviation: 'AGAIN',
        myMembership: { state: 'rejected', role: 'member' },
      }),
      found({ id: 'o-5', abbreviation: 'FUND', type: 'funder' }),
    ];
    const html = draw(Account, account({ found: rows, foundTotal: 5 }));
    expect(buttons(html)).toEqual([
      'Ask to become a member of NONE',
      'Ask to become a member of AGAIN',
    ]);
    expect(html).toContain('>Pending<');
    expect(html).toContain('>Member<');
  });

  describe('as a manager', () => {
    const own = row({ id: 'm-own', userId: ME, username: 'viewer', role: 'manager' });
    const other = row({
      id: 'm-other',
      username: 'bob',
      role: 'manager',
      allowedActions: ['demote'],
    });
    const plain = row({
      id: 'm-plain',
      username: 'carol',
      allowedActions: ['promote', 'remove'],
    });
    const request = row({
      id: 'm-req',
      username: 'dave',
      state: 'requested',
      decidedAt: null,
      allowedActions: ['approve', 'reject'],
    });
    const section = (fields: string[], members = [own, other, plain], requests = [request]) => ({
      organisation: record(fields),
      requests,
      requestsTotal: requests.length,
      members,
      membersTotal: members.length,
    });
    const page = (fields = ['description', 'website', 'sameAs', 'rorId', 'logo', 'contact']) =>
      draw(
        Account,
        account({
          summary: { pending: 1, manages: true },
          own: [row({ userId: ME, role: 'manager' })],
          ownTotal: 1,
          sections: [section(fields)],
        }),
      );

    it('draws the section with requests, members and the edit form', () => {
      const html = page();
      expect(html).toContain('My organisations');
      expect(html).toContain('Requests');
      expect(html).toContain('Members');
      expect(html).toContain('Edit organisation');
      expect(buttons(html)).toEqual(
        expect.arrayContaining(['Approve the request of dave', 'Reject the request of dave']),
      );
    });

    it('draws the remove button only on the rows whose allowedActions have it', () => {
      const html = page();
      expect(buttons(html)).toContain('Remove carol from the organisation');
      expect(buttons(html)).not.toContain('Remove bob from the organisation');
      expect(buttons(html)).not.toContain('Remove viewer from the organisation');
      expect(buttons(html)).toContain('Make carol a manager');
      expect(buttons(html)).toContain('Make bob a member');
    });

    it('shows no button on the own row and says why, and says why a manager cannot be removed', () => {
      const html = page();
      expect(buttons(html).filter((name) => name.includes('viewer'))).toEqual([]);
      expect(html).toContain('You cannot change your own role');
      expect(html).toContain('Only an administrator can remove a manager.');
    });

    it('shows type, abbreviation and name read only, with the reason', () => {
      const html = page();
      expect(html).toContain('Only an administrator can change these; ask one.');
      expect(html).toContain('IPK institute');
      expect(html).toMatch(/<dt[^>]*>Name<\/dt>/);
      expect(html).not.toMatch(/<input[^>]*name="(name|abbreviation|type)"/);
    });

    it('draws the whole form, and no read-only note, when the API lets the caller write every field', () => {
      const html = page([
        'type',
        'abbreviation',
        'name',
        'description',
        'website',
        'sameAs',
        'rorId',
        'logo',
        'contact',
      ]);
      expect(html).not.toContain('Only an administrator can change these');
      expect(html).not.toMatch(/<dt[^>]*>Name<\/dt>/);
    });

    it('says "No manager: administrators decide" when the member list names no manager', () => {
      const html = draw(
        Account,
        account({
          summary: { pending: 0, manages: true },
          sections: [section(['description'], [plain], [])],
        }),
      );
      expect(html).toContain('No manager: administrators decide.');
      expect(html).toContain('No request is waiting.');
    });

    it('is German when the person’s language is', () => {
      const html = draw(
        Account,
        account({
          summary: { pending: 1, manages: true },
          sections: [section(['description'])],
        }),
        ME,
        'de',
      );
      expect(html).toContain('Meine Organisationen');
      expect(html).toContain('Nur die Administration kann eine Verwaltung entfernen.');
    });
  });
});

describe('Administration → Membership requests', () => {
  const data = (rows: unknown[], over: Record<string, unknown> = {}) => ({
    query: {
      state: 'requested',
      organisationId: undefined,
      type: undefined,
      page: 0,
      pageSize: 20,
    },
    rows,
    total: rows.length,
    organisations: [ref('org-1', 'IPK')],
    organisationsTotal: 1,
    types,
    ...over,
  });

  it('has no approve or reject button on the viewer’s own request, and says why', () => {
    const own = row({
      id: 'r-own',
      userId: ME,
      username: 'viewer',
      state: 'requested',
      decidedAt: null,
      allowedActions: [],
    });
    const theirs = row({
      id: 'r-2',
      username: 'erin',
      state: 'requested',
      decidedAt: null,
      allowedActions: ['approve', 'reject'],
    });
    const html = draw(AdminMemberships, data([own, theirs]));
    expect(buttons(html)).toEqual(['Approve the request of erin', 'Reject the request of erin']);
    expect(html).toContain('This is your own request. Somebody else decides on it.');
  });

  it('offers remove, promote and demote on members from allowedActions, never on the own row', () => {
    const rows = [
      row({ id: 'a', username: 'fay', allowedActions: ['promote', 'remove'] }),
      row({ id: 'b', username: 'gus', role: 'manager', allowedActions: ['demote', 'remove'] }),
      row({ id: 'c', userId: ME, username: 'viewer', role: 'manager', allowedActions: [] }),
    ];
    const html = draw(
      AdminMemberships,
      data(rows, {
        query: {
          state: 'approved',
          organisationId: undefined,
          type: undefined,
          page: 0,
          pageSize: 20,
        },
      }),
    );
    expect(buttons(html)).toEqual([
      'Make fay a manager',
      'Remove fay from the organisation',
      'Make gus a member',
      'Remove gus from the organisation',
    ]);
    // An administrator is offered the removal of a manager: no "only an administrator" note.
    expect(html).not.toContain('Only an administrator can remove a manager.');
  });

  it('says there is no manager when one organisation’s member list has none', () => {
    const html = draw(
      AdminMemberships,
      data([row({ id: 'a', username: 'hal', allowedActions: ['promote', 'remove'] })], {
        query: {
          state: 'approved',
          organisationId: '0b9a4f0e-5f2e-4d63-9f43-0a1b2c3d4e5f',
          type: undefined,
          page: 0,
          pageSize: 20,
        },
      }),
    );
    expect(html).toContain('No manager: administrators decide.');
  });

  it('shows the state as a word', () => {
    const html = draw(
      AdminMemberships,
      data([
        row({
          id: 'a',
          state: 'requested',
          decidedAt: null,
          allowedActions: ['approve', 'reject'],
        }),
      ]),
    );
    expect(html).toContain('>Pending<');
  });
});

describe('the organisation page', () => {
  const page = (record: ReturnType<typeof detail>) =>
    draw(Detail, { organisation: record, profile: {}, types, members: null });
  const detail = (mine: unknown, editableFields: string[]) => ({
    ...record(editableFields),
    myMembership: mine,
    logoUrl: undefined,
    contactEmail: undefined,
    contactType: undefined,
  });

  it('shows the viewer’s own state with the action that fits', () => {
    expect(page(detail({ state: 'requested', role: 'member' }, []) as never)).toContain(
      'Withdraw the request',
    );
    const html = page(detail({ state: 'approved', role: 'member' }, []));
    expect(html).toContain('Leave the organisation');
    expect(html).not.toContain('Ask to become a member');
    expect(page(detail(null, []) as never)).toContain('Ask to become a member');
  });

  it('links an administrator to the requests of the organisation and a manager to their own page, and nobody else to either', () => {
    const admin = page(detail(null, ['type', 'abbreviation', 'name', 'description']));
    expect(admin).toContain('/admin/memberships?organisation=org-1');
    expect(admin).toContain('/admin/organisations/org-1');
    const manager = page(detail({ state: 'approved', role: 'manager' }, ['description', 'logo']));
    expect(manager).toContain('href="/account/organisations"');
    expect(manager).not.toContain('/admin/');
    const member = page(detail({ state: 'approved', role: 'member' }, []));
    expect(member).not.toContain('/account/organisations');
    expect(member).not.toContain('/admin/');
  });
});
