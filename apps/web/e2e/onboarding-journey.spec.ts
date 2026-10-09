import { admin, expect, person, signInThroughPage, test } from './support/fixtures.ts';

// The acceptance journey of M5 (implementation.md): register → pending → an administrator approves →
// the person signs in → creates an access token → the token works against the API. Then they log out and
// the old cookie fails (defect 4, seen from the browser). Under BASE_PATH `/` and `/a/b`.

test('register → pending → approved → sign in → access token → the token works; log out ends the session', async ({
  page,
  playwright,
  baseURL,
  browser,
  at,
  context,
}) => {
  const eve = person('eve');

  // 1. Registers on the page.
  await page.goto(at('/'));
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Username').fill(eve.username);
  await page.getByLabel('Email address').fill('eve@example.org');
  await page.getByLabel('Password', { exact: true }).fill(eve.password);
  await page.getByRole('button', { name: 'Create the account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();

  // 2. Cannot sign in yet: the page tells them the account waits.
  await page.getByRole('link', { name: 'Go to the sign-in page' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Username').fill(eve.username);
  await page.getByLabel('Password', { exact: true }).fill(eve.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account is waiting for approval' }),
  ).toBeVisible();

  // 3. An administrator approves, on the page: the dashboard card counts the waiting accounts and leads to
  // the list (another browser context).
  const boss = await browser.newContext({ baseURL });
  const adminPage = await boss.newPage();
  await signInThroughPage(adminPage, at, admin);
  await adminPage.goto(at('/'));
  const card = adminPage.getByRole('region', { name: 'Registrations waiting for approval' });
  await expect(card).toContainText(/waits? for your decision/);
  await card.getByRole('link', { name: 'Review the registrations' }).click();
  await adminPage.getByRole('button', { name: `Approve ${eve.username}` }).click();
  await expect(
    adminPage
      .getByRole('region', { name: 'Notifications' })
      .getByText(`${eve.username} was approved.`),
  ).toBeVisible();
  await boss.close();

  // 4. Signs in, and the profile is in the navigation.
  await page.goto(at('/login'));
  await page.getByLabel('Username').fill(eve.username);
  await page.getByLabel('Password', { exact: true }).fill(eve.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  // The approval is the first message in the inbox, and the bell says so.
  const bell = page.getByRole('button', { name: 'Inbox, 1 unread item' });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole('heading', { name: 'Inbox', level: 2 })).toBeVisible();
  await expect(page.getByText('Your account is approved').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Profile' })
    .click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();

  // 5. Creates an access token that may read the account; the secret is shown once.
  const tokens = page.getByRole('region', { name: 'Access tokens' });
  await tokens.getByLabel('Name').fill('journey token');
  await tokens.getByRole('checkbox', { name: 'core.identity.me.read' }).check();
  await tokens.getByRole('button', { name: 'Create the token' }).click();
  const secret = (await page.getByTestId('token-secret').textContent())!;
  expect(secret).toMatch(/^scp_/);
  await page.getByRole('button', { name: 'I have copied it' }).click();
  await expect(page.getByTestId('token-secret')).toHaveCount(0);
  await expect(tokens.getByRole('row', { name: /journey token/ })).toBeVisible();
  // Gone for good: a reload does not show it, and nothing in the page keeps it.
  await page.reload();
  expect(await page.content()).not.toContain(secret);

  // 6. The token works against the API, and only for what its scope allows.
  const bearer = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${secret}` },
  });
  const me = await bearer.get(at('/api/internal/auth/me'));
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { user: { username: string } }).user.username).toBe(eve.username);
  expect((await bearer.get(at('/api/internal/tokens'))).status()).toBe(403);
  await bearer.dispose();

  // 7. Logs out through the page; the old cookie is refused.
  const before = (await context.cookies()).find((cookie) => cookie.name === '__Host-session')!;
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
  const replay = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `__Host-session=${before.value}` },
  });
  expect((await replay.get(at('/api/internal/auth/me'))).status()).toBe(401);
  await replay.dispose();
});
