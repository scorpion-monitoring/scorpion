// The reporting reminder (M10 sprint 5, plan §9 items 1 to 3): once a month, the approved members of a provider who may submit are
// mailed the services of that provider that lack a value for a mandatory indicator of the previous month.
//
// A job, so it runs as the system and checks no permission; the recipients are people who *currently* may submit (the module's own
// policy, `isProviderMemberAsSystem`, asked at the moment of the send), and `core.notifications` honours the `reminders` category
// a person switched off. It reads services, organisations, indicators and accounts only through their `public.ts`, and measurements
// from its own table. It writes `kpii_reminder_sent` and the queued mails in one transaction per provider: the unique
// `(provider, period)` makes a retry, a second run on the same day and a second node send nothing twice, and a crash leaves neither
// the row nor the mail. No value, no person's id and no other provider's service is in a mail, a log line or the job result.
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { url } from '@scorpion/contracts';
import type { Db, ModuleContext } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import { PROVIDER_ROLE, type ServicesPublic } from '@scorpion/registry-services/public';
import { and, eq, inArray } from 'drizzle-orm';
import { measurement, reminderSent } from '../db/schema.ts';
import { settingsSchema, type IngestionSettings } from '../settings-schema.ts';
import { MAX_LISTED_MISSING, MAX_LISTED_SERVICES } from '../templates/reporting-reminder.ts';
import { SUBMIT_PATH } from '../ui/routes.ts';
import { MANDATORY_NECESSITY } from './necessity.ts';
import {
  previousMonth,
  selectMissing,
  type MissingService,
  type ReminderCandidate,
} from './reminder-select.ts';

export const REMINDER_JOB = 'kpi.ingestion.reporting-reminder';
export const REMINDER_TEMPLATE = 'kpi.reporting-reminder';

/** The user preference that picks a person's language (registered by core.notifications). */
const LOCALE_PREFERENCE = 'notifications.locale';
/** Services read per query when the months' values are looked up. */
const CHUNK = 500;
/** The longest name a mail carries (the template's own bound). */
const MAX_NAME = 200;

/** What a run did, as counts: the job-run history shows it. Never a name, an id or a value. */
export interface ReminderReport {
  /** Why nothing was done: `disabled` or `not-the-day`; absent when the run looked at the providers. */
  skipped?: 'disabled' | 'not-the-day';
  /** The month reminded, `YYYY-MM` (absent when skipped). */
  month?: string;
  providers: number;
  /** Providers whose members were mailed in this run. */
  reminded: number;
  /** People the mails were addressed to in this run. */
  people: number;
  /** Providers that already had a row for the month: nothing was sent again. */
  alreadySent: number;
  /** Providers with something missing and nobody who may submit and has an address: no row, no mail. */
  withoutRecipients: number;
  [key: string]: number | string | boolean | undefined;
}

export interface ReminderDeps {
  organisations: Pick<OrganisationsPublic, 'listApprovedMemberIdsAsSystem' | 'findByIdsAsSystem'>;
  services: Pick<
    ServicesPublic,
    'listProviderIdsAsSystem' | 'listByOrganisationAsSystem' | 'isProviderMemberAsSystem'
  >;
  kpi: Pick<KpiFrameworkPublic, 'effectiveIndicatorsAsSystem'>;
  identity: Pick<IdentityService, 'users'>;
  notifications: Pick<NotificationsService, 'enqueueTemplate'>;
  settings: Pick<SettingsService, 'getUserPreference'>;
  clock: () => Date;
}

export interface ReminderService {
  /**
   * The body of the daily job: returns at once unless reminders are on and today (UTC, from the injected clock) is the setting's
   * day, then reminds for the previous month. Safe to run again at any time.
   */
  run(options?: { signal?: AbortSignal }): Promise<ReminderReport>;
}

const clip = (text: string) => [...text].slice(0, MAX_NAME).join('');
const unique = <T>(items: readonly T[]) => [...new Set(items)];

