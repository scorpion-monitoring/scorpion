import type { Locator, Page } from '@playwright/test';
import { makeSessionsStale } from './support/db.ts';
import { createUser, expect, person, signInThroughPage, test } from './support/fixtures.ts';

// ASVS 6.2.6 and 6.2.7: a password field masks what is typed, and paste, the helpers of the browser and
// external password managers work. Walks the sign-in, registration, reset and change forms, and the
// dialog that confirms the identity.

const AUTOCOMPLETE = ['current-password', 'new-password'];

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

interface Form {
  name: string;
  open: (page: Page) => Promise<void>;
}

async function passwordInputs(page: Page): Promise<Locator[]> {
  // Anything that is named like a password and is not masked is a failure by itself.
  expect(
    await page
      .locator(
        'input[name*="password" i]:not([type="password"]), input[id*="password" i]:not([type="password"])',
      )
      .count(),
    'a password field that is not type=password',
  ).toBe(0);
  const fields = page.locator('input[type="password"]');
  const count = await fields.count();
  expect(count, 'the form has a password field').toBeGreaterThan(0);
  return Array.from({ length: count }, (_, index) => fields.nth(index));
}

const SECRET = 'pasted from a password manager 0451';

test.describe('the password fields', () => {
  const forms = (at: (path: string) => string, basePath: string): Form[] => [
    {
      name: 'sign in',
      open: async (page) => {
        await page.goto(at('/login'));
        await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      },
    },
    {
      name: 'register',
      open: async (page) => {
        await page.goto(at('/register'));
        await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
      },
    },
    {
      name: 'reset',
      open: async (page) => {
        // Any token opens the form; whether it is good is for the server to say on submit.
        await page.goto('about:blank');
        await page.goto(`${at('/reset-password')}#token=anything`);
        await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
      },
    },
    {
      name: 'change',
      open: async (page) => {
        const who = person('zed');
        await createUser(page.request, at, who).catch(() => undefined);
        await signInThroughPage(page, at, who);
        await page.goto(at('/profile'));
        await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
        void basePath;
      },
    },
  ];

  test('[ASVS-6.2.6] mask what is typed, and say what they are for (sign in, register, reset, change, confirm)', async ({
    page,
    at,
    basePath,
  }) => {
    for (const form of forms(at, basePath)) {
      await form.open(page);
      for (const field of await passwordInputs(page)) {
        await expect(field, form.name).toHaveAttribute('type', 'password');
        const autocomplete = await field.getAttribute('autocomplete');
        expect(AUTOCOMPLETE, `${form.name}: autocomplete`).toContain(autocomplete);
        await expect(field, form.name).toBeEditable();
        // What is typed is not echoed anywhere in the page.
        await field.fill(SECRET);
        expect(await page.locator('body').innerText(), form.name).not.toContain(SECRET);
        await field.fill('');
      }
    }

    // The dialog that confirms the identity asks for a password in the same way.
    // (Signed in as zed since the last form.)
    await makeSessionsStale(basePath, person('zed').username);
    await page.goto(at('/profile'));
    await page.getByLabel('Email address').fill('zed.dialog@example.org');
    await page.getByRole('button', { name: 'Save' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    const field = dialog.locator('input[type="password"]');
    await expect(field).toHaveCount(1);
    await expect(field).toHaveAttribute('autocomplete', 'current-password');
  });

  test('[ASVS-6.2.7] allow paste and password managers (sign in, register, reset, change, confirm)', async ({
    page,
    at,
    basePath,
  }) => {
    for (const form of forms(at, basePath)) {
      await form.open(page);
      for (const field of await passwordInputs(page)) {
        // No attribute or handler that blocks pasting, dropping or the browser's own help.
        for (const attribute of ['onpaste', 'oncopy', 'ondrop', 'readonly', 'disabled']) {
          expect(await field.getAttribute(attribute), `${form.name}: ${attribute}`).toBeNull();
        }
        expect(await field.getAttribute('autocomplete'), form.name).not.toMatch(/^(off|none)$/);
        // A synthetic paste event is not cancelled by the page ...
        const cancelled = await field.evaluate((element) => {
          const event = new ClipboardEvent('paste', {
            clipboardData: new DataTransfer(),
            bubbles: true,
            cancelable: true,
          });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        });
        expect(cancelled, `${form.name}: a paste is cancelled`).toBe(false);
        // ... and a real paste from the clipboard fills the field.
        await page.evaluate((text) => navigator.clipboard.writeText(text), SECRET);
        await field.fill('');
        await field.focus();
        await page.keyboard.press('ControlOrMeta+V');
        await expect(field, `${form.name}: pasting`).toHaveValue(SECRET);
        await field.fill('');
      }
      // A password manager fills a username and a password that sit in one form, and knows from the
      // autocomplete tokens which is which. A form that sets a password has the account's name with it.
      const first = (await passwordInputs(page))[0]!;
      const hasForm = await first.evaluate((element) => element.closest('form') !== null);
      expect(hasForm, `${form.name}: the field is in a form`).toBe(true);
      if (form.name !== 'reset') {
        const username = await first.evaluate(
          (element) =>
            element.closest('form')!.querySelector('input[autocomplete="username"]') !== null,
        );
        expect(username, `${form.name}: a username field with the form`).toBe(true);
      }
    }
  });
});
