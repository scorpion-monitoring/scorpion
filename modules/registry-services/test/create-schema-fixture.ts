// The schema the server builds for the shipped configuration, with a contributed step and field types if a test
// wants them: what `GET /services/schema` answers, without a database. Page tests of the web app load it by path.
import { z } from '@scorpion/contracts';
import { getTableColumns } from 'drizzle-orm';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { validateServicesConfig } from '../config/validate.ts';
import { service } from '../db/schema.ts';
import { buildCreateSchema, type CreateSchema } from '../service/create-schema.ts';
import { SEED_FIELD_TYPES } from '../service/field-types.ts';
import {
  SEED_ORG_ROLES,
  type Choice,
  type FieldTypeEntry,
  type WizardStepEntry,
} from '../service/registries.ts';

const columns = Object.fromEntries(
  Object.entries(getTableColumns(service)).map(([name, column]) => [
    name,
    column.dataType === 'array' ? ('array' as const) : ('scalar' as const),
  ]),
);

/** A text field type of a contributing module: its own widget name, a plain string with a limit. */
export const fixtureFieldType = (id: string, widget = id): FieldTypeEntry => ({
  id,
  labels: { en: id },
  widget,
  storages: ['value'],
  configSchema: z.strictObject({}),
  schema: () => z.string().min(1).max(40),
  jsonSchema: () => ({ type: 'string', minLength: 1, maxLength: 40 }),
});

export const STAGE_CHOICES: Choice[] = [
  { value: 'DEV', label: 'In development' },
  { value: 'PROD', label: 'In production' },
];

export interface FixtureOptions {
  devConsole?: boolean;
  steps?: readonly WizardStepEntry[];
  types?: readonly FieldTypeEntry[];
  locale?: string;
}

/** The schema as the page receives it: through JSON, so a function or an undefined cannot slip into a test. */
export function createSchemaFixture(options: FixtureOptions = {}): CreateSchema {
  const config = validateServicesConfig({
    fields: FIELDS,
    steps: STEPS,
    contributedSteps: options.steps ?? [],
    fieldTypes: [...SEED_FIELD_TYPES, ...(options.types ?? [])],
    orgRoles: SEED_ORG_ROLES,
    columns,
  });
  const schema = buildCreateSchema(config, SEED_ORG_ROLES, {
    devConsole: options.devConsole ?? true,
    ...(options.locale && { locale: options.locale }),
    choices: new Map([['stage', STAGE_CHOICES]]),
  });
  return JSON.parse(JSON.stringify(schema)) as CreateSchema;
}
