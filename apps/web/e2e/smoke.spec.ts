import { expect, test } from '@playwright/test';

test('start page shows the product name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scorpion');
});
