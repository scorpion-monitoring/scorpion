// The module's own template (the test mail) and the rules every shipped template follows for the
// preferences and the inbox: a category description in both languages, and an inbox form.
import { templateProblems } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { BRANDING } from '../test/template-fixtures.ts';
import { SHIPPED_TEMPLATES } from './index.ts';
import { SYSTEM_TEMPLATES, testMail } from './system.ts';

describe('the test mail', () => {
  it('keeps to the rules of every template (both languages, escaping)', () => {
    expect(templateProblems(testMail as never, () => ({}), BRANDING)).toEqual([]);
  });

  it('is mandatory (an administrator asked for it) and not sensitive', () => {
    expect([testMail.mandatory, testMail.sensitive, testMail.category]).toEqual([
      true,
      false,
      'system',
    ]);
  });

  it.each(['en', 'de'] as const)('names the instance in %s', (locale) => {
    const mail = testMail.render({}, locale, BRANDING);
    expect(mail.subject).toContain(BRANDING.instanceName);
    expect(mail.text).toContain(BRANDING.instanceName);
  });
});

const URL = 'https://example.org/somewhere';
const HOSTILE = 'Ada\r\n\u202Egnp.exe\u0000 <script>';
/** Data for each template; `text` goes into every free-text field. */
const samples: Record<string, (text: string) => unknown> = {
  'notifications.test': () => ({}),
  'registry.membership-requested': (text) => ({
    applicant: text,
    providers: [text],
    reviewUrl: URL,
  }),
  'registry.membership-decided': (text) => ({
    provider: text,
    decision: 'approved',
    providerUrl: URL,
    note: text,
  }),
  'onboarding.application-submitted': (text) => ({ service: text }),
  'onboarding.application-decided': (text) => ({ service: text, decision: 'rejected', note: text }),
  'kpi.reporting-reminder': (text) => ({
    provider: text,
    month: '2026-09',
    missing: [text],
    reportUrl: URL,
  }),
};

describe.each([...SHIPPED_TEMPLATES, ...SYSTEM_TEMPLATES].map((t) => [t.key, t] as const))(
  '%s',
  (_key, entry) => {
    it('has a category description in both languages', () => {
      expect(entry.categoryDescription?.en).toBeTruthy();
      expect(entry.categoryDescription?.de).toBeTruthy();
    });

    it('renders an inbox item from the same blocks, cleaned: one-line title, no bidi mark, no control character', () => {
      const item = entry.renderInApp!(samples[entry.key]!(HOSTILE) as never, 'en', BRANDING);
      expect(item.title.length).toBeGreaterThan(0);
      for (const part of [item.title, item.text]) {
        // eslint-disable-next-line no-control-regex -- the point of the test
        expect(part).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u0000-\u0008\u000B-\u001F]/);
      }
      expect(item.title).not.toMatch(/[\r\n]/);
      expect(item.title.length).toBeLessThanOrEqual(200);
      expect(item.text.length).toBeLessThanOrEqual(2000);
      // The mail and the inbox item say the same thing: the subject's words are in the title or the text.
      const mail = entry.render(samples[entry.key]!('Ada') as never, 'en', BRANDING);
      expect(mail.text).toContain(
        entry.renderInApp!(samples[entry.key]!('Ada') as never, 'en', BRANDING).text.split(
          '\n',
        )[0]!,
      );
    });
  },
);
