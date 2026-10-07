// What a journey needs of the stack's database: the mail the application queued (the links in it carry
// the tokens of a reset, a verification or a link), and an old session. No relay is configured, so a
// mail stays queued and its body is in the table, which is how a person would have read it.
import { expect } from '@playwright/test';
import { mailbox, type QueuedMail } from '@scorpion/testing';
import pg from 'pg';

interface StackInfo {
  name: string;
  basePath: string;
  databaseUrl: string;
}

export function stackFor(basePath: string, fresh = false): StackInfo {
  const stacks = JSON.parse(process.env.SCORPION_E2E_STACKS ?? '[]') as StackInfo[];
  const found = stacks.find(
    (stack) => stack.basePath === basePath && stack.name.startsWith('fresh') === fresh,
  );
  if (!found) throw new Error(`no stack for ${basePath}`);
  return found;
}

export async function withDb<T>(
  basePath: string,
  use: (client: pg.Client) => Promise<T>,
  fresh = false,
): Promise<T> {
  const client = new pg.Client({ connectionString: stackFor(basePath, fresh).databaseUrl });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

/** The newest mail of a template to an address; waits up to a minute for it, as a loaded CI runner delivers late. */
export async function mailTo(
  basePath: string,
  address: string,
  template: string,
): Promise<QueuedMail> {
  let found: QueuedMail | undefined;
  await expect
    .poll(
      async () => {
        const all = await withDb(basePath, (client) => mailbox(client).all());
        found = all.filter((mail) => mail.to === address && mail.template === template).at(-1);
        // A mail that is not there yet, or whose body is not yet readable, is waited for.
        return found !== undefined && found.text.length > 0;
      },
      { message: `a ${template} mail to ${address}`, timeout: 60_000 },
    )
    .toBe(true);
  return found!;
}

/** The link of a mail as `{ path, token }`: the page it opens (with the base path) and the token in its fragment. */
export function linkIn(mail: Pick<QueuedMail, 'text'>): { path: string; token: string } {
  const match = /https?:\/\/[^/\s]+([^\s#]*)#token=([A-Za-z0-9_%-]+)/.exec(mail.text);
  if (!match) throw new Error('no link with a token in the mail');
  return { path: match[1]!, token: decodeURIComponent(match[2]!) };
}

/** Makes every session of the user older than the recent-authentication window, so a sensitive change asks again. */
export async function makeSessionsStale(basePath: string, username: string): Promise<void> {
  await withDb(basePath, async (client) => {
    const { rowCount } = await client.query(
      `update identity_session set authenticated_at = now() - interval '2 hours'
       where user_id = (select id from identity_user where username = $1)`,
      [username],
    );
    expect(rowCount, 'a session to age').toBeGreaterThan(0);
  });
}
