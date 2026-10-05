// The user preference `notifications.preferences` (sprint 3): per template category, whether mail
// and the in-app inbox are wanted. Stored through core.settings' own preference routes; read here
// with the trusted `getUserPreference`, so the arrow stays notifications → settings (ADR 0023).
import { z } from '@scorpion/contracts';

export const PREFERENCES_KEY = 'notifications.preferences';

const CATEGORY = /^[a-z][a-z0-9-]*$/;

/** One category's switches. A missing switch means "on". */
const switches = z.strictObject({ email: z.boolean().optional(), inApp: z.boolean().optional() });

/**
 * The stored value: `{ account: { email: false }, reminders: { inApp: false } }`. Any well-formed
 * category key is accepted, not only the ones the profile knows today: a profile change must not
 * make a person's stored choices fail validation and silently reset (`getUserPreference` returns
 * `undefined` for a value that no longer passes). Unknown categories are ignored when a mail is sent.
 */
export const preferencesSchema = z
  .record(z.string().max(64).regex(CATEGORY), switches)
  .refine((value) => Object.keys(value).length <= 64, 'must name at most 64 categories');

export type Preferences = z.infer<typeof preferencesSchema>;

export interface ChannelChoice {
  email: boolean;
  inApp: boolean;
}

/**
 * Which channels a person wants for one template. Pure. Default: both on. A `mandatory` template
 * ignores the stored value whatever it says (the switch is ignored here, not in a UI). A stored
 * value that does not fit the schema is treated as not set.
 */
export function resolveChannels(
  template: { category: string; mandatory: boolean },
  stored: unknown,
): ChannelChoice {
  if (template.mandatory) return { email: true, inApp: true };
  const parsed = preferencesSchema.safeParse(stored);
  const mine = parsed.success ? parsed.data[template.category] : undefined;
  return { email: mine?.email !== false, inApp: mine?.inApp !== false };
}

export interface CategoryInfo {
  category: string;
  description: { en: string; de: string } | null;
  /** True when every template of the category is mandatory: its switches do nothing. */
  mandatory: boolean;
  /** The template keys, sorted: a UI may show what a category sends. */
  templates: string[];
}

/** The categories of the template registry, sorted by key. Built from the templates, never a list of its own. */
export function categoriesOf(
  templates: Iterable<{
    key: string;
    category: string;
    mandatory: boolean;
    categoryDescription?: { en: string; de: string };
  }>,
): CategoryInfo[] {
  const byCategory = new Map<string, CategoryInfo>();
  for (const template of templates) {
    const found = byCategory.get(template.category) ?? {
      category: template.category,
      description: null,
      mandatory: true,
      templates: [],
    };
    found.description ??= template.categoryDescription ?? null;
    found.mandatory &&= template.mandatory;
    found.templates.push(template.key);
    byCategory.set(template.category, found);
  }
  return [...byCategory.values()]
    .map((info) => ({ ...info, templates: info.templates.sort() }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
