// What kpi.framework contributes to the registries of registry.services (ADR-0040 addendum): the field type
// `kpi-set` and its wizard step, the facet `kpi-set`, and the policy that lets a service's provider members change
// its KPIs. Entries close over the database and the writer through functions, as the vocabulary `usage` does:
// the manifest is built before either exists.
import { Invalid, z } from '@scorpion/contracts';
import type { Db } from '@scorpion/kernel';
import type {
  FacetEntry,
  FacetSelection,
  FieldTypeEntry,
  WizardStepEntry,
} from '@scorpion/registry-services/public';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { kpiSet, serviceSet } from '../db/schema.ts';
import { MAX_EXTRAS, serviceKpisSchema } from './input.ts';
import { PERMISSION_SERVICE_KPIS_EDIT } from './permissions.ts';
import type { KpisWriter } from './service-kpis.ts';

export const FIELD_TYPE_ID = 'kpi-set';
export const STEP_ID = 'kpi-set';
export const FACET_ID = 'kpi-set';
/** The key of the wizard's field and its place in the form. */
export const FIELD_KEY = 'kpiSet';
export const FIELD_PATH = '/kpiSet';

const UUID = z.uuid();
const isUuid = (value: string) => UUID.safeParse(value).success;

const fieldConfigSchema = z.strictObject({
  /** Offer only the sets that map to this RIMO service category (a term of `kpi.service-category`). */
  rimoCategory: z.string().min(1).max(64).optional(),
});

/** `kpi-set` as the type of a wizard field: the value is `{ setId, extras }`, written by `store` with the service. */
export function kpiSetFieldType(deps: { db: () => Db; writer: () => KpisWriter }): FieldTypeEntry {
  return {
    id: FIELD_TYPE_ID,
    labels: { en: 'KPI set', de: 'KPI-Set' },
    widget: 'kpi-set',
    storages: ['module'],
    configSchema: fieldConfigSchema,
    schema: () => serviceKpisSchema,
    jsonSchema: () => ({
      type: 'object',
      additionalProperties: false,
      required: ['setId', 'extras'],
      properties: {
        setId: { type: ['string', 'null'], minLength: 36, maxLength: 36 },
        extras: {
          type: 'array',
          maxItems: MAX_EXTRAS,
          uniqueItems: true,
          items: { type: 'string', minLength: 36, maxLength: 36 },
        },
      },
    }),
    // An unknown set or indicator is a problem on the field (422), never a database error at the insert.
    async check(value) {
      try {
        await deps.writer().check(serviceKpisSchema.parse(value));
        return undefined;
      } catch (error) {
        if (!(error instanceof Invalid)) throw error;
        return {
          problem: (error.errors ?? []).map((entry) => `${entry.path}: ${entry.message}`).join(' '),
        };
      }
    },
    // The sets a person may choose from, by name; the config may narrow them to one RIMO service category.
    async choices(config) {
      const { rimoCategory } = fieldConfigSchema.parse(config);
      const rows = await deps
        .db()
        .select({ id: kpiSet.id, name: kpiSet.name })
        .from(kpiSet)
        .where(rimoCategory ? eq(kpiSet.rimoCategory, rimoCategory) : undefined)
        .orderBy(sql`lower(${kpiSet.name})`, kpiSet.name, kpiSet.id);
      return rows.map((row) => ({ value: row.id, label: row.name }));
    },
    // Inside the create transaction. A set or an indicator deleted since `check` is a 422 on the field, not a 500.
    async store(tx, change) {
      try {
        await deps
          .writer()
          .write(tx, change.serviceId, serviceKpisSchema.parse(change.value), change.actorId);
      } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === '23503')
          throw new Invalid('The request is not valid.', [
            {
              in: 'body',
              path: FIELD_KEY,
              message: 'The KPI set or an indicator was deleted meanwhile.',
            },
          ]);
        throw error;
      }
    },
  };
}

/** The wizard step after the module's own three (`config/steps.ts` of registry.services: 10, 20, 30). */
export const kpiSetStep: WizardStepEntry = {
  id: STEP_ID,
  order: 40,
  title: 'kpi.wizard.step.title',
  intro: ['kpi.wizard.step.intro'],
  fields: [
    {
      key: FIELD_KEY,
      path: FIELD_PATH,
      type: FIELD_TYPE_ID,
      label: 'kpi.wizard.field.label',
      help: 'kpi.wizard.field.help',
      storage: { kind: 'module' },
    },
  ],
};

