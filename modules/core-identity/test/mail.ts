// Helpers for tests that read mail from the in-memory mailer and break the outbox on purpose.
import type { Mail } from '../service/mailer.ts';

/** The token in the link of a mail (it is in the fragment, `#token=…`). */
export function tokenFrom(mail: Mail | undefined): string {
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