export function createReminderService(ctx: ModuleContext, deps: ReminderDeps): ReminderService {
  const db: Db = ctx.db;
  const link = (serviceId: string, month: string) =>
    `${ctx.config.ORIGIN}${url(ctx.config.BASE_PATH, SUBMIT_PATH)}?service=${serviceId}&period=${month}`;

  /** Every service of every provider, with its mandatory indicators now and the ones that have a value for the month. */
  async function readCandidates(
    period: string,
    signal?: AbortSignal,
  ): Promise<ReminderCandidate[]> {
    const providers = await deps.services.listProviderIdsAsSystem();
    const found = new Map<string, { name: string; providerIds: Set<string> }>();
    for (const providerId of providers) {
      signal?.throwIfAborted();
      for (const record of await deps.services.listByOrganisationAsSystem(
        providerId,
        PROVIDER_ROLE,
      )) {
        const entry = found.get(record.id) ?? { name: record.name, providerIds: new Set<string>() };
        // The providers of the record (a service may, in the data, have more than one): each is asked for it.
        for (const organisation of record.organisations) {
          if (organisation.role === PROVIDER_ROLE) entry.providerIds.add(organisation.id);
        }
        entry.providerIds.add(providerId);
        found.set(record.id, entry);
      }
    }
    const candidates: ReminderCandidate[] = [];
    const serviceIds = [...found.keys()].sort();
    // The effective set now: a dropped KPI is not asked for, a service without a set has nothing mandatory.
    const mandatory = new Map<string, { id: string; name: string }[]>();
    for (const serviceId of serviceIds) {
      signal?.throwIfAborted();
      const rows = await deps.kpi.effectiveIndicatorsAsSystem(serviceId);
      const needed = rows
        .filter((row) => row.necessity === MANDATORY_NECESSITY)
        .map((row) => ({ id: row.indicatorId, name: row.name }));
      if (needed.length > 0) mandatory.set(serviceId, needed);
    }
    const present = new Map<string, string[]>();
    const asked = [...mandatory.keys()];
    for (let i = 0; i < asked.length; i += CHUNK) {
      const rows = await db
        .select({ serviceId: measurement.serviceId, indicatorId: measurement.indicatorId })
        .from(measurement)
        .where(
          and(
            eq(measurement.period, period),
            inArray(measurement.serviceId, asked.slice(i, i + CHUNK)),
          ),
        );
      for (const row of rows) {
        const list = present.get(row.serviceId) ?? [];
        list.push(row.indicatorId);
        present.set(row.serviceId, list);
      }
    }
    for (const serviceId of serviceIds) {
      const entry = found.get(serviceId)!;
      candidates.push({
        serviceId,
        name: entry.name,
        providerIds: [...entry.providerIds],
        mandatory: mandatory.get(serviceId) ?? [],
        present: present.get(serviceId) ?? [],
      });
    }
    return candidates;
  }

  interface Recipient {
    userId: string;
    address: string;
    locale: string | undefined;
    /** The services of the provider this person may submit for. */
    services: MissingService[];
  }

  /** Approved members who are active, have an address and may submit for at least one of the services, with those services. */
  async function recipientsOf(
    providerId: string,
    services: MissingService[],
  ): Promise<Recipient[]> {
    const memberIds = await deps.organisations.listApprovedMemberIdsAsSystem(providerId);
    if (memberIds.length === 0) return [];
    const users = await deps.identity.users.findByIds(memberIds);
    const out: Recipient[] = [];
    for (const userId of memberIds) {
      const user = users.get(userId);
      // A deactivated, rejected or deleted account gets nothing; neither does one with no address to write to.
      if (!user || user.status !== 'active' || user.deletedAt !== null || !user.email) continue;
      // The module's own rule, asked now: the policy of `kpi.ingestion.measurement.submit`.
      const allowed: MissingService[] = [];
      for (const service of services) {
        if (await deps.services.isProviderMemberAsSystem(userId, service.serviceId))
          allowed.push(service);
      }
      if (allowed.length === 0) continue;
      const locale = await deps.settings.getUserPreference(userId, LOCALE_PREFERENCE);
      out.push({
        userId,
        address: user.email,
        locale: typeof locale === 'string' ? locale : undefined,
        services: allowed,
      });
    }
    return out;
  }

  /** The data of one mail: the services this person may report for (bounded), the indicators missing in them (bounded). */
  function mailData(providerName: string, month: string, services: MissingService[]) {
    const names = services.map((service) => clip(service.name));
    const listed = services.slice(0, MAX_LISTED_SERVICES);
    // The indicators of the services that are listed, so a name never refers to a service the mail does not show.
    const shown = unique(listed.flatMap((service) => service.missing.map((m) => clip(m.name))));
    return {
      provider: clip(providerName),
      month,
      services: names.slice(0, MAX_LISTED_SERVICES),
      moreServices: Math.max(0, names.length - MAX_LISTED_SERVICES),
      missing: shown.slice(0, MAX_LISTED_MISSING),
      moreMissing: Math.max(0, shown.length - MAX_LISTED_MISSING),
      reportUrl: link(services[0]!.serviceId, month),
    };
  }

  return {
    async run(options = {}) {
      const settings: IngestionSettings = settingsSchema.parse(await ctx.settings.get());
      const report: ReminderReport = {
        providers: 0,
        reminded: 0,
        people: 0,
        alreadySent: 0,
        withoutRecipients: 0,
      };
      if (!settings.reminders.enabled) return { ...report, skipped: 'disabled' };
      const now = deps.clock();
      // The day is the UTC day of the injected clock, as the cron is UTC.
      if (now.getUTCDate() !== settings.reminders.dayOfMonth)
        return { ...report, skipped: 'not-the-day' };

      const { month, period } = previousMonth(now);
      report.month = month;
      const providers = selectMissing(await readCandidates(period, options.signal));
      report.providers = providers.length;
      for (const provider of providers) {
        options.signal?.throwIfAborted();
        // Cheap early exit; the insert below is what decides.
        const [done] = await db
          .select({ providerId: reminderSent.providerId })
          .from(reminderSent)
          .where(
            and(eq(reminderSent.providerId, provider.providerId), eq(reminderSent.period, period)),
          );
        if (done) {
          report.alreadySent += 1;
          continue;
        }
        const recipients = await recipientsOf(provider.providerId, provider.services);
        if (recipients.length === 0) {
          // Nobody can be reached: not an error, and no row, so a member who joins before the next run is still asked.
          report.withoutRecipients += 1;
          ctx.log.info({ month }, 'a provider has missing values and nobody to remind');
          continue;
        }
        const [organisation] = await deps.organisations.findByIdsAsSystem([provider.providerId]);
        const providerName = organisation?.name ?? '';
        if (providerName === '') continue;
        const sent = await ctx.db.tx(async (tx) => {
          // The claim comes first: a concurrent run waits on the key and then finds the row, so the mails exist once.
          const claimed = await tx
            .insert(reminderSent)
            .values({
              providerId: provider.providerId,
              period,
              recipients: recipients.length,
              services: provider.services.length,
            })
            .onConflictDoNothing()
            .returning({ providerId: reminderSent.providerId });
          if (claimed.length === 0) return false;
          for (const recipient of recipients) {
            await deps.notifications.enqueueTemplate(tx, {
              template: REMINDER_TEMPLATE,
              data: mailData(providerName, month, recipient.services),
              recipient: { address: recipient.address, userId: recipient.userId },
              ...(recipient.locale !== undefined && { locale: recipient.locale }),
            });
          }
          return true;
        });
        if (sent) {
          report.reminded += 1;
          report.people += recipients.length;
        } else {
          report.alreadySent += 1;
        }
      }
      ctx.log.info(
        {
          month,
          providers: report.providers,
          reminded: report.reminded,
          people: report.people,
          alreadySent: report.alreadySent,
          withoutRecipients: report.withoutRecipients,
        },
        'reporting reminder finished',
      );
      return report;
    },
  };
}
