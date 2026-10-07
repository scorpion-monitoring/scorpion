// The eight identity templates: both languages with the same keys and no English fallback, a snapshot
// per template and language, hostile names and a hostile instance name in every one, and the flags
// that decide what is deleted after sending and what a preference may switch off.
import { HOSTILE_STRINGS, templateProblems } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { IDENTITY_TEMPLATES } from './mail-templates.ts';

const BRANDING = {
  productName: 'Scorpion',
  instanceName: 'Test Instance',
  contactEmail: 'help@example.org',
  imprintUrl: 'https://example.org/imprint',
  logoUrl: 'https://example.org/api/internal/files/abc',
  baseUrl: 'https://example.org',
};
const LINK = 'https://example.org/reset-password#token=srt_AAAA';

/** Data for each template; `text` goes into every free-text field. */
const samples: Record<string, (text: string) => unknown> = {
  'identity.welcome': (text) => ({
    username: text,
    pendingReview: true,
    signInUrl: 'https://example.org/login',
  }),
  'identity.registration-request': (text) => ({
    applicantUsername: text,
    applicantEmail: text,
    reviewUrl: 'https://example.org/admin/users/pending',
  }),
  'identity.approved': (text) => ({ username: text, signInUrl: 'https://example.org/login' }),
  'identity.rejected': (text) => ({ username: text }),
  'identity.password-reset': () => ({ resetUrl: LINK, validForMinutes: 60 }),
  'identity.email-verification': () => ({
    verifyUrl: 'https://example.org/verify-email#token=sev_AAAA',
    validForHours: 24,
  }),
  'identity.register-attempt': () => ({
    signInUrl: 'https://example.org/login',
    forgotPasswordUrl: 'https://example.org/forgot-password',
  }),
  'identity.oidc-link': (text) => ({
    linkUrl: 'https://example.org/link-sign-in#token=sol_AAAA',
    providerName: text,
    validForMinutes: 10,
  }),
};

describe('the identity templates', () => {
  it('are the seven of the plan and the link mail of ADR 0026, each with a sample here', () => {
    expect(IDENTITY_TEMPLATES.map((entry) => entry.key).sort()).toEqual(
      Object.keys(samples).sort(),
    );
  });

  it.each(IDENTITY_TEMPLATES.map((entry) => [entry.key, entry] as const))(
    '%s keeps the rules of every template (both languages, hostile names)',
    (key, entry) => {
      expect(templateProblems(entry as never, samples[key]!, BRANDING)).toEqual([]);
    },
  );

  it.each(IDENTITY_TEMPLATES.map((entry) => [entry.key, entry] as const))(
    '%s keeps the rules with a hostile instance name and contact address in the branding',
    (key, entry) => {
      for (const hostile of Object.values(HOSTILE_STRINGS)) {
        expect(
          templateProblems(entry as never, samples[key]!, {
            ...BRANDING,
            instanceName: hostile,
            contactEmail: hostile,
          }),
        ).toEqual([]);
      }
    },
  );

  it.each(
    IDENTITY_TEMPLATES.flatMap((entry) =>
      (['en', 'de'] as const).map((locale) => [entry.key, locale, entry] as const),
    ),
  )('%s in %s renders as before (snapshot)', (key, locale, entry) => {
    expect(
      entry.render(samples[key]!('Ada Lovelace') as never, locale, BRANDING),
    ).toMatchSnapshot();
  });

  it('shows the pending-review text, or a sign-in link when the account is active at once', () => {
    const welcome = IDENTITY_TEMPLATES.find((e) => e.key === 'identity.welcome')!;
    const data = samples['identity.welcome']!('Ada') as { pendingReview: boolean };
    expect(welcome.render(data as never, 'en', BRANDING).text).toContain('1 to 2 business days');
    const active = welcome.render({ ...data, pendingReview: false } as never, 'en', BRANDING);
    expect(active.text).toContain('You can sign in now');
    expect(active.text).toContain('https://example.org/login');
    expect(active.text).not.toContain('business days');
  });

  it('names the contact address in the rejected mail, or the administrators when there is none', () => {
    const rejected = IDENTITY_TEMPLATES.find((e) => e.key === 'identity.rejected')!;
    const data = { username: 'Ada' };
    expect(rejected.render(data as never, 'en', BRANDING).text).toContain(
      'write to help@example.org',
    );
    const none = rejected.render(data as never, 'en', { ...BRANDING, contactEmail: null });
    expect(none.text).toContain('contact the administrators of Test Instance');
  });

  it('only the reset, the verification and the link mail are sensitive; those three and the register notice are mandatory', () => {
    expect(
      IDENTITY_TEMPLATES.map((e) => [e.key, e.sensitive, e.mandatory, e.category]).sort(),
    ).toEqual(
      [
        ['identity.approved', false, false, 'account'],
        ['identity.email-verification', true, true, 'security'],
        ['identity.oidc-link', true, true, 'security'],
        ['identity.password-reset', true, true, 'security'],
        ['identity.register-attempt', false, true, 'security'],
        ['identity.registration-request', false, false, 'administration'],
        ['identity.rejected', false, false, 'account'],
        ['identity.welcome', false, false, 'account'],
      ].sort(),
    );
  });

  it('put the link in the text and in the HTML of the three credential mails, and never in a subject', () => {
    for (const key of [
      'identity.password-reset',
      'identity.email-verification',
      'identity.oidc-link',
    ]) {
      const entry = IDENTITY_TEMPLATES.find((e) => e.key === key)!;
      const rendered = entry.render(samples[key]!('x') as never, 'en', BRANDING);
      expect(rendered.text).toContain('#token=');
      expect(rendered.html).toContain('#token=');
      expect(rendered.subject).not.toContain('token');
    }
  });

  it('refuse data that is not valid: a link that is not a URL, an unknown field, a missing field', () => {
    const reset = IDENTITY_TEMPLATES.find((e) => e.key === 'identity.password-reset')!;
    expect(reset.schema.safeParse({ resetUrl: 'nope', validForMinutes: 60 }).success).toBe(false);
    expect(reset.schema.safeParse({ resetUrl: LINK, validForMinutes: 60, extra: 1 }).success).toBe(
      false,
    );
    expect(reset.schema.safeParse({ resetUrl: LINK }).success).toBe(false);
    expect(reset.schema.safeParse({ resetUrl: LINK, validForMinutes: 0 }).success).toBe(false);
  });
});

describe('the link mail', () => {
  const entry = IDENTITY_TEMPLATES.find((e) => e.key === 'identity.oidc-link')!;
  const data = samples['identity.oidc-link']!('Example SSO');

  it.each([
    ['en', 'Example SSO', 'ignore this email', '10 minutes'],
    ['de', 'Example SSO', 'ignorieren Sie diese E-Mail', '10 Minuten'],
  ] as const)(
    'in %s names the provider, the lifetime, and says to ignore it otherwise',
    (locale, provider, ignore, minutes) => {
      const rendered = entry.render(data as never, locale, BRANDING);
      expect(rendered.text).toContain(provider);
      expect(rendered.text).toContain(ignore);
      expect(rendered.text).toContain(minutes);
      expect(rendered.subject).toContain(provider);
    },
  );

  it('says nothing was linked and nobody was signed in, so it does not read as an alarm', () => {
    expect(entry.render(data as never, 'en', BRANDING).text).toContain(
      'nothing was linked and nobody was signed in',
    );
  });
});
