// The publications service against real Postgres, the real authoriser and core.audit: who may add and remove (the scoped
// write through the provider policy), the answers in order (401, 403, 404, 422, 409), the metadata lookup in the request
// and its fallback, the rollback when the audit entry cannot be written, and the order and pages of the list. The DOI
// resolver is a stub: no test reaches the network.
import {
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { type DoiMetadata, type DoiResolver, type DoiResult } from '@scorpion/integrations';
import { makeDoiMetadata, makePublication } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { countRows, uniqueDoi, useBibliometrics, world } from '../test/harness.ts';
import { DEFAULT_PAGE_SIZE } from './publications.ts';

const h = useBibliometrics();
const anonymous: Actor = { kind: 'anonymous' };

const meta = (title: string, extra: Partial<DoiMetadata> = {}): DoiMetadata => ({
  title,
  authors: ['Ada Example'],
  issued: { date: '2024-03-12', precision: 'day' },
  container: 'Journal of Tests',
  type: 'journal-article',
  ...extra,
});

/** A resolver whose answers a test sets per DOI, counting calls. */
function scriptedResolver(answers: Record<string, DoiResult> = {}) {
  const calls: string[] = [];
  const resolver: DoiResolver = {
    resolve(doi) {
      calls.push(doi);
      return Promise.resolve(answers[doi] ?? { status: 'not-found' });
    },
  };
  return { resolver, calls, answers };
}

/** Makes `audit_event` refuse inserts, so an audit entry cannot be written. Returns the undo. */
async function breakAudit(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_audit() returns trigger as $$
    begin raise exception 'audit is broken for this test'; end $$ language plpgsql;
    create trigger test_break_audit before insert on audit_event
      for each row execute function test_break_audit();`);
  return () => pool.query('drop trigger test_break_audit on audit_event');
}

describe('who may add a publication', () => {
  it('refuses an anonymous caller (401), and a plain user, a requested or left member and a member of another provider (403); nothing is written [ASVS-8.2.1]', async () => {
    const w = await world(await h.start());
    const doi = uniqueDoi('denied');
    await expect(w.biblio.publications.add(anonymous, w.svc.id, doi)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    for (const who of ['plain', 'requested', 'left', 'elsewhere'] as const)
      await expect(
        w.biblio.publications.add(w.people[who], w.svc.id, doi),
        who,
      ).rejects.toBeInstanceOf(Forbidden);
    expect(await countRows(w.pool, 'biblio_publication')).toBe(0);
    expect(await countRows(w.pool, 'biblio_doi_metadata')).toBe(0);
  });

  it('lets Admin, an approved manager and an approved member of the provider add [ASVS-8.2.1]', async () => {
    const w = await world(await h.start());
    for (const who of ['admin', 'manager', 'member'] as const) {
      const added = await w.biblio.publications.add(w.people[who], w.svc.id, uniqueDoi(who));
      expect(added.addedBy, who).toBe(w.people[who].userId);
    }
    expect(await countRows(w.pool, 'biblio_publication', 'service_id = $1', [w.svc.id])).toBe(3);
  });

  it('refuses a non-member before it says whether the service exists (403, not 404)', async () => {
    const w = await world(await h.start());
    const unknown = crypto.randomUUID();
    await expect(
      w.biblio.publications.add(w.people.plain, unknown, uniqueDoi()),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.biblio.publications.add(w.people.admin, unknown, uniqueDoi()),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe('adding a publication', () => {
  it('normalises the DOI, stores the looked-up metadata and writes an audit entry', async () => {
    const doi = uniqueDoi('add');
    const net = scriptedResolver({
      [doi]: {
        status: 'ok',
        metadata: meta('A paper', { issued: { date: '2024-03', precision: 'month' } }),
      },
    });
    const w = await world(await h.start({ resolver: net.resolver }));
    const added = await w.biblio.publications.add(
      w.people.member,
      w.svc.id,
      `  https://doi.org/${doi.toUpperCase()} `,
    );
    expect(added).toMatchObject({
      serviceId: w.svc.id,
      doi,
      metadata: {
        status: 'ok',
        title: 'A paper',
        authors: ['Ada Example'],
        issued: '2024-03',
        container: 'Journal of Tests',
        type: 'journal-article',
      },
    });
    expect(net.calls).toEqual([doi]);
    const { rows } = await w.pool.query<{ action: string; user_id: string; subject_id: string }>(
      `select action, user_id, subject_id from audit_event where subject_id = $1`,
      [added.id],
    );
    expect(rows).toEqual([
      {
        action: 'bibliometrics.publication.added',
        user_id: w.people.member.userId,
        subject_id: added.id,
      },
    ]);
  });

  it('refuses the same DOI twice on one service with 409 naming the publication, in any spelling; another service may list it', async () => {
    const w = await world(await h.start());
    const doi = uniqueDoi('dup');
    const first = await w.biblio.publications.add(w.people.admin, w.svc.id, doi);
    const error = await w.biblio.publications
      .add(w.people.member, w.svc.id, `doi:${doi.toUpperCase()}`)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Conflict);
    expect((error as Conflict).message).toContain(first.id);
    await w.biblio.publications.add(w.people.admin, w.elsewhereSvc.id, doi);
    expect(await countRows(w.pool, 'biblio_publication', 'doi = $1', [doi])).toBe(2);
  });

  it.each([
    ['not a DOI', 'hello world'],
    ['a URL of another host', 'https://example.org/10.1234/abc'],
    ['too long', `10.1234/${'a'.repeat(300)}`],
    ['not a string', 42],
  ])('refuses %s with 422 naming `doi`, and writes nothing', async (_label, input) => {
    const net = scriptedResolver();
    const w = await world(await h.start({ resolver: net.resolver }));
    const error = await w.biblio.publications
      .add(w.people.member, w.svc.id, input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    expect((error as Invalid).errors?.map((e) => e.path)).toEqual(['doi']);
    expect(await countRows(w.pool, 'biblio_publication')).toBe(0);
    expect(net.calls).toEqual([]);
  });

  it('answers 404, never 500, for an unknown service', async () => {
    const w = await world(await h.start());
    await expect(
      w.biblio.publications.add(w.people.admin, crypto.randomUUID(), uniqueDoi()),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('keeps the publication with failed metadata when the lookup fails or throws', async () => {
    const failing = uniqueDoi('fail');
    const throwing = uniqueDoi('throw');
    const resolver: DoiResolver = {
      resolve: (doi) =>
        doi === throwing
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ status: 'failed', reason: 'timeout' }),
    };
    const w = await world(await h.start({ resolver }));
    const a = await w.biblio.publications.add(w.people.member, w.svc.id, failing);
    expect(a.metadata).toMatchObject({ status: 'failed', title: null });
    const b = await w.biblio.publications.add(w.people.member, w.svc.id, throwing);
    expect(b.metadata).toMatchObject({ status: 'failed', title: null });
    expect(await countRows(w.pool, 'biblio_publication', 'service_id = $1', [w.svc.id])).toBe(2);
    expect(
      await countRows(w.pool, 'biblio_doi_metadata', `status = 'failed' and reason is not null`),
    ).toBe(2);
  });

  it('stores not-found for a DOI that doi.org does not know', async () => {
    const w = await world(await h.start());
    const added = await w.biblio.publications.add(w.people.member, w.svc.id, uniqueDoi('nf'));
    expect(added.metadata).toMatchObject({ status: 'not-found', title: null, authors: [] });
  });

  it('reuses a good lookup across services, and asks again when the last one failed', async () => {
    const good = uniqueDoi('good');
    const retried = uniqueDoi('retry');
    const net = scriptedResolver({
      [good]: { status: 'ok', metadata: meta('Shared') },
      [retried]: { status: 'failed', reason: 'unavailable' },
    });
    const w = await world(await h.start({ resolver: net.resolver }));
    await w.biblio.publications.add(w.people.admin, w.svc.id, good);
    const again = await w.biblio.publications.add(w.people.admin, w.elsewhereSvc.id, good);
    expect(again.metadata?.title).toBe('Shared');
    expect(net.calls.filter((doi) => doi === good)).toHaveLength(1);

    await w.biblio.publications.add(w.people.admin, w.svc.id, retried);
    net.answers[retried] = { status: 'ok', metadata: meta('Now known') };
    const later = await w.biblio.publications.add(w.people.admin, w.elsewhereSvc.id, retried);
    expect(later.metadata).toMatchObject({ status: 'ok', title: 'Now known' });
    expect(net.calls.filter((doi) => doi === retried)).toHaveLength(2);
  });

  it('looks nothing up while the setting `enabled` is off', async () => {
    const net = scriptedResolver();
    const w = await world(await h.start({ resolver: net.resolver, settings: { enabled: false } }));
    const added = await w.biblio.publications.add(w.people.member, w.svc.id, uniqueDoi('off'));
    expect(added.metadata).toBeNull();
    expect(net.calls).toEqual([]);
  });

  it('rolls back: when the audit entry cannot be written, no publication row is left', async () => {
    const net = scriptedResolver();
    const w = await world(await h.start({ resolver: net.resolver }));
    const undo = await breakAudit(w.pool);
    await expect(
      w.biblio.publications.add(w.people.member, w.svc.id, uniqueDoi('rollback')),
    ).rejects.toThrow();
    await undo();
    expect(await countRows(w.pool, 'biblio_publication')).toBe(0);
    // The lookup comes after the commit, so a refused add costs no request either.
    expect(net.calls).toEqual([]);
  });
});

