import { expect, test } from '../support/fixtures.ts';
import { approve, providerButton, useStubProvider } from '../support/oidc.ts';

// J02: sign in with your institution (OIDC). The provider is a stub on a local port; no third party is called.
// Moved from oidc.spec.ts with every assertion; the steps are what the person sees.
const { signInAs } = useStubProvider();

test.describe('J02: sign in with your institution (OIDC)', () => {
  test('[ASVS-10.2.1] creates an account that waits for approval, and signs in once it is approved', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    signInAs({
      subject: 'sub-newbie',
      email: 'newbie@example.org',
      emailVerified: true,
      preferredUsername: 'newbie',
    });
    await test.step('Choose the institution on the sign-in page', async () => {
      await page.goto(at('/login'));
      await providerButton(page).click();
    });
    await test.step('Learn that the new account waits for approval', async () => {
      // The account exists but waits: nobody is signed in, and the sign-in page says so (ADR-0029: the
      // callback sent the browser here with a fixed code, not a page of JSON).
      await expect(page).toHaveURL(/\/login\?error=account-pending$/);
      await expect(
        page.getByRole('heading', { name: 'Your account is waiting for approval' }),
      ).toBeVisible();
      expect((await page.context().cookies()).some((c) => c.name === '__Host-session')).toBe(false);
    });

    // An administrator approves the account (a call of the API, not a step of this person).
    await approve(playwright, baseURL, at, 'newbie');

    await test.step('Choose the institution again after the approval', async () => {
      await page.goto(at('/login'));
      await providerButton(page).click();
    });
    await test.step('Arrive signed in on the start page, with no password', async () => {
      // Back at the start page of the application, signed in, with no password anywhere.
      await expect(page).toHaveURL(new RegExp(`${at('/')}$`));
      await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
      await page.getByRole('button', { name: 'Account menu' }).click();
      await expect(page.locator('#account-menu').getByText('Signed in as newbie')).toBeVisible();
    });
  });
});
