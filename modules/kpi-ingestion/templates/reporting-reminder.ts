// The reporting reminder (M10 sprint 5): a provider's members are asked for the mandatory indicators that still have no value for a
// month. The template came from core.notifications with the same key (`kpi.reporting-reminder`), as the membership templates came
// to registry.organisations in M6, so no stored mail changes shape; its data gained `services`, `moreServices` and `moreMissing`.
//
// The mail names services and indicators, never a value, a person or another provider's service. Instance name, sender, contact and
// imprint come from the branding settings through the layout; the link is built by the caller with the instance origin and the base
// path. The text has no role name.
import { z } from '@scorpion/contracts';
import { defineTemplate } from '@scorpion/core-notifications/public';

/** The most service names a mail lists; the rest is a count ("and 3 more"). */
export const MAX_LISTED_SERVICES = 20;
/** The most indicator names a mail lists; the rest is a count. */
export const MAX_LISTED_MISSING = 20;

const CATEGORY_REMINDERS = {
  en: 'Reminders to report your indicators and to keep your service entries up to date.',
  de: 'Erinnerungen, Kennzahlen zu melden und Ihre Diensteinträge aktuell zu halten.',
};

const name = z.string().min(1).max(200);

export const reportingReminder = defineTemplate({
  key: 'kpi.reporting-reminder',
  schema: z.strictObject({
    provider: name,
    /** The reporting month, `2026-09`. */
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    /** The services that lack a value, by name; the first is the one the link opens. At most `MAX_LISTED_SERVICES`. */
    services: z.array(name).min(1).max(MAX_LISTED_SERVICES),
    /** How many more services lack a value than are listed. */
    moreServices: z.number().int().min(0).max(1_000_000).default(0),
    /** The mandatory indicators without a value (names, each once, over the listed services). */
    missing: z.array(name).min(1).max(200),
    /** How many more indicators are missing than are listed. */
    moreMissing: z.number().int().min(0).max(1_000_000).default(0),
    reportUrl: z.url().max(2048),
  }),
  category: 'reminders',
  categoryDescription: CATEGORY_REMINDERS,
  catalogue: {
    en: {
      subject: 'Reporting reminder for {provider}: {month}',
      heading: 'Values are missing for {month}',
      intro:
        'For {provider}, these services have no value yet for a mandatory indicator of {month}:',
      moreServices: 'and {count} more.',
      indicators: 'The mandatory indicators without a value:',
      moreMissing: 'and {count} more.',
      first: 'The button opens {service}. Choose the other services on the page.',
      action: 'Enter the values',
    },
    de: {
      subject: 'Erinnerung zur Berichterstattung für {provider}: {month}',
      heading: 'Für {month} fehlen Werte',
      intro:
        'Für {provider} fehlt bei diesen Diensten für {month} noch ein Wert bei einem verpflichtenden Indikator:',
      moreServices: 'und {count} weitere.',
      indicators: 'Die verpflichtenden Indikatoren ohne Wert:',
      moreMissing: 'und {count} weitere.',
      first: 'Die Schaltfläche öffnet {service}. Wählen Sie die anderen Dienste auf der Seite.',
      action: 'Werte eintragen',
    },
  },
  content: (data, { t }) => {
    const vars = { provider: data.provider, month: data.month };
    const severalServices = data.services.length > 1 || data.moreServices > 0;
    return {
      subject: t('subject', vars),
      heading: t('heading', vars),
      blocks: [
        { kind: 'text', text: t('intro', vars) },
        { kind: 'list', items: data.services },
        ...(data.moreServices > 0
          ? [{ kind: 'text' as const, text: t('moreServices', { count: data.moreServices }) }]
          : []),
        { kind: 'text', text: t('indicators') },
        { kind: 'list', items: data.missing },
        ...(data.moreMissing > 0
          ? [{ kind: 'text' as const, text: t('moreMissing', { count: data.moreMissing }) }]
          : []),
        ...(severalServices
          ? [{ kind: 'text' as const, text: t('first', { service: data.services[0]! }) }]
          : []),
        { kind: 'action', label: t('action'), url: data.reportUrl },
      ],
    };
  },
});

export const TEMPLATES = [reportingReminder];
