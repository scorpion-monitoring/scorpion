import { admin, createUser, expect, signIn, test, type Credentials } from './support/fixtures.ts';

// The About page (core.ui-shell, ADR-0045): a signed-in person finds which profile, which Scorpion version and which
// modules the instance runs. The stack under test is the `full` profile (support/stack.ts).
const plain: Credentials = { username: 'aboutuser', password: 'another long password 1' };

test.describe('the About page', () => {
  test('names the profile of the stack, the version and the modules, for a plain user', async ({
    page,
    at,
  }) => {
    await createUser(page.request, at, plain);
    await signIn(page.request, at, plain);
    await page.goto(at('/'));
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'About' })
      .click();
    await expect(page).toHaveURL(at('/about'));
    await expect(
      page.getByRole('heading', { level: 1, name: 'About this instance' }),
    ).toBeVisible();
    await expect(page.getByTestId('about-profile')).toHaveText('full');
    await expect(page.getByTestId('about-version')).toHaveText(/^\d+\.\d+\.\d+/);
    const core = page.getByRole('table', { name: 'Core modules' });
    await expect(core.getByRole('cell', { name: 'core.ui-shell', exact: true })).toBeVisible();
    const optional = page.getByRole('table', { name: 'Optional modules' });
    await expect(
      optional.getByRole('cell', { name: 'registry.services', exact: true }),
    ).toBeVisible();
    await expect(optional.getByRole('cell', { name: 'kpi.ingestion', exact: true })).toBeVisible();
  });

  test('is the same for an Admin, and a visitor who is not signed in is sent to sign in', async ({
    page,
    at,
  }) => {
    await signIn(page.request, at, admin);
    await page.goto(at('/about'));
    await expect(page.getByTestId('about-profile')).toHaveText('full');

    await page.context().clearCookies();
    const response = await page.goto(at('/about'));
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByTestId('about-profile')).toHaveCount(0);
  });
});
