// Load for the registry part: the operations of the transform through the modules' services, as the migration account,
// in dependency order (providers, consortia, services). Idempotent by natural keys: an organisation is found by its type
// and abbreviation, a service by its slug; what exists and matches is kept, what differs is updated, the rest created.
// A dry run reads the same way and writes nothing. A record the services refuse is reported and the run goes on; a
// refusal of the account itself (403, 401) stops the run, since every other write would be refused too.
import { Forbidden, Unauthorized, DomainError, type UserActor } from '@scorpion/contracts';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import { PROVIDER_ROLE, type ServicesPublic } from '@scorpion/registry-services/public';
import type { Finding, Kind, OrganisationOp, RegistryPlan, ServiceOp } from './transform.ts';

/** The role of a service's consortia (a key of the registry `service.orgRole`, the field `consortia`). */
export const CONSORTIUM_ROLE = 'consortium';

export interface RegistryPorts {
  organisations: Pick<OrganisationsPublic, 'create' | 'update' | 'findByAbbreviationAsSystem'>;
  services: Pick<ServicesPublic, 'create' | 'update' | 'findBySlugAsSystem'>;
}

/** `merged`: the same organisation as another record of the snapshot, migrated as that one. */
export type Outcome = 'created' | 'kept' | 'changed' | 'merged' | 'dropped';

export interface RecordResult {
  kind: Kind;
  legacy: string;
  /** The abbreviation or the slug in the target. */
  target: string | null;
  outcome: Outcome;
  /** For `changed`: the fields that were updated. */
  fields?: string[];
  /** For a measurement record: the values that were inserted, updated, left as they were, dropped or refused. */
  values?: Record<string, number>;
}

export class RunStopped extends Error {
  readonly results: RecordResult[];
  /** What the stage had found before it stopped. */
  readonly findings: Finding[];
  constructor(
    message: string,
    results: RecordResult[],
    options?: { cause?: unknown; findings?: Finding[] },
  ) {
    super(message, options);
    this.results = results;
    this.findings = options?.findings ?? [];
  }
}

const isFatal = (error: unknown) => error instanceof Forbidden || error instanceof Unauthorized;

/** What the services said, for the report: the message and the fields they named, never a stack. */
function describe(error: DomainError): string {
  const fields = (error.errors ?? []).map((e) => `${e.path}: ${e.message}`).join('; ');
  return fields ? `${error.message} (${fields})` : error.message;
}

/**
 * The guard around one write of the load stage: what the services refuse with a domain error is a finding
 * (`<kind>.refused`) and the record is `dropped`, and the run goes on; a refusal of the account itself (403, 401) stops the
 * run, since every other write would be refused too. Anything else is a bug and is thrown.
 */
export function attemptWith(results: RecordResult[], findings: Finding[]) {
  return async function attempt<T>(
    kind: Kind,
    legacy: string,
    target: string | null,
    work: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true as const, value: await work() };
    } catch (error) {
      if (isFatal(error)) {
        throw new RunStopped(
          `The services refused the migration account at ${kind} ${JSON.stringify(legacy)}: ${(error as Error).message} Nothing after it was written.`,
          results,
          { cause: error, findings },
        );
      }
      if (!(error instanceof DomainError)) throw error;
      findings.push({
        kind,
        legacy,
        rule: `${kind}.refused`,
        effect: 'dropped',
        detail: describe(error),
      });
      results.push({ kind, legacy, target, outcome: 'dropped' });
      return { ok: false as const };
    }
  };
}