/** `keys` (OR), and the services with none when `empty`; nothing is chosen only when both are empty. */
function either(have: SQL, none: SQL, selection: FacetSelection): SQL {
  const parts = [selection.keys.length > 0 ? have : undefined, selection.empty ? none : undefined];
  const chosen = parts.filter((part): part is SQL => part !== undefined);
  return chosen.length === 0 ? sql`false` : sql`(${sql.join(chosen, sql` or `)})`;
}

/** The facet over the set a service uses: counted per set, with "no KPI set" for the services that have none. */
export function kpiSetFacet(deps: { db: () => Db }): FacetEntry {
  const has = (serviceId: SQL) =>
    sql`exists (select 1 from ${serviceSet} where ${serviceSet.serviceId} = ${serviceId})`;
  const names = async (db: Db, keys: readonly string[]) =>
    keys.length === 0
      ? []
      : db
          .select({ id: kpiSet.id, name: kpiSet.name })
          .from(kpiSet)
          .where(inArray(kpiSet.id, [...keys]));
  return {
    id: FACET_ID,
    labels: { en: 'KPI set', de: 'KPI-Set' },
    order: 50,
    emptyLabel: { en: 'No KPI set', de: 'Kein KPI-Set' },
    where: (selection, serviceId) =>
      either(
        sql`exists (select 1 from ${serviceSet} where ${serviceSet.serviceId} = ${serviceId} and ${inArray(serviceSet.setId, selection.keys.filter(isUuid))})`,
        sql`not ${has(serviceId)}`,
        selection,
      ),
    async values(matching, db) {
      const held = await db
        .select({ key: serviceSet.setId, count: sql<number>`count(*)::int` })
        .from(serviceSet)
        .where(sql`${serviceSet.serviceId} in (${matching})`)
        .groupBy(serviceSet.setId);
      const without = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from (${matching}) m(id) where not exists (select 1 from ${serviceSet} where ${serviceSet.serviceId} = m.id)`,
      );
      const values: { key: string | null; count: number }[] = held.map((row) => ({
        key: row.key,
        count: row.count,
      }));
      const none = without.rows[0]?.count ?? 0;
      if (none > 0) values.push({ key: null, count: none });
      return values.sort((a, b) =>
        a.key === b.key ? 0 : a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key),
      );
    },
    async unknownOf(keys, _env, db) {
      const valid = keys.filter(isUuid);
      const known = new Set((await names(db, valid)).map((row) => row.id));
      return keys.filter((key) => !known.has(key));
    },
    async labelsOf(keys) {
      const rows = await names(deps.db(), keys.filter(isUuid));
      return new Map(rows.map((row) => [row.id, row.name]));
    },
    // The legacy `category` of a service row is the name of its KPI set; a client filters by that name.
    v1: {
      field: 'category',
      async valuesOf(serviceIds, db) {
        if (serviceIds.length === 0) return new Map();
        const rows = await db
          .select({ serviceId: serviceSet.serviceId, name: kpiSet.name })
          .from(serviceSet)
          .innerJoin(kpiSet, eq(kpiSet.id, serviceSet.setId))
          .where(inArray(serviceSet.serviceId, [...serviceIds]));
        return new Map(rows.map((row) => [row.serviceId, row.name]));
      },
      async keysOf(wanted, db) {
        if (wanted.length === 0) return new Map();
        const rows = await db
          .select({ id: kpiSet.id, name: kpiSet.name })
          .from(kpiSet)
          .where(
            sql`lower(${kpiSet.name}) in (${sql.join(
              wanted.map((name) => sql`${name.toLowerCase()}`),
              sql`, `,
            )})`,
          );
        const byLower = new Map(rows.map((row) => [row.name.toLowerCase(), row.id]));
        const found = new Map<string, string>();
        for (const name of wanted) {
          const id = byLower.get(name.toLowerCase());
          if (id !== undefined) found.set(name, id);
        }
        return found;
      },
    },
  };
}

/**
 * The policy for the scoped permission of this module (ADR-0036): a user may change the KPIs of a service when the
 * policy `service.member` of registry.services lets them change its identity (an approved manager of its provider; a
 * plain member reads the KPIs and does not change them).
 * The rule is asked of registry.services, which owns the provider links, so it is written once.
 */
export function kpiPolicy(deps: {
  isProviderManager: () => (userId: string, serviceId: string) => Promise<boolean>;
}) {
  return {
    resourceType: 'service',
    async allows(request: {
      actor: { userId: string };
      permission: string;
      resource: { type: string; id?: string | undefined };
    }): Promise<boolean> {
      if (request.permission !== PERMISSION_SERVICE_KPIS_EDIT) return false;
      if (!request.resource.id || !isUuid(request.resource.id)) return false;
      return deps.isProviderManager()(request.actor.userId, request.resource.id);
    },
  };
}
