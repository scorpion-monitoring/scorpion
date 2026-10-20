import { mailbox } from '@scorpion/testing';
import { adminApi, newPerson, unique } from './support/admin.ts';
import { runReminder, withDb } from './support/db.ts';
import { expect, test } from './support/fixtures.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';

// M10 sprint 5: the reporting reminder. The job fires at 06:00 UTC on the setting's day, which a journey cannot wait for, so the body of the job
// runs once as a second node of the stack with the module's clock fixed (`runReminder`): the same selection, recipients, sent-table and template
// over the stack's database. The journey then reads the mail the member would get and opens its link. Under both base paths. The clock is the 6th
// of the real current month, so the month the mail names is the real previous one, which the page offers whatever day the test runs on.

const thisMonthsSixth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 6, 6));
};
const previousMonth = () => {
  const sixth = thisMonthsSixth();
  const previous = new Date(Date.UTC(sixth.getUTCFullYear(), sixth.getUTCMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
};

test.describe('journey: the reporting reminder', () => {
  test('mails the member of a provider, once, and its link opens the page on that service and month; nothing about another provider', async ({
    browser,
    playwright,
    baseURL,
    basePath,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const tag = unique('rem');
    const make = async (body: Record<string, unknown>) => {
      const made = await api.send('POST', '/kpi/indicators', { thematic: 'Usage', ...body });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      return (made.body as { id: string }).id;
    };
    const mandatoryName = `Mandatory downloads ${tag}`;
    const optionalName = `Optional notes ${tag}`;
    const mandatory = await make({ name: mandatoryName, valueType: 'integer', unit: 'count' });
    const optional = await make({ name: optionalName, valueType: 'text', qualitative: true });
    const setMade = await api.send('POST', '/kpi/sets', { name: `Reminder set ${tag}` });
    expect(setMade.status, JSON.stringify(setMade.body)).toBe(201);
    const setId = (setMade.body as { id: string }).id;
    const rows = await api.send('PUT', `/kpi/sets/${setId}/indicators`, {
      indicators: [
        { indicatorId: mandatory, necessity: 'mandatory' },
        { indicatorId: optional, necessity: 'optional' },
      ],
    });
    expect(rows.status, JSON.stringify(rows.body)).toBe(200);

    const providerA = await makeOrg(api, uniqueAbbreviation('RMA'));
    const providerB = await makeOrg(api, uniqueAbbreviation('RMB'));
    const member = newPerson('remmem');
    const other = newPerson('remoth');
    await memberOf(api, playwright, baseURL, at, member, providerA);
    await memberOf(api, playwright, baseURL, at, other, providerB);
    const makeService = async (suffix: string, provider: { id: string }) => {
      const name = `${tag} ${suffix} service`;
      const made = await api.send('POST', '/services', {
        slug: `${tag}-${suffix}`,
        name,
        provider: provider.id,
        kpiSet: { setId, extras: [] },
      });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      return { id: (made.body as { id: string }).id, name };
    };
    const serviceA = await makeService('alpha', providerA);
    const serviceB = await makeService('beta', providerB);

    const report = runReminder(basePath, thisMonthsSixth());
    expect(report).toMatchObject({ month: previousMonth() });
    expect(Number(report.reminded)).toBeGreaterThanOrEqual(2);

    const mails = await withDb(basePath, (client) => mailbox(client).all());
    const mine = mails.filter(
      (mail) =>
        mail.template === 'kpi.reporting-reminder' && mail.to === `${member.username}@example.org`,
    );
    expect(mine).toHaveLength(1);
    const mail = mine[0]!;
    // The services and indicators of this provider, and nothing of the other one's.
    expect(mail.text).toContain(serviceA.name);
    expect(mail.text).toContain(mandatoryName);
    expect(mail.text).not.toContain(optionalName);
    expect(mail.text).not.toContain(serviceB.name);
    expect(mail.subject).toContain(previousMonth());

    // The link carries the instance's origin and base path, the service and the month.
    const link = /https?:\/\/\S*\/submit\?service=([0-9a-f-]{36})&period=(\d{4}-\d{2})/.exec(
      mail.text,
    );
    expect(link, mail.text).not.toBeNull();
    const opened = new URL(link![0]);
    expect(opened.pathname).toBe(at('/submit'));
    expect(link![1]).toBe(serviceA.id);
    expect(link![2]).toBe(previousMonth());

    // A second run of the job, a second node, sends nothing again.
    const again = runReminder(basePath, thisMonthsSixth());
    expect(Number(again.alreadySent)).toBeGreaterThanOrEqual(2);
    const after = await withDb(basePath, (client) => mailbox(client).all());
    expect(
      after.filter(
        (m) => m.template === 'kpi.reporting-reminder' && m.to === `${member.username}@example.org`,
      ),
    ).toHaveLength(1);

    // The member follows the link and lands on the service and the month it names.
    const session = await pageAs(browser, baseURL, at, member);
    try {
      await session.page.goto(`${opened.pathname}${opened.search}`);
      await expect(session.page.getByLabel('Service', { exact: true })).toHaveValue(serviceA.id);
      await expect(session.page.getByLabel('Month', { exact: true })).toHaveValue(previousMonth());
      await expect(session.page).toHaveURL(new RegExp(`period=${previousMonth()}`));
    } finally {
      await session.close();
    }
  });
});
