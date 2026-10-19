// The startup validator of the two config files and of the steps other modules contribute. It refuses to
// start the server (it throws `ServicesConfigError`) with a message that names the file and the field, so
// a broken wizard never reaches a user. Pure: it reads its arguments only.
import type { z } from '@scorpion/contracts';
import {
  FIELD_SCHEMA_ORG_PROPERTIES,
  fieldConfigSchema,
  type FieldConfig,
  type FieldTypeEntry,
  type OrgRoleEntry,
  type ShowIf,
  type WizardStepEntry,
} from '../service/registries.ts';
import { stepConfigSchema, type StepConfig } from './types.ts';

export const FIELDS_FILE = 'config/fields.ts';
export const STEPS_FILE = 'config/steps.ts';

/**
 * The columns of `svc_service` a configured field may write. The rest (`id`, `public`, the icon, the
 * audit columns) are set by the module's own methods and are never configurable.
 */
export const CONFIGURABLE_COLUMNS = [
  'slug',
  'name',
  'license',
  'stage',
  'description',
  'url',
  'sameAs',
  'contactEmail',
  'contactType',
] as const;

/** The NOT NULL columns of `svc_service` without a database default that a create must fill. */
export const REQUIRED_COLUMNS = ['slug', 'name', 'stage'] as const;

export class ServicesConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      `registry.services: the configuration is not valid:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'ServicesConfigError';
    this.problems = problems;
  }
}

/** A field with what the server needs to validate and store a value, resolved from the registries. */
export interface ResolvedField {
  field: FieldConfig;
  /** The step that shows it. */
  step: string;
  type: FieldTypeEntry;
  /** `field.config` after the type's defaults. */
  config: Record<string, unknown>;
  schema: z.ZodType;
}

export interface ResolvedStep {
  id: string;
  order: number;
  title: string;
  intro: readonly string[];
  fields: readonly FieldConfig[];
  component?: string | undefined;
  /** Where the step comes from: this module's config file, or a module that contributes it. */
  source: 'config' | 'contributed';
  applies?: WizardStepEntry['applies'];
  showIf?: ShowIf | undefined;
}

export interface ResolvedConfig {
  fields: readonly ResolvedField[];
  steps: readonly ResolvedStep[];
}

export interface ValidateInput {
  /** `config/fields.ts` and `config/steps.ts` (unknown: a cast must not get past the validator). */
  fields: readonly unknown[];
  steps: readonly unknown[];
  /** Steps other modules contributed, already parsed against the registry schema. */
  contributedSteps?: readonly WizardStepEntry[];
  fieldTypes: readonly FieldTypeEntry[];
  orgRoles: readonly OrgRoleEntry[];
  /** The columns of `svc_service` by property name, with whether the value is a list. */
  columns: Readonly<Record<string, 'scalar' | 'array'>>;
}

const label = (file: string, key: string | undefined, index: number) =>
  key ? `${file}: field "${key}"` : `${file}: field #${index + 1}`;

