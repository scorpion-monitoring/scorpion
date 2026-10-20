// The reporting reminder against real Postgres (M10 sprint 5): the day check, `reminders.enabled`, the settings' validation, one mail per
// provider and month whatever happens (two runs, a retry after a failed send, two nodes at once, a crash between the row and the mail),
// who is mailed and who is not, what the mail holds, a provider with nobody to remind, and the year end. The job runs as the system:
// no method here takes an actor, and no route reaches it.
import { Invalid } from '@scorpion/contracts';
import {
  breakDeliveries,
  deliveryRows,
  makeKpiSet,
  makeIndicator,
  makeMeasurement,
  makeMembership,
  makeOrganisation,
  makePreference,
  makeRoleAssignment,
  makeService,
  makeServiceKpis,
  makeUser,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { count, rejection, uniq } from '../test/world.ts';
import type { KpiStarted } from '../test/harness.ts';

const h = useKpi();

const SEPTEMBER_6 = '2026-10-06T06:00:00Z';
const REMINDERS = 'notifications.preferences';

/** A provider with one service whose set has two mandatory indicators and one optional, and `people` as its members. */
async function world(s: KpiStarted, serviceName = uniq('Service')) {
  const provider = await makeOrganisation(s.pool, { type: 'provider', name: uniq('Provider') });
  const svc = await makeService(s.pool, { provider: provider.id, name: serviceName });
  const m1 = await makeIndicator(s.pool, { name: uniq('Mandatory one'), valueType: 'integer' });
  const m2 = await makeIndicator(s.pool, { name: uniq('Mandatory two'), valueType: 'integer' });
  const opt = await makeIndicator(s.pool, { name: uniq('Optional'), valueType: 'integer' });
  const set = await makeKpiSet(s.pool, {
    name: uniq('Set'),
    indicators: [
      { indicatorId: m1.id, necessity: 'mandatory' },
      { indicatorId: m2.id, necessity: 'mandatory' },
      { indicatorId: opt.id, necessity: 'optional' },
    ],
  });
  await makeServiceKpis(s.pool, { serviceId: svc.id, setId: set.id });
  const member = async (
    state: 'approved' | 'requested' | 'rejected' | 'left' = 'approved',
    role: 'member' | 'manager' = 'member',
    user: Parameters<typeof makeUser>[1] = {},
    organisationId = provider.id,
  ) => {
    const who = await makeUser(s.pool, user);
    await makeMembership(s.pool, { organisationId, userId: who.id, state, role });
    return who;
  };
  const measure = (indicator: { id: string }, period = '2026-09-30', serviceId = svc.id) =>
    makeMeasurement(s.pool, { serviceId, indicatorId: indicator.id, period, valueNumeric: 4242 });
  return { provider, svc, m1, m2, opt, set, member, measure };
}
type World = Awaited<ReturnType<typeof world>>;

const mails = (s: KpiStarted) =>
  deliveryRows(s.pool).then((rows) => rows.filter((r) => r.template === 'kpi.reporting-reminder'));
const sentRows = (s: KpiStarted) =>
  s.pool
    .query<{ provider_id: string; period: string; recipients: number; services: number }>(
      `select provider_id, to_char(period, 'YYYY-MM-DD') as period, recipients, services from kpii_reminder_sent order by provider_id`,
    )
    .then((r) => r.rows);

async function configure(s: KpiStarted, values: unknown) {
  const admin = await s.actor('admin');
  const current = await s.settings.settings.get(admin, 'kpi.ingestion');
  await s.settings.settings.update(admin, 'kpi.ingestion', { version: current.version, values });
}

describe('the day and the switch', () => {
  it('does nothing unless today is the day (default the 6th, UTC, from the injected clock), and then once', async () => {
    const s = await h.start({ now: new Date('2026-10-05T23:59:59Z') });
    const w: World = await world(s);
    await w.member();
    expect(await s.ingestion.reminder.run()).toMatchObject({ skipped: 'not-the-day', reminded: 0 });
    s.clock.set('2026-10-07T00:00:00Z');
    expect(await s.ingestion.reminder.run()).toMatchObject({ skipped: 'not-the-day' });
    expect(await mails(s)).toEqual([]);
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(0);
    s.clock.set(SEPTEMBER_6);
    expect(await s.ingestion.reminder.run()).toMatchObject({
      month: '2026-09',
      reminded: 1,
      people: 1,
    });
    expect(await mails(s)).toHaveLength(1);
  });

  it('does nothing with reminders.enabled off, even on the day, and writes nothing', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await configure(s, { reminders: { enabled: false } });
    expect(await s.ingestion.reminder.run()).toMatchObject({ skipped: 'disabled', reminded: 0 });
    expect(await mails(s)).toEqual([]);
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(0);
    await configure(s, { reminders: { enabled: true } });
    expect(await s.ingestion.reminder.run()).toMatchObject({ reminded: 1 });
  });

  it('follows the day setting', async () => {
    const s = await h.start({ now: new Date('2026-10-06T06:00:00Z') });
    const w = await world(s);
    await w.member();
    await configure(s, { reminders: { dayOfMonth: 10 } });
    expect(await s.ingestion.reminder.run()).toMatchObject({ skipped: 'not-the-day' });
    s.clock.set('2026-10-10T06:00:00Z');
    expect(await s.ingestion.reminder.run()).toMatchObject({ reminded: 1 });
  });

  it('has the defaults on and the 6th', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const { values } = await s.settings.settings.get(admin, 'kpi.ingestion');
    expect(values).toEqual({ reminders: { enabled: true, dayOfMonth: 6 } });
  });

  it.each([
    ['0', { reminders: { dayOfMonth: 0 } }],
    ['29', { reminders: { dayOfMonth: 29 } }],
    ['31', { reminders: { dayOfMonth: 31 } }],
    ['-1', { reminders: { dayOfMonth: -1 } }],
    ['a fraction', { reminders: { dayOfMonth: 6.5 } }],
    ['text', { reminders: { dayOfMonth: '6' } }],
    ['enabled as text', { reminders: { enabled: 'yes' } }],
    ['an unknown key', { reminders: { everyDay: true } }],
  ])('refuses a day or a switch out of range, never clamps it: %s', async (_name, values) => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const before = await s.settings.settings.get(admin, 'kpi.ingestion');
    const error = await rejection(
      s.settings.settings.update(admin, 'kpi.ingestion', { version: before.version, values }),
    );
    expect(error).toBeInstanceOf(Invalid);
    const after = await s.settings.settings.get(admin, 'kpi.ingestion');
    expect(after.values).toEqual(before.values);
  });

  it('accepts the edges 1 and 28', async () => {
    const s = await h.start();
    await configure(s, { reminders: { dayOfMonth: 1 } });
    await configure(s, { reminders: { dayOfMonth: 28 } });
    const admin = await s.actor('admin');
    expect((await s.settings.settings.get(admin, 'kpi.ingestion')).values).toMatchObject({
      reminders: { dayOfMonth: 28 },
    });
  });
});

