import { makePng } from '@scorpion/testing';
import { expect, test } from '../support/fixtures.ts';
import { profileOf } from '../support/profile.ts';

// J03: set up your profile. Moved from profile.spec.ts with every assertion: the details and the picture. Linking a
// provider to the account is `oidc.spec.ts` ("starts linking a provider from the profile"), which needs the stub provider.
test.describe('J03: set up your profile', () => {
  test('the details are saved, shown as text and kept after a reload', async ({ page, at }) => {
    await test.step('Open your profile', async () => {
      await profileOf(page, at, 'ivy');
      await expect(page.getByRole('term').filter({ hasText: 'Roles' })).toBeVisible();
      await expect(page.locator('dd').filter({ hasText: /^user$/ })).toBeVisible();
    });

    await test.step('Enter a display name and a short text about you', async () => {
      await page.getByLabel('Display name').fill('Ivy Example');
      // Markup in a bio is text, never HTML.
      await page.getByLabel('About you').fill('Hello <b>world</b> <img src=x onerror=alert(1)>');
    });
    await test.step('Save the details', async () => {
      await page.getByRole('button', { name: 'Save' }).first().click();
      await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    });
    await test.step('Reload the page and find the details as you typed them', async () => {
      await page.reload();
      await expect(page.getByLabel('Display name')).toHaveValue('Ivy Example');
      await expect(page.getByLabel('About you')).toHaveValue(
        'Hello <b>world</b> <img src=x onerror=alert(1)>',
      );
      expect(await page.locator('main b').count()).toBe(0);
    });
  });

  test('the picture is uploaded, shown from the stored copy, and removed', async ({ page, at }) => {
    await test.step('Open your profile', async () => {
      await profileOf(page, at, 'kai');
      await expect(page.getByText('You have not set a picture.')).toBeVisible();
    });
    await test.step('Choose a picture', async () => {
      await page.getByLabel('Choose a picture').setInputFiles({
        name: 'me.png',
        mimeType: 'image/png',
        buffer: makePng(16),
      });
      const image = page.getByRole('img', { name: 'Picture of kai' });
      await expect(image).toBeVisible();
      // The page shows the server's own copy, by the hash of its content.
      await expect(image).toHaveAttribute(
        'src',
        new RegExp(`${at('/api/internal/files/')}[0-9a-f]{64}$`),
      );
      expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    });
    await test.step('Remove the picture', async () => {
      await page.getByRole('button', { name: 'Remove the picture' }).click();
      await expect(page.getByText('You have not set a picture.')).toBeVisible();
    });
  });
});