const issues = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`);

/**
 * Validates and resolves the configuration. Throws {@link ServicesConfigError} listing every problem
 * (not only the first) so one start shows everything to fix.
 */
export function validateServicesConfig(input: ValidateInput): ResolvedConfig {
  const problems: string[] = [];
  const types = new Map(input.fieldTypes.map((type) => [type.id, type]));
  const roles = new Map(input.orgRoles.map((role) => [role.id, role]));

  interface Origin {
    field: FieldConfig;
    where: string;
    step?: string;
  }
  const origins: Origin[] = [];

  // Fields of the file; fields of contributed steps are defined inline and joined below.
  input.fields.forEach((raw, index) => {
    const parsed = fieldConfigSchema.safeParse(raw);
    const key = (raw as { key?: unknown } | null)?.key;
    const where = label(FIELDS_FILE, typeof key === 'string' ? key : undefined, index);
    if (!parsed.success) {
      for (const message of issues(parsed.error)) problems.push(`${where}: ${message}`);
      return;
    }
    origins.push({ field: parsed.data, where });
  });

  // Steps of the file: structure first.
  const ownSteps: StepConfig[] = [];
  input.steps.forEach((raw, index) => {
    const parsed = stepConfigSchema.safeParse(raw);
    const id = (raw as { id?: unknown } | null)?.id;
    const where = `${STEPS_FILE}: step ${typeof id === 'string' ? `"${id}"` : `#${index + 1}`}`;
    if (!parsed.success) {
      for (const message of issues(parsed.error)) problems.push(`${where}: ${message}`);
      return;
    }
    ownSteps.push(parsed.data);
  });

  const fieldByKey = new Map(origins.map((o) => [o.field.key, o.field]));
  const stepOf = new Map<string, string>();
  const resolvedSteps: ResolvedStep[] = [];
  const stepIds = new Set<string>();
  const stepOrders = new Map<number, string>();

  const addStep = (id: string, order: number, where: string) => {
    if (stepIds.has(id)) problems.push(`${where}: the step id "${id}" is used twice`);
    stepIds.add(id);
    const clash = stepOrders.get(order);
    if (clash !== undefined && clash !== id) {
      problems.push(`${where}: order ${order} is already used by step "${clash}"`);
    } else stepOrders.set(order, id);
  };

  for (const step of ownSteps) {
    const where = `${STEPS_FILE}: step "${step.id}"`;
    addStep(step.id, step.order, where);
    if (!step.fields?.length && !step.component) {
      problems.push(`${where}: a step needs "fields" or a "component"`);
    }
    const stepFields: FieldConfig[] = [];
    for (const key of step.fields ?? []) {
      const field = fieldByKey.get(key);
      if (!field) {
        problems.push(`${where}: names the field "${key}", which ${FIELDS_FILE} does not define`);
        continue;
      }
      const other = stepOf.get(key);
      if (other !== undefined) {
        problems.push(`${where}: the field "${key}" is already in step "${other}"`);
        continue;
      }
      stepOf.set(key, step.id);
      stepFields.push(field);
    }
    resolvedSteps.push({
      id: step.id,
      order: step.order,
      title: step.title,
      intro: step.intro ?? [],
      fields: stepFields,
      component: step.component,
      source: 'config',
      ...(step.showIf && { showIf: step.showIf }),
    });
  }

  for (const step of input.contributedSteps ?? []) {
    const where = `service.wizardStep "${step.id}" (contributed)`;
    addStep(step.id, step.order, where);
    if (step.fields.length === 0 && !step.component) {
      problems.push(`${where}: a step needs fields or a component`);
    }
    for (const field of step.fields) {
      const clash = fieldByKey.get(field.key);
      if (clash) {
        problems.push(`${where}: the field key "${field.key}" is already defined (${FIELDS_FILE})`);
        continue;
      }
      fieldByKey.set(field.key, field);
      origins.push({ field, where: `${where}: field "${field.key}"`, step: step.id });
      stepOf.set(field.key, step.id);
    }
    resolvedSteps.push({
      id: step.id,
      order: step.order,
      title: step.title,
      intro: step.intro,
      fields: step.fields,
      component: step.component,
      source: 'contributed',
      ...(step.applies && { applies: step.applies }),
      ...(step.showIf && { showIf: step.showIf }),
    });
  }

  // Keys and pointers.
  const keys = new Map<string, string>();
  const paths = new Map<string, string>();
  const columnUsers = new Map<string, string>();
  const roleUsers = new Map<string, string>();
  const resolvedFields: ResolvedField[] = [];

  for (const { field, where } of origins) {
    const firstKey = keys.get(field.key);
    if (firstKey !== undefined) problems.push(`${where}: the key "${field.key}" is used twice`);
    else keys.set(field.key, where);
    const firstPath = paths.get(field.path);
    if (firstPath !== undefined) problems.push(`${where}: the path "${field.path}" is used twice`);
    else paths.set(field.path, where);
  }
  // A condition must ask about a field of the form, or it could never hold (a typo would hide a field for good).
  for (const { field, where } of origins) {
    if (field.showIf && !paths.has(field.showIf.path)) {
      problems.push(`${where}: showIf asks about "${field.showIf.path}", which no field has`);
    }
  }
  for (const step of resolvedSteps) {
    if (step.showIf && !paths.has(step.showIf.path)) {
      problems.push(
        `step "${step.id}": showIf asks about "${step.showIf.path}", which no field has`,
      );
    }
  }
  // A pointer that is a prefix of another (`/contact` and `/contact/type`) cannot both hold a value.
  for (const path of paths.keys()) {
    for (const other of paths.keys()) {
      if (path !== other && other.startsWith(`${path}/`)) {
        problems.push(
          `${paths.get(path)}: the path "${path}" is also the parent of "${other}" (${paths.get(other)})`,
        );
      }
    }
  }

  for (const { field, where, step } of origins) {
    const type = types.get(field.type);
    if (!type) {
      problems.push(
        `${where}: the field type "${field.type}" is not registered (known: ${[...types.keys()].sort().join(', ')})`,
      );
      continue;
    }
    const config = type.configSchema.safeParse(field.config ?? {});
    if (!config.success) {
      for (const message of issues(config.error)) problems.push(`${where}: config ${message}`);
      continue;
    }
    const parsedConfig = config.data as Record<string, unknown>;

    if (!type.storages.includes(field.storage.kind)) {
      problems.push(
        `${where}: a field of type "${type.id}" cannot use the storage "${field.storage.kind}" (allowed: ${type.storages.join(', ')})`,
      );
    }

    if (field.storage.kind === 'module' && !type.store) {
      problems.push(
        `${where}: the storage "module" needs a field type with a "store" function, and "${type.id}" has none`,
      );
    }

    if (field.storage.kind === 'column') {
      const column = field.storage.column;
      const shape = input.columns[column];
      if (shape === undefined) {
        problems.push(`${where}: the column "${column}" does not exist in svc_service`);
      } else if (!(CONFIGURABLE_COLUMNS as readonly string[]).includes(column)) {
        problems.push(`${where}: the column "${column}" cannot be configured`);
      } else {
        const list = parsedConfig.multiple === true;
        if ((shape === 'array') !== list) {
          problems.push(
            `${where}: the column "${column}" ${shape === 'array' ? 'holds a list, so the field needs "multiple": true' : 'holds one value, so the field must not be "multiple"'}`,
          );
        }
        const first = columnUsers.get(column);
        if (first !== undefined)
          problems.push(`${where}: the column "${column}" is also used by ${first}`);
        else columnUsers.set(column, where);
      }
    }

    if (field.storage.kind === 'organisations') {
      const role = roles.get(field.storage.role);
      if (!role) {
        problems.push(
          `${where}: the organisation role "${field.storage.role}" is not registered (known: ${[...roles.keys()].sort().join(', ')})`,
        );
      } else {
        const list = parsedConfig.multiple === true;
        if (list !== role.max > 1) {
          problems.push(
            `${where}: the role "${role.id}" allows ${role.max} organisation${role.max === 1 ? '' : 's'}, so the field ${list ? 'must not be' : 'needs'} "multiple": true`,
          );
        }
        const first = roleUsers.get(role.id);
        if (first !== undefined)
          problems.push(`${where}: the role "${role.id}" is also used by ${first}`);
        else roleUsers.set(role.id, where);
      }
    }

    if (field.schemaOrg !== undefined) {
      if (!(FIELD_SCHEMA_ORG_PROPERTIES as readonly string[]).includes(field.schemaOrg)) {
        problems.push(
          `${where}: schemaOrg "${field.schemaOrg}" is not allowed (one of ${FIELD_SCHEMA_ORG_PROPERTIES.join(', ')})`,
        );
      } else if (!type.schemaOrg) {
        problems.push(`${where}: a field of type "${type.id}" cannot map to a Schema.org property`);
      }
    }

    if (!stepOf.has(field.key) && step === undefined) {
      problems.push(`${where}: the field is in no step of ${STEPS_FILE}`);
    }

    let schema: z.ZodType;
    try {
      schema = type.schema(parsedConfig);
    } catch (error) {
      problems.push(
        `${where}: the type "${type.id}" refused the config: ${(error as Error).message}`,
      );
      continue;
    }
    if (field.default !== undefined) {
      const result = schema.safeParse(field.default);
      if (!result.success) {
        problems.push(
          `${where}: the default value does not fit the field: ${issues(result.error).join('; ')}`,
        );
      }
    }
    resolvedFields.push({
      field,
      step: step ?? stepOf.get(field.key) ?? '',
      type,
      config: parsedConfig,
      schema,
    });
  }

  // The columns that are NOT NULL without a default must be written by a required field (or one with a default),
  // or no service could be created: a bad config would be a 500 at the first create, not a refusal at start.
  for (const column of REQUIRED_COLUMNS) {
    const holder = origins.find(
      (o) => o.field.storage.kind === 'column' && o.field.storage.column === column,
    );
    if (!holder) {
      problems.push(
        `${FIELDS_FILE}: no field is stored in the column "${column}", which a service needs`,
      );
    } else if (!holder.field.required && holder.field.default === undefined) {
      problems.push(
        `${holder.where}: the column "${column}" is needed, so the field must be "required": true or have a default`,
      );
    }
  }

  // A role that needs at least one organisation must have a required field, or no service could be created.
  for (const role of input.orgRoles) {
    if (role.min < 1) continue;
    const holder = origins.find(
      (o) => o.field.storage.kind === 'organisations' && o.field.storage.role === role.id,
    );
    if (!holder) {
      problems.push(
        `${FIELDS_FILE}: the role "${role.id}" needs at least ${role.min} organisation, but no field is stored under it`,
      );
    } else if (!holder.field.required) {
      problems.push(
        `${holder.where}: the role "${role.id}" is required (min ${role.min}), so the field must be "required": true`,
      );
    }
  }

  if (problems.length > 0) throw new ServicesConfigError(problems);
  resolvedSteps.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { fields: resolvedFields, steps: resolvedSteps };
}