describe('removing a publication', () => {
  it('removes by id, scoped to the service, with an audit entry; the metadata stays', async () => {
    const w = await world(await h.start());
    const row = await makePublication(w.pool, { serviceId: w.svc.id, metadata: {} });
    await w.biblio.publications.remove(w.people.member, w.svc.id, row.id);
    expect(await countRows(w.pool, 'biblio_publication', 'id = $1', [row.id])).toBe(0);
    expect(await countRows(w.pool, 'biblio_doi_metadata', 'doi = $1', [row.doi])).toBe(1);
    const audit = await w.pool.query(
      `select 1 from audit_event where action = 'bibliometrics.publication.removed' and subject_id = $1`,
      [row.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('answers 404 for a publication of another service and removes nothing [ASVS-8.2.2]', async () => {
    const w = await world(await h.start());
    const theirs = await makePublication(w.pool, { serviceId: w.elsewhereSvc.id });
    await expect(
      w.biblio.publications.remove(w.people.member, w.svc.id, theirs.id),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      w.biblio.publications.remove(w.people.admin, w.svc.id, theirs.id),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      w.biblio.publications.remove(w.people.admin, w.svc.id, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await countRows(w.pool, 'biblio_publication', 'id = $1', [theirs.id])).toBe(1);
  });

  it('refuses a non-member (403) and an anonymous caller (401), and keeps the row [ASVS-8.2.1]', async () => {
    const w = await world(await h.start());
    const row = await makePublication(w.pool, { serviceId: w.svc.id });
    await expect(w.biblio.publications.remove(anonymous, w.svc.id, row.id)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    for (const who of ['plain', 'elsewhere', 'left'] as const)
      await expect(
        w.biblio.publications.remove(w.people[who], w.svc.id, row.id),
        who,
      ).rejects.toBeInstanceOf(Forbidden);
    expect(await countRows(w.pool, 'biblio_publication', 'id = $1', [row.id])).toBe(1);
  });

  it('rolls back: when the audit entry cannot be written, the publication stays', async () => {
    const w = await world(await h.start());
    const row = await makePublication(w.pool, { serviceId: w.svc.id });
    const undo = await breakAudit(w.pool);
    await expect(w.biblio.publications.remove(w.people.admin, w.svc.id, row.id)).rejects.toThrow();
    await undo();
    expect(await countRows(w.pool, 'biblio_publication', 'id = $1', [row.id])).toBe(1);
  });
});

describe('listing publications', () => {
  it('sorts by issued date descending, unknown dates last, then by id, 5 per page by default', async () => {
    const w = await world(await h.start());
    const ids = (n: number) => `0000000${n}-0000-7000-8000-000000000000`;
    const add = (n: number, issued: string | null, status: 'ok' | 'failed' | null = 'ok') =>
      makePublication(w.pool, {
        id: ids(n),
        serviceId: w.svc.id,
        metadata:
          status === null
            ? null
            : status === 'failed'
              ? { status: 'failed' }
              : { issued, issuedPrecision: issued ? 'day' : null },
      });
    await add(1, '2020-01-01');
    await add(2, null, null); // never looked up
    await add(3, '2024-06-01');
    await add(4, null, 'failed');
    await add(5, '2024-06-01'); // same date as 3: by id
    await add(6, null); // known title, no date
    await add(7, '2022-05-05');
    // A publication of another service is not listed.
    await makePublication(w.pool, {
      serviceId: w.elsewhereSvc.id,
      metadata: { issued: '2030-01-01' },
    });

    const first = await w.biblio.publications.list(w.people.plain, w.svc.id, {
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(first.totalCount).toBe(7);
    expect(first.items.map((item) => item.id)).toEqual([ids(3), ids(5), ids(7), ids(1), ids(2)]);
    const second = await w.biblio.publications.list(w.people.plain, w.svc.id, {
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(second.items.map((item) => item.id)).toEqual([ids(4), ids(6)]);
    expect(second.items[0]!.metadata?.status).toBe('failed');
    expect(first.items[4]!.metadata).toBeNull();
    const beyond = await w.biblio.publications.list(w.people.plain, w.svc.id, {
      page: 5,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(beyond).toEqual({ totalCount: 7, items: [] });
  });

  it('gives the issued date at its precision', async () => {
    const w = await world(await h.start());
    await makePublication(w.pool, {
      serviceId: w.svc.id,
      metadata: { issued: '2019-01-01', issuedPrecision: 'year' },
    });
    await makePublication(w.pool, {
      serviceId: w.svc.id,
      metadata: { issued: '2018-07-01', issuedPrecision: 'month' },
    });
    const page = await w.biblio.publications.list(w.people.plain, w.svc.id, {
      page: 0,
      pageSize: 5,
    });
    expect(page.items.map((item) => item.metadata?.issued)).toEqual(['2019', '2018-07']);
  });

  it('answers 401 for an anonymous caller and 404 for an unknown service', async () => {
    const w = await world(await h.start());
    await expect(
      w.biblio.publications.list(anonymous, w.svc.id, { page: 0, pageSize: 5 }),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      w.biblio.publications.list(w.people.plain, crypto.randomUUID(), { page: 0, pageSize: 5 }),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe('the metadata cache', () => {
  it('never lets a failed lookup replace a good answer that another request stored meanwhile', async () => {
    const doi = uniqueDoi('race');
    const shared: { pool?: Parameters<typeof makeDoiMetadata>[0] } = {};
    // While this lookup runs, another request stores a good answer; this one then fails.
    const resolver: DoiResolver = {
      async resolve(asked) {
        await makeDoiMetadata(shared.pool!, { doi: asked, title: 'Kept' });
        return { status: 'failed', reason: 'timeout' };
      },
    };
    const w = await world(await h.start({ resolver }));
    shared.pool = w.pool;
    const added = await w.biblio.publications.add(w.people.admin, w.svc.id, doi);
    expect(added.metadata).toMatchObject({ status: 'ok', title: 'Kept' });
  });
});
