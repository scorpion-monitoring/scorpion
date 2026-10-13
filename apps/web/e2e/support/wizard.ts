// What the wizard journeys share: opening the wizard from the catalogue's link, and the first step's two required
// fields. The selectors name the fields by the words a person reads.
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** Opens the create wizard the way a person does: from the services, through the link that offers it. */
export async function openWizard(page: Page, at: (path: string) => string): Promise<void> {
  await page.goto(at('/services'));
  await page.getByRole('link', { name: 'New service' }).click();
  await expect(page).toHaveURL(at('/services/new'));
  await expect(page.getByRole('heading', { name: 'Step 1 of 3: Basics' })).toBeVisible();
}

/** The two fields the first step needs; the rest stays as the page starts it. */
export async function fillBasics(
  page: Page,
  values: { slug: string; name: string },
): Promise<void> {
  await page.getByLabel(/^Short name/).fill(values.slug);
  await page.getByLabel(/^Name/).fill(values.name);
}
