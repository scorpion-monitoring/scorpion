import { defineModule } from '@scorpion/kernel';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AService } from './public.ts';

// Fixture: depends on fixture.b, optionally on fixture.opt. Contributes a widget to b's registry
// and subscribes to b's event.
export default defineModule<AService, 'fixture.b', 'fixture.opt'>({
  id: 'fixture.a',
  version: '1.0.0',
  schema: () => import('./db/schema.ts'),
  migrations: new URL('./migrations', import.meta.url),
  permissions: {
    'fixture.a.read': { scope: 'global', description: 'Read things' },
  },
  contributes: {
    'fixture.widget': [{ label: 'from a' }],
  },
  jobs: [
    {
      // pg-boss runs a new schedule once at the next cron pass, then on every minute.
      name: 'fixture.a.tick',
      schedule: '* * * * *',
      retry: { limit: 1, delaySeconds: 1 },
      timeoutSeconds: 30,
      handler: async (job, ctx) => {
        await ctx.db.execute(
          sql`insert into fixture_a_note (id, thing_id, body) values (${job.id}, ${'00000000-0000-0000-0000-000000000000'}, 'tick') on conflict (id) do nothing`,
        );
      },
    },
    {
      name: 'fixture.a.ping',
      data: z.strictObject({ message: z.string().min(1) }),
      retry: { limit: 1, delaySeconds: 1 },
      timeoutSeconds: 30,
      handler: async (job, ctx) => {
        const { message } = job.data as { message: string };
        await ctx.db.execute(
          sql`insert into fixture_a_note (id, thing_id, body) values (${job.id}, ${'00000000-0000-0000-0000-000000000000'}, ${message}) on conflict (id) do nothing`,
        );
      },
    },
  ],
  events: {
    on: {
      // Idempotent: the note's id is the event's id, so a second delivery changes nothing.
      'fixture.thing.created@1': async (event, ctx) => {
        const { thingId } = event.payload as { thingId: string };
        await ctx.db.execute(
          sql`insert into fixture_a_note (id, thing_id, body) values (${event.id}, ${thingId}, 'created') on conflict (id) do nothing`,
        );
      },
    },
  },
  services: (ctx) => ({
    notes: async () => {
      const { rows } = await ctx.db.execute<{ id: string; thing_id: string; body: string }>(
        sql`select id, thing_id, body from fixture_a_note order by id`,
      );
      return rows.map((row) => ({ id: row.id, thingId: row.thing_id, body: row.body }));
    },
    ping: (message) => ctx.jobs.enqueue('fixture.a.ping', { message }),
    describe: () =>
      `a+${ctx.deps['fixture.b'].name()}+${ctx.deps['fixture.opt']?.hello() ?? 'none'}`,
  }),
});
