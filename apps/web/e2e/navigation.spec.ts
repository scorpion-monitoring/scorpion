import type { Page } from '@playwright/test';
import { admin, createUser, expect, signIn, test, type Credentials } from './support/fixtures.ts';

// ASVS 7.4.4 (V7 session management): a logout control is reachable on every page that needs a sign-in.
// The test walks what the navigation offers, as the API computes it for the role, and looks for the
// control on each page; later sprints add pages to the navigation and this test covers them without a
// change. A second part logs out and shows that the old cookie is refused.

interface Navigation {
  nav: { id: string; path: string }[];
  routes: string[];
}

const plain: Credentials = { username: 'plainuser', password: 'another long password 1' };

async function logoutControl(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  const control = page.getByRole('button', { name: 'Log out' });
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  return control;
}

async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
}

test.describe('the navigation of a signed-in user', () => {
  for (const [role, credentials] of [
    ['a plain User', plain],
    ['an Admin', admin],
  ] as const) {
    test(`[ASVS-7.4.4] ${role} finds the logout control on every page of the navigation`, async ({
      page,
      at,
    }) => {
      if (credentials === plain) await createUser(page.request, at, plain);
      await signIn(page.request, at, credentials);

      const navigation = (await (
        await page.request.get(at('/api/internal/ui/navigation'))
      ).json()) as Navigation;
      expect(navigation.nav.length).toBeGreaterThan(0);
      if (credentials === plain) {
        // A plain User is offered nothing of the administration, in the links or in the pages.
        expect(JSON.stringify(navigation)).not.toMatch(/admin/i);
      }

      // Every link of the navigation, every page without a parameter, and the pages that answer with an error.
      const paths = new Set([
        ...navigation.nav.map((entry) => entry.path),
        ...navigation.routes.filter((route) => !route.includes(':')),
        '/no/such/page',
      ]);
      expect(paths.size).toBeGreaterThan(2);
      for (const path of paths) {
        await page.goto(at(path));
        await expect(page.getByRole('banner')).toBeVisible();
        await logoutControl(page);
        await closeMenu(page);
      }
    });
  }

  test('[ASVS-7.4.4] logging out ends the session, and the old cookie is refused', async ({
    page,
    context,
    playwright,
    baseURL,
    at,
  }) => {
    await signIn(page.request, at, admin);
    await page.goto(at('/docs'));
    const before = (await context.cookies()).find((cookie) => cookie.name === '__Host-session');
    expect(before).toBeDefined();
    const oldCookie = `__Host-session=${before!.value}`;

    // The old cookie is good while the session lives.
    const holder = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: oldCookie },
    });
    expect((await holder.get(at('/api/internal/auth/me'))).status()).toBe(200);

    // The control on the page ends it.
    const logout = await logoutControl(page);
    await logout.click();
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    expect(
      (await context.cookies()).find((cookie) => cookie.name === '__Host-session')?.value ?? '',
    ).not.toBe(before!.value);

    // The old cookie, replayed, is refused by the API and gives a page nobody is signed in on.
    const refused = await holder.get(at('/api/internal/auth/me'));
    expect(refused.status()).toBe(401);
    const stolen = await context.browser()!.newContext({ baseURL });
    await stolen.addCookies([
      {
        name: '__Host-session',
        value: before!.value,
        domain: 'localhost',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const replay = await stolen.newPage();
    await replay.goto(at('/'));
    await expect(replay.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
    await expect(replay.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    await stolen.close();
    await holder.dispose();
  });
});
