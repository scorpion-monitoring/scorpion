// The templates of registry.organisations (they came from core.notifications with the same keys, plus
// two inbox-only templates): every key in both languages, a snapshot per template and language, the
// escaping rules, and the inbox form. The snapshots are new: the wording says "organisation".
import type { TemplateBranding } from '@scorpion/core-notifications/public';
import { templateProblems } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './registry.ts';

const BRANDING: TemplateBranding = {
  productName: 'Test Product',
  instanceName: 'Test Instance',
  contactEmail: 'help@example.org',
  imprintUrl: 'https://example.org/imprint',
  logoUrl: 'https://example.org/api/internal/files/abc',
  baseUrl: 'https://example.org',
};

const URL = 'https://example.org/somewhere';
const HOSTILE = 'Ada\r\n‮gnp.exe\u0000 <script>';

/** Data for each template; `text` goes into every free-text field. */
const samples: Record<string, (text: string) => unknown> = {
  'registry.membership-requested': (text) => ({
    applicant: text,
    organisations: [text, 'Second Organisation'],
    reviewUrl: URL,
  }),
  'registry.membership-decided': (text) => ({
    organisation: text,
    decision: 'approved',
    organisationUrl: URL,
    note: text,
  }),
  'registry.membership-role-changed': (text) => ({
    organisation: text,
    role: 'manager',
    organisationUrl: URL,
  }),
  'registry.organisation-without-manager': (text) => ({ organisation: text, organisationUrl: URL }),
};

describe('the templates of registry.organisations', () => {
  it('are the two membership mails and the two inbox items, each with a sample here', () => {
    expect(TEMPLATES.map((entry) => entry.key).sort()).toEqual(Object.keys(samples).sort());
  });

  it.each(TEMPLATES.map((entry) => [entry.key, entry] as const))(
    '%s keeps to the rules of every template (both languages, escaping)',
    (key, entry) => {
      expect(templateProblems(entry as never, samples[key]!, BRANDING)).toEqual([]);
    },
  );

  it.each(
    TEMPLATES.flatMap((entry) =>
      (['en', 'de'] as const).map((locale) => [entry.key, locale, entry] as const),
    ),
  )('%s in %s renders as before (snapshot)', (key, locale, entry) => {
    expect(
      entry.render(samples[key]!('Ada Lovelace') as never, locale, BRANDING),
    ).toMatchSnapshot();
  });

  it('say "organisation", never "provider" (consortium memberships use the same mails)', () => {
    for (const entry of TEMPLATES) {
      for (const locale of ['en', 'de'] as const) {
        const mail = entry.render(samples[entry.key]!('X') as never, locale, BRANDING);
        expect(`${mail.subject}\n${mail.text}`, `${entry.key} ${locale}`).not.toMatch(
          /provider|anbieter/i,
        );
      }
    }
  });

  it('have a category description in both languages and render an inbox item, cleaned', () => {
    for (const entry of TEMPLATES) {
      expect(entry.category, entry.key).toBe('membership');
      expect(entry.categoryDescription?.en).toBeTruthy();
      expect(entry.categoryDescription?.de).toBeTruthy();
      const item = entry.renderInApp!(samples[entry.key]!(HOSTILE) as never, 'en', BRANDING);
      expect(item.title.length).toBeGreaterThan(0);
      for (const part of [item.title, item.text]) {
        // eslint-disable-next-line no-control-regex -- the point of the test
        expect(part).not.toMatch(/[‪-‮⁦-⁩\u0000-\u0008\u000B-\u001F]/);
      }
      expect(item.title).not.toMatch(/[\r\n]/);
    }
  });

  it('are not sensitive and not mandatory: a person may switch the category off', () => {
    for (const entry of TEMPLATES) {
      expect([entry.key, entry.sensitive, entry.mandatory]).toEqual([entry.key, false, false]);
    }
  });

  it('validate their data: a missing field, an unknown field and a bad URL are refused', () => {
    const [requested, decided, roleChanged, noManager] = TEMPLATES;
    const good = samples['registry.membership-requested']!('x') as Record<string, unknown>;
    expect(requested!.schema.safeParse(good).success).toBe(true);
    expect(requested!.schema.safeParse({ ...good, organisations: [] }).success).toBe(false);
    expect(requested!.schema.safeParse({ ...good, reviewUrl: 'not a url' }).success).toBe(false);
    expect(requested!.schema.safeParse({ ...good, providers: ['x'] }).success).toBe(false);
    expect(requested!.schema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(decided!.schema.safeParse({ organisation: 'x', decision: 'maybe' }).success).toBe(false);
    expect(decided!.schema.safeParse({ organisation: 'x', decision: 'rejected' }).success).toBe(
      true,
    );
    expect(
      roleChanged!.schema.safeParse({ organisation: 'x', role: 'owner', organisationUrl: URL })
        .success,
    ).toBe(false);
    expect(noManager!.schema.safeParse({ organisation: 'x' }).success).toBe(false);
  });

  it('shows the link in the approval mail and leaves it out of the rejection', () => {
    const decided = TEMPLATES[1]!;
    const approved = decided.render(
      { organisation: 'IPK', decision: 'approved', organisationUrl: URL } as never,
      'en',
      BRANDING,
    );
    const rejected = decided.render(
      { organisation: 'IPK', decision: 'rejected', organisationUrl: URL } as never,
      'en',
      BRANDING,
    );
    expect(approved.text).toContain(URL);
    expect(rejected.text).not.toContain(URL);
  });
});
