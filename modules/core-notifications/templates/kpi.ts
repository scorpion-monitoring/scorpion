// The reporting reminder of the KPI modules (M10): a provider's members are asked for the
// mandatory indicators that are still missing for a month.
import { z } from '@scorpion/contracts';
import { defineTemplate } from '../service/templates/define.ts';

export const reportingReminder = defineTemplate({
  key: 'kpi.reporting-reminder',
  schema: z.strictObject({
    provider: z.string().min(1).max(200),
    /** The reporting month, `2026-09`. */
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    missing: z.array(z.string().min(1).max(200)).min(1).max(200),
    reportUrl: z.url().max(2048),
  }),
  category: 'reminders',
  catalogue: {
    en: {
      subject: 'Reporting reminder for {provider}: {month}',
      heading: 'Indicators are missing for {month}',
      intro: 'For {provider}, these mandatory indicators have no value for {month} yet:',
      action: 'Enter the values',
    },
    de: {
      subject: 'Erinnerung zur Berichterstattung für {provider}: {month}',
      heading: 'Für {month} fehlen Indikatoren',
      intro:
        'Für {provider} fehlt für {month} noch ein Wert bei diesen verpflichtenden Indikatoren:',
      action: 'Werte eintragen',
    },
  },
  content: (data, { t }) => {
    const vars = { provider: data.provider, month: data.month };
    return {
      subject: t('subject', vars),
      heading: t('heading', vars),
      blocks: [
        { kind: 'text', text: t('intro', vars) },
        { kind: 'list', items: data.missing },
        { kind: 'action', label: t('action'), url: data.reportUrl },
      ],
    };
  },
});
