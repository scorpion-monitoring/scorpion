// The six field types this module contributes to `service.fieldType` (ADR-0035). `kpi-set` and any other
// type arrive from other modules. A type is data plus a few functions; this module has no `if` on a
// type id anywhere else.
import { z } from '@scorpion/contracts';
import {
  MAX_SAME_AS,
  MAX_URL_LENGTH,
  parseUrlList,
  TEXT_FORMATS,
  TEXT_PARSERS,
  type TextFormat,
} from './fields.ts';
import type { Choice, ChoiceEnv, FieldTypeEntry } from './registries.ts';

type Config = Record<string, unknown>;

/** A string that `parse` accepts; the issue carries the parser's message. */
function checked<T>(
  parse: (value: string) => { ok: true; value: T } | { ok: false; message: string },
  max: number,
) {
  return z
    .string()
    .max(max * 4) // a cut-off before any work is done on a huge input; the exact limit is in `parse`
    .transform((value, ctx) => {
      const parsed = parse(value);
      if (!parsed.ok) {
        ctx.issues.push({ code: 'custom', message: parsed.message, input: value });
        return z.NEVER;
      }
      return parsed.value;
    });
}

const MAX_LENGTH_OF: Record<TextFormat, number> = {
  plain: 500,
  slug: 64,
  name: 200,
  description: 4000,
  url: MAX_URL_LENGTH,
  email: 254,
  'contact-type': 64,
};

// What the browser checks of a text, as a JSON Schema `pattern`: the shape of what the parsers accept, never
// stricter (a browser that blocks a value the server takes is a bug), and the server still judges. The
// agreement table of `create-schema.test.ts` feeds both the same values.
const NO_CONTROL = '^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]*$';
const EMAIL_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const PATTERN_OF: Partial<Record<TextFormat, string>> = {
  plain: NO_CONTROL,
  name: NO_CONTROL,
  description: NO_CONTROL,
  'contact-type': NO_CONTROL,
  slug: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
  url: '^[hH][tT][tT][pP][sS]?://[^/\\\\?#\\s]\\S*$',
  email: `^(?!\\.)(?![^@]*\\.(?:@|$))(?![^@]*\\.\\.)[A-Za-z0-9.!#$%&'*+/=?^_\`{|}~-]{1,64}@${EMAIL_LABEL}(?:\\.${EMAIL_LABEL})+$`,
};

/** The formats whose parser refuses an empty text (a description may be empty: it means "not set"). */
const NON_EMPTY: ReadonlySet<TextFormat> = new Set([
  'plain',
  'slug',
  'name',
  'url',
  'contact-type',
]);

const textConfig = z
  .strictObject({
    format: z.enum(TEXT_FORMATS).default('plain'),
    /** A list of values; only for `url` (the `sameAs` links). */
    multiple: z.boolean().optional(),
  })
  .refine((config) => !config.multiple || config.format === 'url', {
    message: 'multiple is only available for the format "url"',
    path: ['multiple'],
  });

const text: FieldTypeEntry = {
  id: 'text',
  labels: { en: 'Text', de: 'Text' },
  widget: 'text',
  storages: ['column', 'value'],
  configSchema: textConfig,
  schema(config) {
    const { format, multiple } = textConfig.parse(config);
    if (multiple) {
      return z
        .array(z.string().max(MAX_URL_LENGTH * 4))
        .max(MAX_SAME_AS * 2)
        .transform((values, ctx) => {
          const parsed = parseUrlList(values);
          if (!parsed.ok) {
            ctx.issues.push({ code: 'custom', message: parsed.message, input: values });
            return z.NEVER;
          }
          return parsed.value;
        });
    }
    return checked(TEXT_PARSERS[format], MAX_LENGTH_OF[format]);
  },
  jsonSchema(config) {
    const { format, multiple } = textConfig.parse(config);
    const one = {
      type: 'string',
      ...(NON_EMPTY.has(format) && { minLength: 1 }),
      maxLength: MAX_LENGTH_OF[format],
      ...(PATTERN_OF[format] && { pattern: PATTERN_OF[format] }),
      // `format` tells the browser which control to draw; the `pattern` is what it checks.
      ...(format === 'url' && { format: 'uri' }),
      ...(format === 'email' && { format: 'email' }),
    };
    return multiple ? { type: 'array', maxItems: MAX_SAME_AS, items: one } : one;
  },
  schemaOrg: true,
};

