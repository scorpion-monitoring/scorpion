// The templates of the profile, from the registry `notify.template`. Built once when the module's
// service is built. The kernel has already checked every entry against `templateEntrySchema` (an
// entry without an `en` and a `de` catalogue fails the start); what it cannot check is a key that
// two modules contribute.
import { KernelStartupError } from '@scorpion/kernel';
import { templateEntrySchema, type TemplateEntry } from './define.ts';

export type TemplateIndex = ReadonlyMap<string, TemplateEntry>;

export function buildTemplateIndex(entries: readonly unknown[]): TemplateIndex {
  const index = new Map<string, TemplateEntry>();
  const twice: string[] = [];
  for (const value of entries) {
    const entry = templateEntrySchema.parse(value) as TemplateEntry;
    if (index.has(entry.key)) twice.push(entry.key);
    else index.set(entry.key, entry);
  }
  if (twice.length > 0) {
    throw new KernelStartupError(
      'Cannot start core.notifications:',
      twice.map((key) => `the template "${key}" is contributed twice`),
    );
  }
  return index;
}