describe('who is reminded, and of what', () => {
  it('mails an approved member and a manager of the provider, and nobody else [ASVS-8.3.1]', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    const member = await w.member();
    const manager = await w.member('approved', 'manager');
    await w.member('requested');
    await w.member('rejected');
    await w.member('left');
    await w.member('approved', 'member', { status: 'deactivated' });
    await w.member('approved', 'member', { deleted: true });
    await w.member('approved', 'member', { email: null });
    const other = await makeOrganisation(s.pool, { type: 'provider' });
    await makeMembership(s.pool, {
      organisationId: other.id,
      userId: (await makeUser(s.pool)).id,
      state: 'approved',
      role: 'member',
    });
    // An administrator who is no member of the provider may submit for it, but is not asked: the reminder goes to the provider's members.
    const admin = await makeUser(s.pool);
    await makeRoleAssignment(s.pool, admin, 'admin');
    const report = await s.ingestion.reminder.run();
    expect(report).toMatchObject({ reminded: 1, people: 2, withoutRecipients: 0 });
    const rows = await mails(s);
    expect(rows.map((r) => r.recipient_address).sort()).toEqual(
      [member.email, manager.email].sort(),
    );
    expect(rows.map((r) => r.recipient_user_id).sort()).toEqual([member.id, manager.id].sort());
    expect(await sentRows(s)).toEqual([
      { provider_id: w.provider.id, period: '2026-09-30', recipients: 2, services: 1 },
    ]);
  });

  it('does not mail a member who switched the reminders category off (core.notifications decides), but still counts the provider as reminded', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    const off = await w.member();
    const on = await w.member();
    await makePreference(s.pool, off, REMINDERS, { reminders: { email: false } });
    await s.ingestion.reminder.run();
    expect((await mails(s)).map((r) => r.recipient_address)).toEqual([on.email]);
  });

  it('writes the row even when every member switched the category off, so a second run does not ask again', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    const off = await w.member();
    await makePreference(s.pool, off, REMINDERS, { reminders: { email: false } });
    await s.ingestion.reminder.run();
    expect(await mails(s)).toEqual([]);
    expect(await sentRows(s)).toHaveLength(1);
  });

  it('uses the language a person chose', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    const german = await w.member();
    const english = await w.member();
    await makePreference(s.pool, german, 'notifications.locale', 'de');
    await s.ingestion.reminder.run();
    const rows = await mails(s);
    expect(rows.find((r) => r.recipient_user_id === german.id)!.locale).toBe('de');
    expect(rows.find((r) => r.recipient_user_id === english.id)!.locale).toBe('en');
  });

  it('asks the policy now: a member removed before the run is not mailed [ASVS-8.3.1]', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    const stays = await w.member();
    const leaves = await w.member();
    await s.pool.query(`update org_membership set state = 'left' where user_id = $1`, [leaves.id]);
    await s.ingestion.reminder.run();
    expect((await mails(s)).map((r) => r.recipient_user_id)).toEqual([stays.id]);
  });

  it('names the services and the mandatory indicators that lack a value, builds the link with the month, and holds no value [ASVS-8.2.3]', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6), origin: 'https://reports.example.org' });
    const w = await world(s, 'Alpha service');
    await w.member();
    await w.measure(w.m1); // value 4242 for one mandatory indicator; the other is missing
    await w.measure(w.opt);
    await s.ingestion.reminder.run();
    const [mail] = await mails(s);
    expect(mail!.subject).toContain('2026-09');
    expect(mail!.text_body).toContain('Alpha service');
    const nameOf = async (id: string) =>
      (await s.pool.query<{ name: string }>('select name from kpif_indicator where id = $1', [id]))
        .rows[0]!.name;
    expect(mail!.text_body).toContain(await nameOf(w.m2.id));
    expect(mail!.text_body).toContain(
      `https://reports.example.org/submit?service=${w.svc.id}&period=2026-09`,
    );
    // Not the one that has a value, not the optional one, and no value anywhere.
    expect(mail!.text_body).not.toContain(await nameOf(w.m1.id));
    expect(mail!.text_body).not.toContain(await nameOf(w.opt.id));
    expect(`${mail!.subject}\n${mail!.text_body}`).not.toContain('4242');
    expect(mail!.text_body).not.toContain(w.provider.id);
  });

  it('builds the link under a base path of several segments', async () => {
    const s = await h.start({
      now: new Date(SEPTEMBER_6),
      basePath: '/a/b/c',
      origin: 'https://x.example.org',
    });
    const w = await world(s);
    await w.member();
    await s.ingestion.reminder.run();
    const [mail] = await mails(s);
    expect(mail!.text_body).toContain(
      `https://x.example.org/a/b/c/submit?service=${w.svc.id}&period=2026-09`,
    );
  });

  it('never names a service of one provider to the members of another [ASVS-8.3.1]', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const a = await world(s, 'Service of provider A');
    const b = await world(s, 'Service of provider B');
    const ma = await a.member();
    const mb = await b.member();
    // A person who belongs to both providers is asked about both, in two mails (one per provider).
    await s.ingestion.reminder.run();
    const rows = await mails(s);
    const of = (id: string) => rows.filter((r) => r.recipient_user_id === id);
    expect(of(ma.id)).toHaveLength(1);
    expect(of(ma.id)[0]!.text_body).toContain('Service of provider A');
    expect(of(ma.id)[0]!.text_body).not.toContain('Service of provider B');
    expect(of(mb.id)[0]!.text_body).toContain('Service of provider B');
    expect(of(mb.id)[0]!.text_body).not.toContain('Service of provider A');
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(2);
  });

  it('lists several services, the first by name, and links to it', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s, 'Zulu service');
    const second = await makeService(s.pool, {
      provider: w.provider.id,
      name: 'Alpha second service',
    });
    await makeServiceKpis(s.pool, { serviceId: second.id, setId: w.set.id });
    await w.member();
    await s.ingestion.reminder.run();
    const [mail] = await mails(s);
    expect(mail!.text_body).toContain('The button opens Alpha second service.');
    expect(mail!.text_body).toContain(`service=${second.id}&period=2026-09`);
    expect(mail!.text_body).toContain('Zulu service');
    expect(await sentRows(s)).toMatchObject([{ services: 2 }]);
  });

  it('bounds the list and says how many more', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s, 'Service 00');
    for (let i = 1; i <= 22; i++) {
      const extra = await makeService(s.pool, {
        provider: w.provider.id,
        name: `Service ${String(i).padStart(2, '0')}`,
      });
      await makeServiceKpis(s.pool, { serviceId: extra.id, setId: w.set.id });
    }
    await w.member();
    await s.ingestion.reminder.run();
    const [mail] = await mails(s);
    // 23 services, 20 listed.
    expect(mail!.text_body).toContain('and 3 more.');
    expect(mail!.text_body).toContain('Service 19');
    expect(mail!.text_body).not.toContain('Service 20\n');
  });
});

