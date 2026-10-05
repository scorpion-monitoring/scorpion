// Helpers for tests that read the mail core.identity queued and break the outbox on purpose.
//
// core.notifications is real in these tests and no worker runs, so a mail stays `queued` and its
// rendered body is still in its table. `mailbox` (in @scorpion/testing, with the other factories of
// that table, so no module names another module's table) reads it.
import type { QueuedMail } from '@scorpion/testing';

export { mailbox, type Mailbox, type QueuedMail } from '@scorpion/testing';

/** The token in the link of a mail (it is in the fragment, `#token=…`). */
export function tokenFrom(mail: Pick<QueuedMail, 'text'> | undefined): string {
  const match = /#token=([A-Za-z0-9_%-]+)/.exec(mail?.text ?? '');
  if (!match) throw new Error('no link with a token in the mail');
  return decodeURIComponent(match[1]!);
}

/** Makes every insert into the outbox fail, so a write that emits an event must roll back. */
export async function failOutbox(kernel: {
  pool: { query: (sql: string) => Promise<unknown> };
}): Promise<void> {
  await kernel.pool.query(`
    create function identity_test_fail() returns trigger language plpgsql as
      $$ begin raise exception 'outbox on fire'; end $$;
    create trigger identity_test_fail before insert on kernel_outbox
      for each row execute function identity_test_fail();`);
}
