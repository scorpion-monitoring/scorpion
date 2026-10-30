import { admin, expect, person, signInThroughPage, test } from '../support/fixtures.ts';
import { adminApi, newPerson, registerPending } from '../support/admin.ts';
import { register } from '../support/register.ts';

// J01: register an account and get approved. The two tests are moved from register.spec.ts and admin-users.spec.ts with
// every assertion: the new person registers and meets the pending page; an Admin approves one account and rejects another.
test.describe('J01: register an account and get approved', () => {
  test('turns a person whose account waits for approval to the pending page, from the answer of the API', async ({
    page,
    at,
  }) => {
    const waiting = person('waiting');
    await test.step('Fill in the registration form', async () => {
      await register(page, at, {
        username: waiting.username,
        email: 'waiting@example.org',
        password: waiting.password,
      });
    });
    await test.step('Read that the confirmation mail is on its way', async () => {
      await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
    });

    await test.step('Try to sign in before the approval', async () => {
      await page.goto(at('/login'));
      await page.getByLabel('Username').fill(waiting.username);
      await page.getByLabel('Password', { exact: true }).fill(waiting.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    });
    await test.step('Read that the account is waiting for approval', async () => {
      await expect(
        page.getByRole('heading', { name: 'Your account is waiting for approval' }),
      ).toBeVisible();
      // Nobody is signed in: the session cookie was never made.
      await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
      expect(
        (await page.context().cookies()).some((cookie) => cookie.name === '__Host-session'),
      ).toBe(false);
    });

    await test.step('Get the ordinary refusal for a wrong password', async () => {
      // The wrong password gets the ordinary refusal, never the pending page: the page cannot be used
      // to learn that a username exists.
      await page.goto(at('/login'));
      await page.getByLabel('Username').fill(waiting.username);
      await page.getByLabel('Password', { exact: true }).fill('not the right password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('The username or password is wrong.');
    });
  });

  test('an Admin approves one account and rejects another on the page the mail links to, and each person is told', async ({
    page,
    playwright,
    baseURL,
    at,
    browser,
  }) => {
    const toast = page.getByRole('region', { name: 'Notifications' });
    const api = await adminApi(playwright, baseURL, at);
    const yes = newPerson('yes');
    const no = newPerson('no');
    await registerPending(api, at, yes);
    await registerPending(api, at, no);
    await test.step('Sign in as an administrator', async () => {
      await signInThroughPage(page, at, admin);
    });

    const table = page.getByRole('table', { name: 'Accounts waiting for approval' });
    await test.step('Open the list of accounts waiting for approval', async () => {
      await page.goto(at('/admin/users/pending'));
      await expect(
        page.getByRole('heading', { name: 'Accounts waiting for approval', level: 1 }),
      ).toBeVisible();
      await expect(table.getByRole('rowheader', { name: yes.username })).toBeVisible();
      await expect(table.getByRole('rowheader', { name: no.username })).toBeVisible();
    });

    await test.step('Approve one account', async () => {
      await table.getByRole('button', { name: `Approve ${yes.username}` }).click();
      await expect(toast.getByText(`${yes.username} was approved.`)).toBeVisible();
      await expect(table.getByRole('rowheader', { name: yes.username })).toHaveCount(0);
    });

    await test.step('Reject another account and confirm', async () => {
      await table.getByRole('button', { name: `Reject ${no.username}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Reject this account?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Reject' }).click();
      await expect(toast.getByText(`${no.username} was rejected.`)).toBeVisible();
      await expect(table.getByRole('rowheader', { name: no.username })).toHaveCount(0);
    });

    // The approved person signs in; the rejected one cannot.
    const context = await browser.newContext({ baseURL });
    const visitor = await context.newPage();
    await test.step('Sign in as the approved person and sign out', async () => {
      await signInThroughPage(visitor, at, yes);
      await visitor.getByRole('button', { name: 'Account menu' }).click();
      await visitor.getByRole('button', { name: 'Log out' }).click();
    });
    await test.step('Fail to sign in as the rejected person', async () => {
      await visitor.goto(at('/login'));
      await visitor.getByLabel('Username').fill(no.username);
      await visitor.getByLabel('Password', { exact: true }).fill(no.password);
      await visitor.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(visitor.getByRole('alert')).toContainText('The username or password is wrong.');
    });
    await context.close();
    await api.dispose();
  });
});
