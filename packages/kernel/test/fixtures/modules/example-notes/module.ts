import {
  createRoute,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import { defineModule, ids } from '@scorpion/kernel';
import { count, desc, lt, sql } from 'drizzle-orm';
import { note } from './db/schema.ts';
import type { NotesService } from './public.ts';

const noteSchema = z.object({ id: z.string(), text: z.string() });

const listNotes = createRoute({
  method: 'get',
  path: '/notes',
  permission: 'example.notes.read',
  request: { query: paginationQuery() },
  responses: {
    200: {
      description: 'A page of notes, newest first.',
      content: { 'application/json': { schema: listEnvelope(noteSchema) } },
    },
  },
});

const addNote = createRoute({
  method: 'post',
  path: '/notes',
  permission: 'example.notes.write',
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: z.strictObject({ text: z.string().min(1).max(500) }) },
      },
    },
  },
  responses: {
    201: {
      description: 'The note was created.',
      content: { 'application/json': { schema: z.object({ id: z.string() }) } },
    },
  },
});

export default defineModule<NotesService>({
  id: 'example.notes',
  version: '1.0.0',

  permissions: {
    'example.notes.read': { description: 'Read notes' },
    'example.notes.write': { description: 'Add notes' },
  },

  // Validates this module's settings JSON. The settings store arrives with core.settings (M3).
  settings: z.object({ retentionDays: z.number().int().min(1).default(90) }),

  schema: () => import('./db/schema.ts'),
  migrations: new URL('./migrations', import.meta.url),

  // A registry other modules can contribute to (this one also contributes to its own).
  registries: { 'example.notes.format': z.strictObject({ name: z.string().min(1) }) },
  contributes: { 'example.notes.format': [{ name: 'markdown' }, { name: 'plain' }] },

  events: {
    emits: { 'note.created@1': z.strictObject({ noteId: z.string() }) },
    on: {
      // Handlers run at least once, so they must be safe to run twice.
      'note.created@1': (event, ctx) => {
        ctx.log.info({ eventId: event.id }, 'a note was created');
        return Promise.resolve();
      },
    },
  },

  jobs: [
    {
      name: 'example.notes.purge',
      schedule: '0 3 * * *', // every day at 03:00 UTC
      retry: { limit: 2, delaySeconds: 60, backoff: true },
      timeoutSeconds: 300,
      handler: async (_job, ctx) => {
        await ctx.db.delete(note).where(lt(note.createdAt, sql`now() - interval '90 days'`));
      },
    },
  ],

  services: (ctx) => ({
    // A write that emits an event runs in one transaction: both happen, or neither does.
    add: (text) =>
      ctx.db.tx(async (tx) => {
        const id = ids.uuidv7();
        await tx.insert(note).values({ id, text });
        await ctx.events.emit('note.created@1', { noteId: id });
        return id;
      }),
    list: async (page, pageSize) => {
      const notes = await ctx.db
        .select({ id: note.id, text: note.text })
        .from(note)
        .orderBy(desc(note.id))
        .limit(pageSize)
        .offset(page * pageSize);
      const [total] = await ctx.db.select({ value: count() }).from(note);
      return { notes, total: total?.value ?? 0 };
    },
    formats: () =>
      ctx.registry('example.notes.format').map((entry) => (entry as { name: string }).name),
    purgeNow: () => ctx.jobs.enqueue('example.notes.purge'),
  }),

  // Routes are thin: parse, call one service method, map the result.
  routes: (r) => {
    const notes = r.service<NotesService>();
    r.internal(listNotes, (async (c) => {
      const query = c.req.valid('query');
      const { notes: page, total } = await notes.list(query.page, query.pageSize);
      return c.json(paginate(query, total, page), 200);
    }) satisfies RouteHandler<typeof listNotes, AppEnv>);
    r.internal(addNote, (async (c) => {
      const id = await notes.add(c.req.valid('json').text);
      return c.json({ id }, 201);
    }) satisfies RouteHandler<typeof addNote, AppEnv>);
  },
});
