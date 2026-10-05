// Vocabularies: lists of terms that replace pg enums (CLAUDE.md rule 8). Modules declare theirs in
// the registry `vocabulary`; this service stores the terms, lets an administrator change them and
// answers `terms()` and `validateTerm()` for the modules that use them.
//
// What an administrator can do is bounded on purpose. A vocabulary exists only if a loaded module
// declares it. A term declared by a module (`seeded`) is never deleted, only deactivated, because
// the declaration would bring it back at the next start. A term somebody uses (the module that owns
// the data says so with a `usage` check) is deactivated instead of deleted: it stays valid for what
// refers to it and cannot be chosen for anything new. Keys never change.
import { Conflict, Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, KernelStartupError, type ModuleContext } from '@scorpion/kernel';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { vocabulary, vocabularyTerm } from '../db/schema.ts';
import type { UsageCheck } from '../public.ts';
import { BUILTIN_VOCABULARIES } from './builtin-vocabularies.ts';
import { PERMISSION_VOCABULARY_READ, PERMISSION_VOCABULARY_WRITE } from './permissions.ts';
import { labelFor, orderTerms } from './vocabulary-order.ts';

export const VOCABULARY_REGISTRY = 'vocabulary';

/** `stage`, `thematic-category`, or a module's own `kpi.framework.value-kind`. */
export const VOCABULARY_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** What other modules store. Case matters (`PROD`, `mandatory`). */
export const TERM_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const MAX_TERMS_PER_VOCABULARY = 500;

export const termKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(TERM_KEY, 'must be letters, digits, "_" and "-", starting with a letter');
/** The text people see, by locale; English is always there. */
export const labelsSchema = z
  .record(
    z.string().regex(LOCALE, 'must be a locale such as "en" or "de-AT"'),
    z.string().trim().min(1).max(200),
  )
  .refine((labels) => Object.keys(labels).length <= 20, 'must have at most 20 locales')
  .refine((labels) => typeof labels.en === 'string', 'must include an "en" label');
const sortOrderSchema = z.number().int().min(-1_000_000).max(1_000_000);

const seedTermSchema = z.strictObject({
  key: termKeySchema,
  labels: labelsSchema,
  sortOrder: sortOrderSchema.optional(),
});

export const vocabularyEntrySchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(VOCABULARY_ID, 'must be dot-separated lower-case kebab case'),
  /** At least one entry of an id has one. */
  description: z.string().trim().min(1).max(500).optional(),
  /** The terms the module ships. Added when missing; an administrator's edits are never overwritten. */
  terms: z.array(seedTermSchema).max(MAX_TERMS_PER_VOCABULARY).optional(),
  /** The module that stores the keys says whether one is in use. Several entries may add one each. */
  usage: z
    .custom<UsageCheck>((value) => typeof value === 'function', 'expected a function')
    .optional(),
});
export type VocabularyEntry = z.input<typeof vocabularyEntrySchema>;

export interface TermView {
  key: string;
  labels: Record<string, string>;
  /** The label for the requested locale (default `en`). */
  label: string;
  sortOrder: number;
  active: boolean;
  /** Declared by a module, not added by an administrator. */
  seeded: boolean;
}

export interface VocabularyView {
  id: string;
  description: string;
  terms: number;
  activeTerms: number;
}

export interface TermOptions {
  /** Include deactivated terms. Default: only the ones that can be chosen. */
  includeInactive?: boolean;
  /** For `label`. Default `en`. */
  locale?: string;
}