describe('what is missing', () => {
  it('sends nothing for a provider that has every mandatory value, a service with no KPI set, or only optional indicators, and writes no row', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const complete = await world(s);
    await complete.member();
    await complete.measure(complete.m1);
    await complete.measure(complete.m2);
    // No KPI set at all.
    const bare = await makeOrganisation(s.pool, { type: 'provider' });
    await makeService(s.pool, { provider: bare.id });
    await makeMembership(s.pool, {
      organisationId: bare.id,
      userId: (await makeUser(s.pool)).id,
      state: 'approved',
      role: 'member',
    });
    const report = await s.ingestion.reminder.run();
    expect(report).toMatchObject({ providers: 0, reminded: 0, people: 0 });
    expect(await mails(s)).toEqual([]);
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(0);
  });

  it('asks for the previous month only: a value for another month does not count', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await w.measure(w.m1, '2026-08-31');
    await w.measure(w.m2, '2026-10-31');
    expect(await s.ingestion.reminder.run()).toMatchObject({ reminded: 1 });
  });

  it('uses the KPI set now: a dropped KPI is not asked for, though its values stay', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await w.measure(w.m1);
    await w.measure(w.m2);
    const admin = await s.actor('admin');
    // The service moves to a set with one new mandatory indicator and drops both old ones.
    const fresh = await makeIndicator(s.pool, { name: uniq('Fresh'), valueType: 'integer' });
    const set = await makeKpiSet(s.pool, {
      name: uniq('Newer'),
      indicators: [{ indicatorId: fresh.id, necessity: 'mandatory' }],
    });
    await s.kpi.serviceKpis.set(admin, w.svc.id, { setId: set.id, extras: [] });
    await s.ingestion.reminder.run();
    const [mail] = await mails(s);
    expect(mail!.text_body).toContain('Fresh');
    expect(await count(s.pool, 'kpii_measurement')).toBe(2);
  });

  it('asks across a year end: in January the month is December of the year before', async () => {
    const s = await h.start({ now: new Date('2027-01-06T06:00:00Z') });
    const w = await world(s);
    await w.member();
    await w.measure(w.m1, '2026-12-31');
    await w.measure(w.m2, '2027-01-31');
    expect(await s.ingestion.reminder.run()).toMatchObject({ month: '2026-12', reminded: 1 });
    const [mail] = await mails(s);
    expect(mail!.subject).toContain('2026-12');
    expect(mail!.text_body).toContain('period=2026-12');
    expect(await sentRows(s)).toMatchObject([{ period: '2026-12-31' }]);
  });
});

