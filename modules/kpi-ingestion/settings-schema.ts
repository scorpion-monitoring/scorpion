// The settings of kpi.ingestion: the reporting reminder. Nothing secret lives here, and no wording: the mail's text is the template's.
import { z } from '@scorpion/contracts';

/** The defaults, named so a test and the README can refer to them. */
export const DEFAULT_REMINDER_DAY = 6;
/** The last day a month is sure to have (February), so every month has the day. */
export const MAX_REMINDER_DAY = 28;

const reminders = z.strictObject({
  /** Whether the daily job mails anybody. Off: it returns at once, and nothing is written. */
  enabled: z.boolean().default(true).meta({
    title: 'Send reporting reminders',
    description:
      'On: once a month, the approved members of a provider who may report are mailed a list of the services that still lack a value for a mandatory indicator of the previous month. Off: nobody is mailed.',
  }),
  /** The day of the month the reminder goes out (UTC); never past the 28th, so that every month has it. */
  dayOfMonth: z.number().int().min(1).max(MAX_REMINDER_DAY).default(DEFAULT_REMINDER_DAY).meta({
    title: 'Reminder day of the month',
    description:
      'The day of the month, from 1 to 28, on which the reminder for the previous month is sent. The day is counted in UTC: the job checks it every day at 06:00 UTC. A value outside 1 to 28 is refused.',
  }),
});

export const settingsSchema = z.strictObject({
  reminders: reminders
    .default(() => reminders.parse({}))
    .meta({
      title: 'Reporting reminder',
      description:
        'The monthly mail that asks a provider’s members for the mandatory indicators that have no value for the previous month. A member who switched the reminders category off in their notification preferences is not mailed.',
    }),
});

export type IngestionSettings = z.output<typeof settingsSchema>;