export interface VocabularyAdminService {
  /** Needs `core.settings.vocabulary.read`. Every declared vocabulary with its term counts, by id. */
  list(actor: Actor): Promise<VocabularyView[]>;
  /**
   * Needs `core.settings.vocabulary.read`; `includeInactive` also needs `.write`. The terms in
   * order. `NotFound` for a vocabulary no loaded module declares.
   */
  listTerms(actor: Actor, vocabularyId: string, options?: TermOptions): Promise<TermView[]>;
  /**
   * Needs `core.settings.vocabulary.write`. Adds a term of the administrator's own. `Conflict` for a
   * key that exists (also a deactivated one), `Invalid` for bad input. Emits
   * `settings.vocabulary.changed@1`.
   */
  createTerm(actor: Actor, vocabularyId: string, input: unknown): Promise<TermView>;
  /**
   * Needs `core.settings.vocabulary.write`. Changes labels, sort order and the active flag; the key
   * stays. A patch that changes nothing writes and emits nothing.
   */
  updateTerm(actor: Actor, vocabularyId: string, key: string, patch: unknown): Promise<TermView>;
  /**
   * Needs `core.settings.vocabulary.write`. Deletes a term nobody uses; a term a module declared or
   * that is in use is deactivated instead. Says which of the two happened.
   */
  removeTerm(
    actor: Actor,
    vocabularyId: string,
    key: string,
  ): Promise<{ outcome: 'deleted' | 'deactivated'; term: TermView | null }>;
}

export interface VocabularyInternals extends VocabularyAdminService {
  /** Trusted: the terms of a vocabulary in order, active ones unless asked otherwise. */
  terms(vocabularyId: string, options?: TermOptions): Promise<TermView[]>;
  /** Trusted: `Invalid` unless `key` is a term (an active one, unless `allowInactive`). */
  validateTerm(
    vocabularyId: string,
    key: string,
    options?: { allowInactive?: boolean; path?: string },
  ): Promise<void>;
  /** Writes the declared vocabularies and their missing terms. Idempotent; runs at start. */
  seed(): Promise<void>;
}

interface Definition {
  id: string;
  description: string;
  terms: { key: string; labels: Record<string, string>; sortOrder: number }[];
  usage: UsageCheck[];
}