const selectConfig = z
  .strictObject({
    /** The id of a vocabulary of `core.settings`: the options are its active terms. */
    vocabulary: z.string().min(1).max(64).optional(),
    /** A fixed list; `label` is a message key. */
    options: z
      .array(
        z.strictObject({ value: z.string().min(1).max(64), label: z.string().min(1).max(120) }),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .refine((config) => (config.vocabulary === undefined) !== (config.options === undefined), {
    message: 'give exactly one of "vocabulary" and "options"',
  });

function oneOption(config: Config): z.ZodType<string> {
  const { options } = selectConfig.parse(config);
  if (!options) return z.string().min(1).max(64);
  return z.enum(options.map((option) => option.value) as [string, ...string[]]);
}

/** The options of a select: the active terms of its vocabulary, or the fixed list of its config. */
async function choicesOf(config: Config, env: ChoiceEnv): Promise<Choice[]> {
  const { vocabulary, options } = selectConfig.parse(config);
  if (options) return options.map((option) => ({ value: option.value, labelKey: option.label }));
  const terms = await env.terms(vocabulary!);
  return terms.map((term) => ({ value: term.key, label: term.label }));
}

const select: FieldTypeEntry = {
  id: 'select',
  labels: { en: 'Choice', de: 'Auswahl' },
  widget: 'select',
  storages: ['column', 'value'],
  configSchema: selectConfig,
  schema: oneOption,
  jsonSchema(config) {
    const { options } = selectConfig.parse(config);
    return options
      ? { type: 'string', enum: options.map((option) => option.value) }
      : { type: 'string', minLength: 1, maxLength: 64 };
  },
  choices: choicesOf,
  async check(value, config, env) {
    const { vocabulary } = selectConfig.parse(config);
    if (vocabulary === undefined || typeof value !== 'string') return undefined;
    return (await env.vocabularyHas(vocabulary, value))
      ? undefined
      : { problem: `"${value.slice(0, 64)}" is not an available term of "${vocabulary}".` };
  },
  schemaOrg: true,
};

const multiSelect: FieldTypeEntry = {
  id: 'multi-select',
  labels: { en: 'Several choices', de: 'Mehrfachauswahl' },
  widget: 'multi-select',
  storages: ['value'],
  configSchema: selectConfig,
  schema(config) {
    return z
      .array(oneOption(config))
      .max(50)
      .refine((values) => new Set(values).size === values.length, 'Each choice may appear once.');
  },
  jsonSchema(config) {
    const { options } = selectConfig.parse(config);
    return {
      type: 'array',
      maxItems: 50,
      uniqueItems: true,
      items: options
        ? { type: 'string', enum: options.map((option) => option.value) }
        : { type: 'string', minLength: 1, maxLength: 64 },
    };
  },
  choices: choicesOf,
  async check(value, config, env) {
    const { vocabulary } = selectConfig.parse(config);
    if (vocabulary === undefined || !Array.isArray(value)) return undefined;
    for (const item of value as string[]) {
      if (!(await env.vocabularyHas(vocabulary, item))) {
        return { problem: `"${item.slice(0, 64)}" is not an available term of "${vocabulary}".` };
      }
    }
    return undefined;
  },
};

const licenseConfig = z.strictObject({});

const license: FieldTypeEntry = {
  id: 'license',
  labels: { en: 'Licence', de: 'Lizenz' },
  widget: 'license',
  storages: ['column', 'value'],
  configSchema: licenseConfig,
  schema: () => z.string().trim().min(1).max(64),
  jsonSchema: () => ({ type: 'string', minLength: 1, maxLength: 64 }),
  async check(value, _config, env) {
    if (typeof value !== 'string') return undefined;
    const found = await env.findLicence(value);
    if (!found) return { problem: `"${value.slice(0, 64)}" is not an SPDX licence id.` };
    return { value: found.id };
  },
  schemaOrg: true,
};

/** What `z.uuid()` accepts (RFC 4122 versions 1 to 8), as the browser checks it. */
const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

const organisationConfig = z.strictObject({ multiple: z.boolean().optional() });

const organisation: FieldTypeEntry = {
  id: 'organisation',
  labels: { en: 'Organisation', de: 'Organisation' },
  widget: 'organisation',
  storages: ['organisations'],
  configSchema: organisationConfig,
  schema(config) {
    const { multiple } = organisationConfig.parse(config);
    return multiple ? z.array(z.uuid()).max(100) : z.uuid();
  },
  jsonSchema(config) {
    const { multiple } = organisationConfig.parse(config);
    const one = { type: 'string', format: 'uuid', pattern: UUID_PATTERN };
    return multiple ? { type: 'array', maxItems: 100, items: one } : one;
  },
};

const image: FieldTypeEntry = {
  id: 'image',
  labels: { en: 'Image', de: 'Bild' },
  widget: 'image',
  storages: ['icon'],
  configSchema: z.strictObject({}),
  // The image is uploaded after the service exists (the blob is referenced by the service id); the
  // create body never carries it.
  schema: () => z.never({ error: 'The image is uploaded after the service has been created.' }),
  jsonSchema: () => ({ type: 'string', description: 'Uploaded after the service exists.' }),
};

export const SEED_FIELD_TYPES: FieldTypeEntry[] = [
  text,
  select,
  multiSelect,
  license,
  organisation,
  image,
];
