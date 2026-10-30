import { expect, test } from '../support/fixtures.ts';
import { profileOf } from '../support/profile.ts';

// J04: create, use and rotate a personal access token. Moved from profile.spec.ts with every assertion.
test.describe('J04: create, use and rotate a personal access token', () => {
  test('a token is created with a scope, replaced and revoked; the secret is shown once', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    await test.step('Open your profile', async () => {
      await profileOf(page, at, 'oli');
    });
    const tokens = page.getByRole('region', { name: 'Access tokens' });

    await test.step('Try to create a token without a permission', async () => {
      // A token needs a name and at least one permission: the server says so.
      await tokens.getByLabel('Name').fill('first');
      await tokens.getByRole('button', { name: 'Create the token' }).click();
      await expect(tokens.getByText(/at least one permission/i)).toBeVisible();
    });

    let first = '';
    await test.step('Tick a permission and create the token', async () => {
      await tokens.getByRole('checkbox', { name: 'core.identity.me.read' }).check();
      await tokens.getByRole('button', { name: 'Create the token' }).click();
      first = (await page.getByTestId('token-secret').textContent())!;
      await expect(page.getByText('This is the only time it is shown.')).toBeVisible();
    });

    const api = async (secret: string) =>
      (
        await (
          await playwright.request.newContext({
            baseURL,
            extraHTTPHeaders: { authorization: `Bearer ${secret}` },
          })
        ).get(at('/api/internal/auth/me'))
      ).status();
    let second = '';
    await test.step('Replace the token to rotate it', async () => {
      // Replacing it shows a new secret, and the old one stops working.
      await page.getByRole('button', { name: 'I have copied it' }).click();
      await tokens.getByRole('button', { name: 'Replace the token first' }).click();
      second = (await page.getByTestId('token-secret').textContent())!;
      expect(second).not.toBe(first);
    });
    await test.step('Use the new token, and find the old one refused', async () => {
      expect(await api(first)).toBe(401);
      expect(await api(second)).toBe(200);
    });

    await test.step('Revoke the token and confirm', async () => {
      // Revoking asks twice.
      await page.getByRole('button', { name: 'I have copied it' }).click();
      await tokens.getByRole('button', { name: 'Revoke the token first' }).click();
      await tokens.getByRole('button', { name: 'Really revoke the token first' }).click();
      await expect(tokens.getByText('You have no access tokens.')).toBeVisible();
    });
    await test.step('Find the revoked token refused', async () => {
      expect(await api(second)).toBe(401);
    });
  });
});