const createTermInput = z.strictObject({
  key: termKeySchema,
  labels: labelsSchema,
  sortOrder: sortOrderSchema.optional(),
});
const updateTermInput = z
  .strictObject({
    labels: labelsSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'must change at least one field');

function problems(error: z.ZodError): FieldProblem[] {
  return error.issues.map((issue) => ({
    in: 'body',
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** Merges the registry entries of one id and checks them. Throws `KernelStartupError`. */
export function collectDefinitions(entries: readonly unknown[]): Map<string, Definition> {
  const found: string[] = [];
  const definitions = new Map<string, Definition>();
  for (const raw of entries) {
    const parsed = vocabularyEntrySchema.safeParse(raw);
    if (!parsed.success) {
      found.push(
        `a vocabulary entry is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
      );
      continue;
    }
    const entry = parsed.data;
    const definition = definitions.get(entry.id) ?? {
      id: entry.id,
      description: '',
      terms: [],
      usage: [],
    };
    if (entry.description && !definition.description) definition.description = entry.description;
    for (const seed of entry.terms ?? []) {
      if (definition.terms.some((t) => t.key === seed.key)) {
        found.push(`the term "${seed.key}" of the vocabulary "${entry.id}" is declared twice`);
        continue;
      }
      definition.terms.push({
        key: seed.key,
        labels: seed.labels,
        sortOrder: seed.sortOrder ?? (definition.terms.length + 1) * 10,
      });
    }
    if (entry.usage) definition.usage.push(entry.usage);
    definitions.set(entry.id, definition);
  }
  for (const definition of definitions.values()) {
    if (!definition.description) found.push(`the vocabulary "${definition.id}" has no description`);
  }
  if (found.length > 0) throw new KernelStartupError('Cannot start core.settings:', found);
  return definitions;
}

export function createVocabularyService(
  ctx: ModuleContext,
  deps: { authz: Pick<AuthzService, 'require'> },
): VocabularyInternals {
  const definitions = collectDefinitions([
    ...BUILTIN_VOCABULARIES.map((entry) => vocabularyEntrySchema.parse(entry)),
    ...ctx.registry(VOCABULARY_REGISTRY),
  ]);

  function definition(vocabularyId: string): Definition {
    const found = definitions.get(vocabularyId);
    if (!found) {
      throw new NotFound(`There is no vocabulary "${vocabularyId.slice(0, 100)}".`);
    }
    return found;
  }

  const view = (row: typeof vocabularyTerm.$inferSelect, locale: string): TermView => {
    const labels = row.labels as Record<string, string>;
    return {
      key: row.key,
      labels,
      label: labelFor(labels, locale, row.key),
      sortOrder: row.sortOrder,
      active: row.active,
      seeded: row.seeded,
    };
  };

  async function load(vocabularyId: string, options: TermOptions = {}): Promise<TermView[]> {
    definition(vocabularyId);
    const rows = await ctx.db
      .select()
      .from(vocabularyTerm)
      .where(
        and(
          eq(vocabularyTerm.vocabularyId, vocabularyId),
          options.includeInactive ? undefined : eq(vocabularyTerm.active, true),
        ),
      );
    return orderTerms(rows.map((row) => view(row, options.locale ?? 'en')));
  }

  async function inUse(def: Definition, key: string): Promise<boolean> {
    for (const check of def.usage) if (await check(key)) return true;
    return false;
  }

  async function emitChange(
    actor: Actor,
    vocabularyId: string,
    key: string,
    change: 'created' | 'updated' | 'activated' | 'deactivated' | 'deleted',
  ) {
    // Which term and who, never its labels.
    await ctx.events.emit('settings.vocabulary.changed@1', {
      vocabulary: vocabularyId,
      key,
      change,
      actorId: actor.kind === 'user' ? actor.userId : null,
    });
  }

  return {
    terms: (vocabularyId, options) => load(vocabularyId, options),

    async validateTerm(vocabularyId, key, options = {}) {
      const path = options.path ?? 'body';
      const terms = await load(vocabularyId, { includeInactive: true });
      const found = terms.find((term) => term.key === key);
      if (!found) {
        throw new Invalid('The request is not valid.', [
          {
            in: 'body',
            path,
            message: `"${key.slice(0, 64)}" is not a term of "${vocabularyId}".`,
          },
        ]);
      }
      if (!found.active && !options.allowInactive) {
        throw new Invalid('The request is not valid.', [
          {
            in: 'body',
            path,
            message: `"${key.slice(0, 64)}" is no longer available in "${vocabularyId}".`,
          },
        ]);
      }
    },

    async seed() {
      await ctx.db.tx(async (tx) => {
        for (const def of definitions.values()) {
          await tx
            .insert(vocabulary)
            .values({ id: def.id, description: def.description })
            .onConflictDoUpdate({
              target: vocabulary.id,
              set: { description: def.description },
            });
          if (def.terms.length === 0) continue;
          // Only what is missing: a label an administrator changed is not put back.
          await tx
            .insert(vocabularyTerm)
            .values(
              def.terms.map((term) => ({
                id: ids.uuidv7(),
                vocabularyId: def.id,
                key: term.key,
                labels: term.labels,
                sortOrder: term.sortOrder,
                active: true,
                seeded: true,
              })),
            )
            .onConflictDoNothing({ target: [vocabularyTerm.vocabularyId, vocabularyTerm.key] });
        }
      });
    },

    async list(actor) {
      await deps.authz.require(actor, PERMISSION_VOCABULARY_READ);
      const counts = await ctx.db
        .select({
          vocabularyId: vocabularyTerm.vocabularyId,
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${vocabularyTerm.active})::int`,
        })
        .from(vocabularyTerm)
        .groupBy(vocabularyTerm.vocabularyId);
      const byId = new Map(counts.map((row) => [row.vocabularyId, row] as const));
      return [...definitions.values()]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((def) => ({
          id: def.id,
          description: def.description,
          terms: byId.get(def.id)?.total ?? 0,
          activeTerms: byId.get(def.id)?.active ?? 0,
        }));
    },

    async listTerms(actor, vocabularyId, options = {}) {
      await deps.authz.require(actor, PERMISSION_VOCABULARY_READ);
      if (options.includeInactive) await deps.authz.require(actor, PERMISSION_VOCABULARY_WRITE);
      return load(vocabularyId, options);
    },

    async createTerm(actor, vocabularyId, input) {
      await deps.authz.require(actor, PERMISSION_VOCABULARY_WRITE);
      definition(vocabularyId);
      const parsed = createTermInput.safeParse(input);
      if (!parsed.success) throw new Invalid('The term is not valid.', problems(parsed.error));
      const { key, labels } = parsed.data;
      const row = await ctx.db.tx(async (tx) => {
        // One writer at a time per vocabulary, so the default sort order and the limit are exact.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`vocabulary:${vocabularyId}`}))`,
        );
        const existing = await tx
          .select({ key: vocabularyTerm.key, sortOrder: vocabularyTerm.sortOrder })
          .from(vocabularyTerm)
          .where(eq(vocabularyTerm.vocabularyId, vocabularyId));
        if (existing.some((term) => term.key === key)) {
          throw new Conflict(`The vocabulary already has a term "${key}".`);
        }
        if (existing.length >= MAX_TERMS_PER_VOCABULARY) {
          throw new Invalid('The vocabulary is full.', [
            {
              in: 'body',
              path: 'key',
              message: `A vocabulary holds at most ${MAX_TERMS_PER_VOCABULARY} terms.`,
            },
          ]);
        }
        const sortOrder =
          parsed.data.sortOrder ?? Math.max(0, ...existing.map((term) => term.sortOrder)) + 10;
        const [created] = await tx
          .insert(vocabularyTerm)
          .values({
            id: ids.uuidv7(),
            vocabularyId,
            key,
            labels,
            sortOrder,
            active: true,
            seeded: false,
          })
          .returning();
        await emitChange(actor, vocabularyId, key, 'created');
        return created!;
      });
      return view(row, 'en');
    },

    async updateTerm(actor, vocabularyId, key, patch) {
      await deps.authz.require(actor, PERMISSION_VOCABULARY_WRITE);
      definition(vocabularyId);
      const parsed = updateTermInput.safeParse(patch);
      if (!parsed.success) throw new Invalid('The term is not valid.', problems(parsed.error));
      const change = parsed.data;
      const row = await ctx.db.tx(async (tx) => {
        const [current] = await tx
          .select()
          .from(vocabularyTerm)
          .where(and(eq(vocabularyTerm.vocabularyId, vocabularyId), eq(vocabularyTerm.key, key)))
          .for('update');
        if (!current) throw new NotFound(`There is no term "${key.slice(0, 64)}".`);
        const next = {
          labels: change.labels ?? (current.labels as Record<string, string>),
          sortOrder: change.sortOrder ?? current.sortOrder,
          active: change.active ?? current.active,
        };
        const same =
          JSON.stringify(next.labels) === JSON.stringify(current.labels) &&
          next.sortOrder === current.sortOrder &&
          next.active === current.active;
        if (same) return current;
        const [updated] = await tx
          .update(vocabularyTerm)
          .set({ ...next, updatedAt: new Date() })
          .where(eq(vocabularyTerm.id, current.id))
          .returning();
        await emitChange(
          actor,
          vocabularyId,
          key,
          next.active === current.active ? 'updated' : next.active ? 'activated' : 'deactivated',
        );
        return updated!;
      });
      return view(row, 'en');
    },

    async removeTerm(actor, vocabularyId, key) {
      await deps.authz.require(actor, PERMISSION_VOCABULARY_WRITE);
      const def = definition(vocabularyId);
      return ctx.db.tx(async (tx) => {
        const [current] = await tx
          .select()
          .from(vocabularyTerm)
          .where(and(eq(vocabularyTerm.vocabularyId, vocabularyId), eq(vocabularyTerm.key, key)))
          .for('update');
        if (!current) throw new NotFound(`There is no term "${key.slice(0, 64)}".`);
        if (current.seeded || (await inUse(def, key))) {
          if (!current.active)
            return { outcome: 'deactivated' as const, term: view(current, 'en') };
          const [updated] = await tx
            .update(vocabularyTerm)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(vocabularyTerm.id, current.id))
            .returning();
          await emitChange(actor, vocabularyId, key, 'deactivated');
          return { outcome: 'deactivated' as const, term: view(updated!, 'en') };
        }
        await tx.delete(vocabularyTerm).where(eq(vocabularyTerm.id, current.id));
        await emitChange(actor, vocabularyId, key, 'deleted');
        return { outcome: 'deleted' as const, term: null };
      });
    },
  };
}