describe('once per provider and month', () => {
  it('sends nothing the second time the job runs on the same day', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await w.member();
    expect(await s.ingestion.reminder.run()).toMatchObject({ reminded: 1, alreadySent: 0 });
    expect(await s.ingestion.reminder.run()).toMatchObject({
      reminded: 0,
      alreadySent: 1,
      people: 0,
    });
    expect(await mails(s)).toHaveLength(2);
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(1);
  });

  it('sends once when two nodes run at the same moment', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await w.member();
    const reports = await Promise.all(Array.from({ length: 4 }, () => s.ingestion.reminder.run()));
    expect(reports.reduce((n, r) => n + r.reminded, 0)).toBe(1);
    expect(reports.reduce((n, r) => n + r.alreadySent, 0)).toBe(3);
    expect(await mails(s)).toHaveLength(2);
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(1);
  });

  it('writes neither the row nor a mail when the mail cannot be queued, and the retry sends exactly once [rollback]', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await w.member();
    const undo = await breakDeliveries(s.pool);
    await expect(s.ingestion.reminder.run()).rejects.toThrow();
    // The row and the first mail were one transaction with the failing second: both are gone.
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(0);
    expect(await mails(s)).toEqual([]);
    await undo();
    expect(await s.ingestion.reminder.run()).toMatchObject({ reminded: 1, people: 2 });
    expect(await s.ingestion.reminder.run()).toMatchObject({ reminded: 0, alreadySent: 1 });
    expect(await mails(s)).toHaveLength(2);
  });

  it('does not ask a provider again after its row exists, even when a value is still missing and a new member joined', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await s.ingestion.reminder.run();
    await w.member();
    await s.ingestion.reminder.run();
    expect(await mails(s)).toHaveLength(1);
  });

  it('asks again the next month', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member();
    await s.ingestion.reminder.run();
    s.clock.set('2026-11-06T06:00:00Z');
    expect(await s.ingestion.reminder.run()).toMatchObject({ month: '2026-10', reminded: 1 });
    expect((await sentRows(s)).map((r) => r.period)).toEqual(['2026-09-30', '2026-10-31'].sort());
  });

  it('carries on with the other providers when one has nobody to mail', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const lonely = await world(s);
    await lonely.member('requested');
    const fine = await world(s);
    await fine.member();
    const report = await s.ingestion.reminder.run();
    expect(report).toMatchObject({ providers: 2, reminded: 1, withoutRecipients: 1 });
  });
});

