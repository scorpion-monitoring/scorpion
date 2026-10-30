import { expect, person, test } from './support/fixtures.ts';
import { register } from './support/register.ts';

// Registering says the same thing for a new address and a taken one, and a person whose account waits
// for approval is told so by the API's answer, not by the page.

test.describe('registering', () => {
  test('says the same for a new address and for a taken one', async ({ page, at }) => {
    const password = person('x').password;
    await register(page, at, { username: 'newcomer', email: 'shared@example.org', password });
    await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
    const first = await page.getByRole('main').innerText();

    // The same address again, under another username: an account exists, so nothing is created, and
    // the page must not show that.
    await register(page, at, {
      username: 'second-newcomer',
      email: 'shared@example.org',
      password,
    });
    await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
    const second = await page.getByRole('main').innerText();

    expect(second).toBe(first);
    // A person whose earlier registration was declined is told whom to ask, without the page saying who that is.
    expect(second).toContain('declined earlier');
    // Nothing of an account is in the page: not the address, not the name.
    expect(second).not.toContain('shared@example.org');
    expect(second).not.toContain('newcomer');
  });

  test('says when the username is taken (usernames are public)', async ({ page, at }) => {
    const password = person('x').password;
    await register(page, at, { username: 'taken-name', email: 'one@example.org', password });
    await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
    await register(page, at, { username: 'taken-name', email: 'two@example.org', password });
    await expect(page.getByRole('alert')).toHaveText('That username is taken. Choose another one.');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  });

  test('shows the problems the server found, and does not repeat its rules', async ({
    page,
    at,
  }) => {
    await register(page, at, {
      username: 'shorty',
      email: 'shorty@example.org',
      password: 'short',
    });
    // The server's own words, under the field, tied to it.
    const field = page.getByLabel('Password', { exact: true });
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const message = page.locator(`#${await field.getAttribute('aria-describedby')}`).last();
    await expect(message).not.toBeEmpty();
    await expect(page.getByRole('heading', { name: 'Check your mail' })).toHaveCount(0);
  });
});
