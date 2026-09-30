import { defineModule } from '@scorpion/kernel';
import { sql } from 'drizzle-orm';
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
      const { rows } = await ctx.db.execute<{ id: string; thing_id: string }>(
        sql`select id, thing_id from fixture_a_note order by id`,
      );
      return rows.map((row) => ({ id: row.id, thingId: row.thing_id }));
    },
    describe: () =>
      `a+${ctx.deps['fixture.b'].name()}+${ctx.deps['fixture.opt']?.hello() ?? 'none'}`,
  }),
});