describe('a provider with nobody to remind', () => {
  it('is no error, writes no row and sends nothing; a member who joins before the next run is asked', async () => {
    const s = await h.start({ now: new Date(SEPTEMBER_6) });
    const w = await world(s);
    await w.member('requested');
    await w.member('left');
    await w.member('approved', 'member', { status: 'deactivated' });
    expect(await s.ingestion.reminder.run()).toMatchObject({
      reminded: 0,
      withoutRecipients: 1,
      people: 0,
    });
    expect(await mails(s)).toEqual([]);
    expect(await count(s.pool, 'kpii_reminder_sent')).toBe(0);
    const joined = await w.member();
    expect(await s.ingestion.reminder.run()).toMatchObject({ reminded: 1, people: 1 });
    expect((await mails(s)).map((r) => r.recipient_user_id)).toEqual([joined.id]);
  });
});

describe('the table', () => {
  it('refuses a period that is not a month end, a count below one and a second row for a provider and month', async () => {
    const s = await h.start();
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const insert = (period: string, recipients = 1, services = 1) =>
      s.pool.query(
        'insert into kpii_reminder_sent (provider_id, period, recipients, services) values ($1, $2, $3, $4)',
        [provider.id, period, recipients, services],
      );
    await expect(insert('2026-09-15')).rejects.toMatchObject({
      constraint: 'kpii_reminder_sent_period_check',
    });
    await expect(insert('2026-09-30', 0)).rejects.toMatchObject({
      constraint: 'kpii_reminder_sent_counts_check',
    });
    await expect(insert('2026-09-30', 1, 0)).rejects.toMatchObject({
      constraint: 'kpii_reminder_sent_counts_check',
    });
    await insert('2026-09-30');
    await expect(insert('2026-09-30')).rejects.toMatchObject({
      constraint: 'kpii_reminder_sent_pk',
    });
    await insert('2026-10-31');
  });

  it('holds counts only: no person, no service name, no value', async () => {
    const s = await h.start();
    const { rows } = await s.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'kpii_reminder_sent' order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'provider_id',
      'period',
      'sent_at',
      'recipients',
      'services',
    ]);
  });
});

describe('the job as the system', () => {
  it('takes no actor and is reachable by no route of the module', async () => {
    const s = await h.start();
    expect(s.ingestion.reminder.run.length).toBeLessThanOrEqual(1);
    const { default: manifest } = await import('../module.ts');
    const names: string[] = [];
    manifest.routes?.({
      service: () => s.ingestion,
      internal: (route: { path: string }) => names.push(route.path),
      public: (_v: string, route: { path: string }) => names.push(route.path),
    } as never);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((path) => /remind/i.test(path))).toEqual([]);
  });
});
