// A mail template (registry `notify.template`, M4 plan §5): a typed TypeScript function with the
// Zod schema of its data, flags the preferences need (sprint 3) and an `en` and a `de` catalogue.
// The module that owns the event contributes its templates; `defineTemplate` builds the entry.
import { z } from '@scorpion/contracts';
import { createTranslator, type Catalogue, type Translate } from './i18n.ts';
import {
  inAppFromContent,
  renderLayout,
  type Content,
  type InAppContent,
  type RenderedMail,
  type TemplateBranding,
} from './layout.ts';
import type { Locale } from './locale.ts';

export const TEMPLATE_REGISTRY = 'notify.template';

export interface TemplateContext {
  /** Fills a message of the template's own catalogue in the chosen language. */
  t: Translate;
  branding: TemplateBranding;
  locale: Locale;
}

export interface RenderOptions {
  /** Called when the chosen language lacks a message and English was used. */
  onFallback?: (key: string, locale: Locale) => void;
}

export interface TemplateEntry<Data = unknown> {
  /** `identity.welcome`: lower-case segments joined by dots. */
  key: string;
  /** Validates the data a caller passes. Nothing else reaches `render`. */
  schema: z.ZodType<Data>;
  /** The rendered body holds a credential: it is deleted from the delivery row once sent or dead (ADR 0019). */
  sensitive: boolean;
  /** Groups templates for the user's notification preferences. */
  category: string;
  /**
   * What the category means to a person, in both languages, shown next to its switches. A category
   * takes the description of the first of its templates that has one.
   */
  categoryDescription?: { en: string; de: string };
  /** A security mail: no preference switches it off. */
  mandatory: boolean;
  /** Both languages are required; the start fails without them. */
  catalogue: { en: Catalogue; de: Catalogue };
  render: (
    data: Data,
    locale: Locale,
    branding: TemplateBranding,
    options?: RenderOptions,
  ) => RenderedMail;
  /**
   * The in-app inbox item, from the same content blocks as the mail (no second text source): plain
   * text, one line of title, a capped text and the first link. Never called for a `sensitive` template.
   */
  renderInApp?: (
    data: Data,
    locale: Locale,
    branding: TemplateBranding,
    options?: RenderOptions,
  ) => InAppContent;
}

const catalogueSchema = z.record(z.string(), z.string()).refine((c) => Object.keys(c).length > 0, {
  message: 'must have at least one message',
});

export const templateEntrySchema = z.strictObject({
  key: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, 'use a key like "identity.welcome"'),
  schema: z.custom<z.ZodType>((value) => value instanceof z.ZodType, 'expected a Zod schema'),
  sensitive: z.boolean(),
  category: z
    .string()
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/),
  categoryDescription: z
    .strictObject({ en: z.string().min(1).max(300), de: z.string().min(1).max(300) })
    .optional(),
  mandatory: z.boolean(),
  catalogue: z.strictObject(
    { en: catalogueSchema, de: catalogueSchema },
    { error: 'a template needs a catalogue for "en" and for "de"' },
  ),
  render: z.custom<TemplateEntry['render']>(
    (value) => typeof value === 'function',
    'expected a function',
  ),
  renderInApp: z
    .custom<NonNullable<TemplateEntry['renderInApp']>>(
      (value) => typeof value === 'function',
      'expected a function',
    )
    .optional(),
});

export interface TemplateDefinition<S extends z.ZodType> {
  key: string;
  schema: S;
  sensitive?: boolean;
  category: string;
  categoryDescription?: { en: string; de: string };
  mandatory?: boolean;
  catalogue: { en: Catalogue; de: Catalogue };
  /** The subject, heading and blocks of the mail; the layout does the rest. */
  content: (data: z.output<S>, context: TemplateContext) => Content;
}

export function defineTemplate<S extends z.ZodType>(
  definition: TemplateDefinition<S>,
): TemplateEntry<z.output<S>> {
  return {
    key: definition.key,
    schema: definition.schema as z.ZodType<z.output<S>>,
    sensitive: definition.sensitive ?? false,
    category: definition.category,
    categoryDescription: definition.categoryDescription,
    mandatory: definition.mandatory ?? false,
    catalogue: definition.catalogue,
    render(data, locale, branding, options = {}) {
      const onFallback = (key: string) => options.onFallback?.(key, locale);
      const t = createTranslator(definition.catalogue, locale, { onFallback });
      return renderLayout(
        definition.content(data, { t, branding, locale }),
        branding,
        locale,
        onFallback,
      );
    },
    renderInApp(data, locale, branding, options = {}) {
      const onFallback = (key: string) => options.onFallback?.(key, locale);
      const t = createTranslator(definition.catalogue, locale, { onFallback });
      return inAppFromContent(definition.content(data, { t, branding, locale }));
    },
  };
}