export async function loadRegistry(
  plan: RegistryPlan,
  ports: RegistryPorts,
  options: { dryRun: boolean; actor?: UserActor },
): Promise<{ results: RecordResult[]; findings: Finding[] }> {
  const { dryRun } = options;
  if (!dryRun && !options.actor) throw new Error('A run that writes needs the migration account.');
  const actor = options.actor!;
  const results: RecordResult[] = [];
  const findings: Finding[] = [];
  const ids = { provider: new Map<string, string>(), consortium: new Map<string, string>() };
  // In a dry run, what would be created has no id; services that point to it compare as changed.
  const planned = { provider: new Set<string>(), consortium: new Set<string>() };

  const attempt = attemptWith(results, findings);

  async function organisation(op: OrganisationOp) {
    const existing = await ports.organisations.findByAbbreviationAsSystem(op.kind, op.abbreviation);
    if (existing) {
      ids[op.kind].set(op.abbreviation.toLowerCase(), existing.id);
      if (existing.name === op.name) {
        results.push({
          kind: op.kind,
          legacy: op.legacy,
          target: existing.abbreviation,
          outcome: 'kept',
        });
        return;
      }
      const done = await attempt(op.kind, op.legacy, op.abbreviation, async () => {
        if (!dryRun) await ports.organisations.update(actor, existing.id, { name: op.name });
      });
      if (done.ok) {
        results.push({
          kind: op.kind,
          legacy: op.legacy,
          target: existing.abbreviation,
          outcome: 'changed',
          fields: ['name'],
        });
      }
      return;
    }
    const done = await attempt(op.kind, op.legacy, op.abbreviation, async () =>
      dryRun
        ? undefined
        : ports.organisations.create(actor, {
            type: op.kind,
            abbreviation: op.abbreviation,
            name: op.name,
          }),
    );
    if (!done.ok) return;
    if (done.value) ids[op.kind].set(op.abbreviation.toLowerCase(), done.value.id);
    else planned[op.kind].add(op.abbreviation.toLowerCase());
    results.push({ kind: op.kind, legacy: op.legacy, target: op.abbreviation, outcome: 'created' });
  }

  for (const op of plan.providers) await organisation(op);
  for (const op of plan.consortia) await organisation(op);

  async function service(op: ServiceOp) {
    const provider = ids.provider.get(op.provider.toLowerCase());
    const providerPlanned = planned.provider.has(op.provider.toLowerCase());
    if (provider === undefined && !providerPlanned) {
      findings.push({
        kind: 'service',
        legacy: op.legacy,
        rule: 'service.provider-refused',
        effect: 'dropped',
        detail: `its provider ${JSON.stringify(op.provider)} was refused by the services`,
      });
      results.push({ kind: 'service', legacy: op.legacy, target: op.slug, outcome: 'dropped' });
      return;
    }
    const consortia = op.consortia.flatMap((abbreviation) => {
      const id = ids.consortium.get(abbreviation.toLowerCase());
      return id ? [id] : [];
    });
    const consortiaPlanned = op.consortia.some((a) => planned.consortium.has(a.toLowerCase()));
    const missing = op.consortia.filter(
      (a) => !ids.consortium.has(a.toLowerCase()) && !planned.consortium.has(a.toLowerCase()),
    );
    for (const abbreviation of missing) {
      findings.push({
        kind: 'service',
        legacy: op.legacy,
        rule: 'service.consortium-link-dropped',
        effect: 'adjusted',
        detail: `the consortium ${JSON.stringify(abbreviation)} was refused by the services`,
      });
    }

    const existing = await ports.services.findBySlugAsSystem(op.slug);
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (existing.name !== op.name) patch.name = op.name;
      if (existing.stage !== op.stage) patch.stage = op.stage;
      if ((existing.license ?? null) !== op.license) patch.license = op.license;
      const has = (role: string) =>
        existing.organisations
          .filter((o) => o.role === role)
          .map((o) => o.id)
          .sort();
      if (providerPlanned || has(PROVIDER_ROLE).join() !== provider)
        patch.provider = provider ?? op.provider;
      if (consortiaPlanned || has(CONSORTIUM_ROLE).join() !== [...consortia].sort().join()) {
        patch.consortia = consortia;
      }
      const fields = Object.keys(patch);
      if (fields.length === 0) {
        results.push({
          kind: 'service',
          legacy: op.legacy,
          target: existing.slug,
          outcome: 'kept',
        });
        return;
      }
      const done = await attempt('service', op.legacy, existing.slug, async () => {
        if (!dryRun) await ports.services.update(actor, existing.id, patch);
      });
      if (done.ok)
        results.push({
          kind: 'service',
          legacy: op.legacy,
          target: existing.slug,
          outcome: 'changed',
          fields,
        });
      return;
    }
    const done = await attempt('service', op.legacy, op.slug, async () => {
      if (dryRun) return;
      await ports.services.create(actor, {
        slug: op.slug,
        name: op.name,
        stage: op.stage,
        provider,
        ...(consortia.length > 0 ? { consortia } : {}),
        ...(op.license !== null ? { license: op.license } : {}),
      });
    });
    if (done.ok)
      results.push({ kind: 'service', legacy: op.legacy, target: op.slug, outcome: 'created' });
  }

  for (const op of plan.services) await service(op);
  return { results, findings };
}
