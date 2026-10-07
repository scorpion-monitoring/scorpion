import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** WCAG 2.1 A and AA, the level the plan sets (§2); only serious and critical findings fail a test. */
const SERIOUS = ['serious', 'critical'];

/** The serious and critical axe violations of the page as it is, as `rule: selector, selector` lines. */
export async function violations(page: Page, include?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  const result = await builder.analyze();
  return result.violations
    .filter((violation) => SERIOUS.includes(violation.impact ?? ''))
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
}
