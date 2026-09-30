import { defineModule, ids } from '@scorpion/kernel';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { thing } from './db/schema.ts';
import type { ThingService } from './public.ts';

// Fixture: the dependency of fixture.a. Declares a registry and emits an event.
export default defineModule<ThingService>({
  id: 'fixture.b',
  version: '1.0.0',
  schema: () => import('./db/schema.ts'),
  migrations: new URL('./migrations', import.meta.url),
  permissions: {
    'fixture.b.write': { scope: 'global', description: 'Write things' },
  },
  registries: {
    'fixture.widget': z.strictObject({ label: z.string().min(1) }),
  },
  events: {
    emits: { 'fixture.thing.created@1': z.strictObject({ thingId: z.string() }) },
  },
  services: (ctx) => {
    const create = (name: string, fail: boolean) =>
      ctx.db.tx(async (tx) => {
        const id = ids.uuidv7();
        await tx.insert(thing).values({ id, name });
        await ctx.events.emit('fixture.thing.created@1', { thingId: id });
        if (fail) throw new Error('rolled back on purpose');
        return id;
      });
    return {
      name: () => 'b',
      createThing: (name) => create(name, false),
      createThingThenFail: (name) => create(name, true) as Promise<never>,
      count: async () => {
        const { rows } = await ctx.db.execute<{ n: string }>(
          sql`select count(*) as n from fixture_b_thing`,
        );
        return Number(rows[0]!.n);
      },
    };
  },
});
