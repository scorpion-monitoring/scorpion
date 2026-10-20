// The templates this module ships for modules that do not exist yet: every key in both languages,
// the same message keys in both, a snapshot per template and language, and the escaping rules.
import { templateProblems } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { BRANDING } from '../test/template-fixtures.ts';
import { SHIPPED_TEMPLATES } from './index.ts';

/** Data for each template; `text` goes into every free-text field. */
const samples: Record<string, (text: string) => unknown> = {
  'onboarding.application-submitted': (text) => ({ service: text }),
  'onboarding.application-decided': (text) => ({
    service: text,
    decision: 'rejected',
    note: text,
  }),
};

describe('the shipped templates', () => {
  it('are the two of the plan that no module has taken over yet, each with a sample here', () => {
    expect(SHIPPED_TEMPLATES.map((entry) => entry.key).sort()).toEqual(Object.keys(samples).sort());
  });

  it.each(SHIPPED_TEMPLATES.map((entry) => [entry.key, entry] as const))(
    '%s keeps to the rules of every template (both languages, escaping)',
    (key, entry) => {
      expect(templateProblems(entry as never, samples[key]!, BRANDING)).toEqual([]);
    },
  );

  it.each(
    SHIPPED_TEMPLATES.flatMap((entry) =>
      (['en', 'de'] as const).map((locale) => [entry.key, locale, entry] as const),
    ),
  )('%s in %s renders as before (snapshot)', (key, locale, entry) => {
    expect(
      entry.render(samples[key]!('Ada Lovelace') as never, locale, BRANDING),
    ).toMatchSnapshot();
  });

  it('are not sensitive and not mandatory (none carries a credential, a user may switch them off)', () => {
    for (const entry of SHIPPED_TEMPLATES) {
      expect([entry.key, entry.sensitive, entry.mandatory]).toEqual([entry.key, false, false]);
    }
  });
});
