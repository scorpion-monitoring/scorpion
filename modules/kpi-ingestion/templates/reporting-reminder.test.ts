// The reporting reminder, the template that moved here from core.notifications (same key): both languages, the rules of every
// template, the data it validates, the bounds, a snapshot per language, and that it names services and indicators and never a value.
import type { TemplateBranding } from '@scorpion/core-notifications/public';
import { templateProblems } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import {
  MAX_LISTED_MISSING,
  MAX_LISTED_SERVICES,
  reportingReminder,
  TEMPLATES,
} from './reporting-reminder.ts';

const BRANDING: TemplateBranding = {
  productName: 'Test Product',
  instanceName: 'Test Instance',
  contactEmail: 'help@example.org',
  imprintUrl: 'https://example.org/imprint',
  logoUrl: 'https://example.org/api/internal/files/abc',
  baseUrl: 'https://example.org',
};
const URL =
  'https://example.org/submit?service=0198f9c0-1234-7abc-8def-0123456789ab&period=2026-09';

const sample = (text: string) => ({
  provider: text,
  month: '2026-09',
  services: [text, 'Second Service'],
  moreServices: 0,
  missing: [text, 'Number of users'],
  moreMissing: 0,
  reportUrl: URL,
});

describe('the template kpi.reporting-reminder', () => {
  it('is the one this module contributes, under the key core.notifications used', () => {
    expect(TEMPLATES.map((entry) => entry.key)).toEqual(['kpi.reporting-reminder']);
  });

  it('keeps to the rules of every template (both languages, escaping)', () => {
    expect(templateProblems(reportingReminder as never, sample, BRANDING)).toEqual([]);
  });

  it.each(['en', 'de'] as const)('renders in %s as before (snapshot)', (locale) => {
    expect(
      reportingReminder.render(sample('Ada Lovelace') as never, locale, BRANDING),
    ).toMatchSnapshot();
  });

  it('is in the category reminders, not sensitive, not mandatory (a person may switch it off)', () => {
    expect([
      reportingReminder.category,
      reportingReminder.sensitive,
      reportingReminder.mandatory,
    ]).toEqual(['reminders', false, false]);
    expect(reportingReminder.categoryDescription?.en).toBeTruthy();
    expect(reportingReminder.categoryDescription?.de).toBeTruthy();
  });

  it('validates its data: a missing field, an unknown field, a bad month, a bad URL and the bounds are refused', () => {
    const good = sample('x') as Record<string, unknown>;
    const ok = (data: unknown) => reportingReminder.schema.safeParse(data).success;
    expect(ok(good)).toBe(true);
    // The counts default to 0 (additive: the data of the old template, with the services, is still valid).
    const withoutCounts = { ...good };
    delete withoutCounts.moreServices;
    delete withoutCounts.moreMissing;
    expect(ok(withoutCounts)).toBe(true);
    expect(ok({ ...good, month: '2026-13' })).toBe(false);
    expect(ok({ ...good, reportUrl: 'not a url' })).toBe(false);
    expect(ok({ ...good, extra: 1 })).toBe(false);
    expect(ok({ ...good, missing: [] })).toBe(false);
    expect(ok({ ...good, services: [] })).toBe(false);
    expect(
      ok({ ...good, services: Array.from({ length: MAX_LISTED_SERVICES + 1 }, (_, i) => `s${i}`) }),
    ).toBe(false);
    expect(ok({ ...good, moreServices: -1 })).toBe(false);
    expect(ok({ provider: 'x' })).toBe(false);
  });

  it('says how many more there are beyond the bound, and says that the link opens the first of several', () => {
    const many = {
      ...sample('Org'),
      services: ['First', 'Second'],
      moreServices: 7,
      moreMissing: 3,
    };
    const en = reportingReminder.render(many, 'en', BRANDING);
    expect(en.text).toContain('and 7 more.');
    expect(en.text).toContain('and 3 more.');
    expect(en.text).toContain('The button opens First.');
    const de = reportingReminder.render(many, 'de', BRANDING);
    expect(de.text).toContain('und 7 weitere.');
    expect(de.text).toContain('Die Schaltfläche öffnet First.');
    // One service and nothing beyond: no sentence about the others.
    const one = reportingReminder.render(
      { ...sample('Org'), services: ['Only'], moreServices: 0 },
      'en',
      BRANDING,
    );
    expect(one.text).not.toContain('The button opens');
    expect(one.text).not.toContain('more.');
    expect(MAX_LISTED_MISSING).toBe(20);
  });

  it('puts no instance name, sender address or URL of its own in the text, and no role name', () => {
    for (const locale of ['en', 'de'] as const) {
      for (const text of Object.values(reportingReminder.catalogue[locale])) {
        expect(text, `${locale}: ${text}`).not.toMatch(/https?:|@|\.org|\.com/);
        // The placeholders are names of data fields, not words of the message.
        expect(text.replace(/\{\w+\}/g, ''), `${locale}: ${text}`).not.toMatch(
          /\b(admin|administrator|manager|member|reviewer|provider|anbieter|mitglied)\b/i,
        );
      }
    }
  });

  it('has the same placeholders in both languages for every message', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const { en, de } = reportingReminder.catalogue;
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en))
      expect(placeholders(de[key]!), key).toEqual(placeholders(en[key]!));
  });

  it('carries no value: the fields of its data are names, counts, a month and a link, and a number put into a name is only text', () => {
    // The data has no field a measurement could travel in; the strict schema refuses any other.
    expect(
      Object.keys((reportingReminder.schema as unknown as { shape: object }).shape).sort(),
    ).toEqual([
      'missing',
      'month',
      'moreMissing',
      'moreServices',
      'provider',
      'reportUrl',
      'services',
    ]);
    expect(reportingReminder.schema.safeParse({ ...sample('x'), value: '42' }).success).toBe(false);
    expect(reportingReminder.schema.safeParse({ ...sample('x'), values: { a: 1 } }).success).toBe(
      false,
    );
  });
});
