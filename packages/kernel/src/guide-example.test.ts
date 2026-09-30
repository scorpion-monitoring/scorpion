// The module in packages/kernel/README.md is real: this test starts it and uses every part of it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { MODULES_DIR } from '../test/fixtures/index.ts';
import { useKernels } from '../test/helpers.ts';
import { listJobRuns } from './queries.ts';

const kernels = useKernels();

interface Notes {
  add(text: string): Promise<string>;
  list(
    page: number,
    pageSize: number,
  ): Promise<{ notes: { id: string; text: string }[]; total: number }>;
  formats(): string[];
  purgeNow(): Promise<string>;
}

async function started() {
  const kernel = await kernels.fixture('example-notes', {
    dispatcher: { backoffMs: () => 0, pollIntervalMs: 50 },
    jobs: { pollingIntervalSeconds: 0.5, cronIntervalSeconds: 1 },
  });
  await kernel.start();
  return { kernel, notes: kernel.services.get('example.notes') as Notes };
}

describe('the example module of the README', () => {
  it('stores notes in a table with the module prefix, newest first, with the total', async () => {
    const { kernel, notes } = await started();
    const first = await notes.add('first');
    const second = await notes.add('second');

    expect(await notes.list(0, 10)).toEqual({
      notes: [
        { id: second, text: 'second' },
        { id: first, text: 'first' },
      ],
      total: 2,
    });
    expect((await notes.list(1, 1)).notes).toEqual([{ id: first, text: 'first' }]);
    const tables = await kernel.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_name like 'example_notes_%' and table_schema = 'public'`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(['example_notes_note']);
  });

  it('emits note.created@1 in the same transaction, and its own handler receives it', async () => {
    const { kernel, notes } = await started();
    const id = await notes.add('with an event');

    const { rows } = await kernel.db.execute<{ payload: { noteId: string } }>(
      sql`select payload from kernel_outbox where name = 'note.created@1'`,
    );
    expect(rows).toEqual([{ payload: { noteId: id } }]);
    expect(await kernel.dispatcher.dispatchOnce()).toBe(1);
    const delivered = await kernel.db.execute<{ status: string; subscriber: string }>(
      sql`select status, subscriber from kernel_outbox_delivery`,
    );
    expect(delivered.rows).toEqual([{ status: 'delivered', subscriber: 'example.notes' }]);
  });

  it('gives the service the entries of its own registry', async () => {
    const { notes } = await started();
    expect(notes.formats()).toEqual(['markdown', 'plain']);
  });

  it('registers two internal routes, each with a permission of the module', async () => {
    const { kernel } = await started();
    expect(
      kernel.routes.map((r) => `${r.route.method} ${r.route.path} ${r.route.permission}`),
    ).toEqual(['get /notes example.notes.read', 'post /notes example.notes.write']);
    expect([...kernel.composition.permissions.keys()]).toEqual([
      'example.notes.read',
      'example.notes.write',
    ]);
  });

  it('runs the purge job on demand and keeps a history entry; old notes go, new ones stay', async () => {
    const { kernel, notes } = await started();
    await notes.add('recent');
    await kernel.db.execute(
      sql`insert into example_notes_note (id, text, created_at) values ('0190a000-0000-7000-8000-000000000001', 'ancient', now() - interval '100 days')`,
    );
    await kernel.startWorkers();

    const jobId = await notes.purgeNow();

    await vi.waitFor(
      async () => {
        const runs = await listJobRuns(kernel.db, {
          jobName: 'example.notes.purge',
          status: 'succeeded',
        });
        expect(runs.map((run) => run.jobId)).toContain(jobId);
      },
      { timeout: 20_000, interval: 250 },
    );
    expect((await notes.list(0, 10)).notes.map((n) => n.text)).toEqual(['recent']);
    const schedules = await kernel.db.execute<{ name: string; cron: string }>(
      sql`select name, cron from pgboss.schedule`,
    );
    expect(schedules.rows).toEqual([{ name: 'example.notes.purge', cron: '0 3 * * *' }]);
  }, 40_000);
});

describe('the kernel README', () => {
  const readme = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8');

  it.each(['package.json', 'db/schema.ts', 'public.ts', 'module.ts'])(
    'shows %s of the example module exactly as it is in the repository',
    (file) => {
      const source = readFileSync(join(MODULES_DIR, 'example-notes', file), 'utf8').trim();
      expect(readme).toContain(source);
    },
  );

  it('shows the generated migration too', () => {
    const migration = readFileSync(
      join(MODULES_DIR, 'example-notes/migrations/0000_notes.sql'),
      'utf8',
    ).trim();
    expect(readme).toContain(migration);
  });
});
