// What the membership journeys need: organisations with names that cannot clash, accounts that sign in in
// their own browser context (so two people can act at once), the membership rows as the API lists them, and
// the audit entries a journey reads back. Each journey makes its own data, because the specs of a run share
// one database and a retry must not meet what its first try left.
import type { Browser, Page } from '@playwright/test';
import { activeUser, apiAs, unique, type AdminApi } from './admin.ts';
import { withDb } from './db.ts';
import { expect, hydrated, signInThroughPage, type Credentials } from './fixtures.ts';
import { uniqueRorId } from './ror.ts';

/** An abbreviation no other test used (upper case, as organisations have them). */
export const uniqueAbbreviation = (prefix: string) => unique(prefix).toUpperCase();

export interface Org {
  id: string;
  abbreviation: string;
  name: string;
}

/** A provider with this abbreviation (use `uniqueAbbreviation`) and a name of its own, and a ROR id when `ror` is true. */
export async function makeOrg(api: AdminApi, abbreviation: string, ror = false): Promise<Org> {
  const created = await api.send('POST', '/organisations', {
    type: 'provider',
    abbreviation,
    name: `${abbreviation} institute`,
    ...(ror && { rorId: uniqueRorId() }),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return {
    id: (created.body as { id: string }).id,
    abbreviation,
    name: `${abbreviation} institute`,
  };
}

/** A signed-in account in a context of its own; its `goto` waits for the page to hydrate, as the fixtures' does. */
export async function pageAs(
  browser: Browser,
  baseURL: string | undefined,
  at: (path: string) => string,
  who: Credentials,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const goto = page.goto.bind(page);
  page.goto = async (target, options) => {
    const response = await goto(target, options);
    await hydrated(page);
    return response;
  };
  await signInThroughPage(page, at, who);
  return { page, close: () => context.close() };
}

export interface Row {
  id: string;
  userId: string;
  username: string | null;
  state: string;
  role: string;
  allowedActions: string[];
}

/** The rows of the membership list for one organisation, as the signed-in caller (an Admin or a manager) sees them. */
export async function rowsOf(api: AdminApi, organisationId: string, state: string): Promise<Row[]> {
  const list = await api.get<{ result: Row[] }>(
    `/memberships?organisationId=${organisationId}&state=${state}&pageSize=100`,
  );
  return list.result;
}

export async function rowOf(
  api: AdminApi,
  organisationId: string,
  state: string,
  username: string,
): Promise<Row> {
  const found = (await rowsOf(api, organisationId, state)).find((row) => row.username === username);
  expect(found, `${username} is ${state} in ${organisationId}`).toBeDefined();
  return found!;
}

/** An active account that is an approved member of the organisation, with the role given. */
export async function memberOf(
  admin: AdminApi,
  playwright: Parameters<typeof apiAs>[0],
  baseURL: string | undefined,
  at: (path: string) => string,
  who: Credentials,
  org: Org,
  role: 'member' | 'manager' = 'member',
): Promise<string> {
  const id = await activeUser(admin, at, who);
  const api = await apiAs(playwright, baseURL, at, who);
  const asked = await api.send('POST', `/organisations/${org.id}/membership`);
  expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(300);
  await api.dispose();
  const row = await rowOf(admin, org.id, 'requested', who.username);
  const decided = await admin.send('POST', `/memberships/${row.id}/decision`, {
    decision: 'approved',
  });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  if (role === 'manager') {
    const promoted = await admin.send('POST', `/memberships/${row.id}/role`, { role: 'manager' });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
  }
  return id;
}

/** The payloads of the audit entries of an action about one organisation or membership, oldest first. */
export async function auditPayloads(
  basePath: string,
  action: string,
  key: 'organisationId' | 'membershipId',
  id: string,
): Promise<{ payload: Record<string, unknown>; userId: string | null }[]> {
  return withDb(basePath, async (client) => {
    const { rows } = await client.query<{
      payload: Record<string, unknown>;
      user_id: string | null;
    }>(
      `select payload, user_id from audit_event
       where action = $1 and payload->>'${key}' = $2 order by occurred_at, id`,
      [action, id],
    );
    return rows.map((row) => ({ payload: row.payload, userId: row.user_id }));
  });
}
