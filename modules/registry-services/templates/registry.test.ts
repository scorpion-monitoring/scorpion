// The template of registry.services: both languages with the same keys, the escaping rules, a snapshot per
// language and state, and nothing in the text that names a person or a role.
import type { TemplateBranding } from '@scorpion/core-notifications/public';
import { templateProblems } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { TEMPLATES, servicePublication } from './registry.ts';

const BRANDING: TemplateBranding = {
  productName: 'Test Product',
  instanceName: 'Test Instance',
  contactEmail: 'help@example.org',
  imprintUrl: 'https://example.org/imprint',
  logoUrl: 'https://example.org/api/internal/files/abc',
  baseUrl: 'https://example.org',
};
const URL = 'https://example.org/services/018f3b7e-1111-7000-8000-000000000001';
const sample = (text: string, state: 'public' | 'private' = 'public') => ({
  service: text,
  state,
  serviceUrl: URL,
});

describe('registry.service-publication', () => {
  it('is the one template of the module', () => {
    expect(TEMPLATES.map((entry) => entry.key)).toEqual(['registry.service-publication']);
  });

  it('keeps to the rules of every template (both languages, escaping)', () => {
    expect(templateProblems(servicePublication as never, (text) => sample(text), BRANDING)).toEqual(
      [],
    );
  });

  it.each(
    (['en', 'de'] as const).flatMap((locale) =>
      (['public', 'private'] as const).map((state) => [locale, state] as const),
    ),
  )('renders in %s for %s (snapshot)', (locale, state) => {
    expect(
      servicePublication.render(sample('Galaxy', state) as never, locale, BRANDING),
    ).toMatchSnapshot();
  });

  it('says what changed and for whom, and never names a person or says who decided', () => {
    for (const locale of ['en', 'de'] as const) {
      for (const state of ['public', 'private'] as const) {
        const mail = servicePublication.render(sample('Galaxy', state), locale, BRANDING);
        // The footer holds the instance's own contact address (branding); no other address may be in the mail.
        const text = `${mail.subject}\n${mail.text}`.replaceAll('help@example.org', '');
        expect(text).toContain('Galaxy');
        expect(text).not.toMatch(/reviewer|administrator|gutachter|verwalter/i);
        expect(text).not.toMatch(/@/);
      }
    }
  });

  it('refuses data with a field it does not know and a URL that is none', () => {
    const schema = (
      servicePublication as unknown as { schema: { safeParse(v: unknown): { success: boolean } } }
    ).schema;
    expect(schema.safeParse({ ...sample('x'), extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...sample('x'), serviceUrl: 'not a url' }).success).toBe(false);
    expect(schema.safeParse({ ...sample('x'), state: 'secret' }).success).toBe(false);
  });
});
