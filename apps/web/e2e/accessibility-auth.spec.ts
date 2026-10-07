import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { makeSessionsStale } from './support/db.ts';
import { createUser, expect, person, signInThroughPage, test } from './support/fixtures.ts';

// No serious or critical accessibility violation (axe, WCAG 2.1 A and AA) on the sign-in, registration,
// recovery and profile pages, in both themes, with the re-authentication dialog open, and the forms work
// with the keyboard alone (M5 plan, §2).
const SERIOUS = ['serious', 'critical'];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((violation) => SERIOUS.includes(violation.impact ?? ''))
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
}

// A colour that is still fading in at the moment axe looks is not what a visitor sees: motion is off here.
test.use({ reducedMotion: 'reduce' });

test.describe('the pages of a visitor', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`have no serious violation, ${scheme} theme`, async ({ page, at }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const heading = async (name: string) =>
        expect(page.getByRole('heading', { name }).first()).toBeVisible();

      await page.goto(at('/login'));
      await heading('Sign in');
      expect(await violations(page), '/login').toEqual([]);
      // With a failure showing, and with the notice of a provider sign-in.
      await page.getByLabel('Username').fill('nobody');
      await page.getByLabel('Password', { exact: true }).fill('wrong password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page), '/login with an error').toEqual([]);
      await page.goto(`${at('/login')}?notice=check-mail`);
      await expect(page.getByRole('status').first()).toBeVisible();
      expect(await violations(page), '/login with a notice').toEqual([]);

      await page.goto(at('/register'));
      await heading('Create an account');
      expect(await violations(page), '/register').toEqual([]);
      await page.getByLabel('Username').fill('a11y-visitor');
      await page.getByLabel('Email address').fill('a11y@example.org');
      await page.getByLabel('Password', { exact: true }).fill('short');
      await page.getByRole('button', { name: 'Create the account' }).click();
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(await violations(page), '/register with a field error').toEqual([]);

      await page.goto(at('/forgot-password'));
      await heading('Forgot your password?');
      expect(await violations(page), '/forgot-password').toEqual([]);

      await page.goto('about:blank');
      await page.goto(`${at('/reset-password')}#token=anything`);
      await heading('Choose a new password');
      expect(await violations(page), '/reset-password').toEqual([]);
      await page.goto('about:blank');
      await page.goto(at('/reset-password'));
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page), '/reset-password without a link').toEqual([]);

      await page.goto(at('/verify-email'));
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page), '/verify-email').toEqual([]);
    });
  }
});

test.describe('the pages of a signed-in person', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`have no serious violation, ${scheme} theme`, async ({ page, at, basePath }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const who = person(`a11y${scheme}`);
      await createUser(page.request, at, who);
      await signInThroughPage(page, at, who);

      await page.goto(at('/profile'));
      await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
      expect(await violations(page), '/profile').toEqual([]);

      // With a token shown, and with the confirmation dialog open.
      const tokens = page.getByRole('region', { name: 'Access tokens' });
      await tokens.getByLabel('Name').fill('a11y token');
      await tokens.getByRole('checkbox', { name: 'core.identity.me.read' }).check();
      await tokens.getByRole('button', { name: 'Create the token' }).click();
      await expect(page.getByTestId('token-secret')).toBeVisible();
      expect(await violations(page), '/profile with a secret shown').toEqual([]);

      await makeSessionsStale(basePath, who.username);
      await page.getByLabel('Email address').fill(`${who.username}.new@example.org`);
      await page.getByRole('button', { name: 'Save' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Confirm your identity' })).toBeVisible();
      expect(await violations(page), 'the dialog').toEqual([]);

      await page.goto(`${at('/link-sign-in')}`);
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await violations(page), '/link-sign-in without a link').toEqual([]);
    });
  }
});

test.describe('the keyboard', () => {
  test('signs a person in with Tab, typing and Enter alone', async ({ page, at }) => {
    const who = person('keys');
    await createUser(page.request, at, who);
    await page.goto(at('/login'));
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Username').focus();
    await page.keyboard.type(who.username);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await page.keyboard.type(who.password);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  });

  test('the dialog keeps focus inside, and Escape returns it to the button that was used', async ({
    page,
    at,
    basePath,
  }) => {
    const who = person('keysdialog');
    await createUser(page.request, at, who);
    await signInThroughPage(page, at, who);
    await makeSessionsStale(basePath, who.username);
    await page.goto(at('/profile'));
    await page.getByLabel('Email address').fill('keys.new@example.org');
    const save = page.getByRole('button', { name: 'Save' }).first();
    await save.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    await expect(dialog).toBeVisible();
    // The page behind the dialog is inert: Tab goes round inside it (or out to the browser's own
    // controls, which the page sees as no focus at all) and never lands on the page behind.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      const behind = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active !== null &&
          active !== document.body &&
          !document.querySelector('dialog[open]')?.contains(active)
        );
      });
      expect(behind, 'focus is on the page behind the dialog').toBe(false);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(save).toBeFocused();
  });
});
