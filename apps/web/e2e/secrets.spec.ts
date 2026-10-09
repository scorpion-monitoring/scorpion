import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeUser, adminApi, newPerson, unique } from './support/admin.ts';
import { admin, expect, person, signIn, signInThroughPage, test } from './support/fixtures.ts';
import { linkIn, mailTo } from './support/db.ts';
import { readTrace, whereIs } from './support/trace.ts';

// No password, token or reset secret where it does not belong (M5 plan, definition of done, sprint 2).
// One journey through register, sign-in, reset, an access token, an address change and a password change
// runs in a traced browser. Afterwards the trace of the network, the log of the server, the addresses the
// page was at, and the storage of the browser are searched for every secret the journey used.
//
// What a trace can honestly say: a password has to be in the body of the request that sends it, and a
// token in the body of the response that makes it or of the request that spends it. Anywhere else (an
// address, a header, a response, storage, a log) is a leak. The text a test types is also in the trace's
// own action log; that is the test's input and is not read here.

// This test traces by hand, with the network log.
test.use({ trace: 'off' });

const A = person('sec').password;
const B = 'second passphrase of the journey 31';
const C = 'third passphrase of the journey 77';

const PASSWORD_ROUTES = new Set([
  'POST /auth/register requestBody',
  'POST /auth/login requestBody',
  'POST /auth/password-reset/confirm requestBody',
  'POST /account/password requestBody',
  'POST /account/reauthenticate requestBody',
]);

test('no password, token or reset secret is anywhere but in the one request or response that carries it', async ({
  browser,
  playwright,
  baseURL,
  at,
  basePath,
}, testInfo) => {
  // One long journey with snapshots on: a loaded CI runner needs more than the default 30 seconds.
  test.slow();
  const context = await browser.newContext({ baseURL });
  await context.tracing.start({ snapshots: true, screenshots: false, sources: false });
  const page = await context.newPage();
  // The addresses the page was at once it had been used. (The test opens a mailed link, so that address
  // is in the navigation itself; what counts is that the page replaced it, so the history does not keep it.)
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && !frame.url().includes('#token=')) visited.push(frame.url());
  });
  const settled = () => visited.push(page.url());
  const user = person('sec');

  // Registers and is approved (the administrator acts in another browser, outside the trace).
  await page.goto(at('/register'));
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email address').fill('sec@example.org');
  await page.getByLabel('Password', { exact: true }).fill(A);
  await page.getByRole('button', { name: 'Create the account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
  const approver = await playwright.request.newContext({ baseURL });
  const csrf = await signIn(approver, at, admin);
  const pending = (await (await approver.get(at('/api/internal/users/pending'))).json()) as {
    result: { id: string; username: string }[];
  };
  await approver.post(
    at(
      `/api/internal/users/${pending.result.find((u) => u.username === user.username)!.id}/approve`,
    ),
    {
      headers: { 'x-csrf-token': csrf },
      data: {},
    },
  );
  await approver.dispose();

  // Forgets the password and sets a second one through the mailed link.
  await page.goto(at('/forgot-password'));
  await page.getByLabel('Email address').fill('sec@example.org');
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const reset = linkIn(await mailTo(basePath, 'sec@example.org', 'identity.password-reset'));
  await page.goto('about:blank');
  await page.goto(`${at('/reset-password')}#token=${encodeURIComponent(reset.token)}`);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${at('/reset-password')}$`));
  settled();
  await page.getByLabel('New password').fill(B);
  await page.getByRole('button', { name: 'Set the password' }).click();
  await expect(page.getByRole('status')).toContainText('Your password was changed');

  // Signs in, makes an access token and dismisses its secret.
  await page.goto(at('/login'));
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Password', { exact: true }).fill(B);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  await page.goto(at('/profile'));
  const tokens = page.getByRole('region', { name: 'Access tokens' });
  await tokens.getByLabel('Name').fill('secret token');
  await tokens.getByRole('checkbox', { name: 'core.identity.me.read' }).check();
  await tokens.getByRole('button', { name: 'Create the token' }).click();
  const pat = (await page.getByTestId('token-secret').textContent())!;
  await page.getByRole('button', { name: 'I have copied it' }).click();

  // Asks for a new address and confirms it through the mailed link.
  await page.getByLabel('Email address').fill('sec.new@example.org');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('A confirmation was mailed to sec.new@example.org.')).toBeVisible();
  const verify = linkIn(
    await mailTo(basePath, 'sec.new@example.org', 'identity.email-verification'),
  );
  await page.goto('about:blank');
  await page.goto(`${at('/verify-email')}#token=${encodeURIComponent(verify.token)}`);
  await expect(page.getByRole('status')).toContainText('Your email address is confirmed.');
  await expect(page).toHaveURL(new RegExp(`${at('/verify-email')}$`));
  settled();

  // Changes the password, which ends the session, and signs in with the third one.
  const session = (await context.cookies()).find((c) => c.name === '__Host-session')!.value;
  await page.goto(at('/profile'));
  await page.getByLabel('Current password').fill(B);
  await page.getByLabel('New password').fill(C);
  await page.getByRole('button', { name: 'Change the password' }).click();
  await expect(page.getByRole('status').first()).toContainText('Your password was changed');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Password', { exact: true }).fill(C);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  const sessionAfter = (await context.cookies()).find((c) => c.name === '__Host-session')!.value;

  // What the browser itself keeps.
  const kept = await page.evaluate(() =>
    JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
      state: window.history.state as unknown,
      script: document.cookie,
    }),
  );

  const zip = testInfo.outputPath('journey-trace.zip');
  await context.tracing.stop({ path: zip });
  await context.close();

  const exchanges = readTrace(zip);
  expect(exchanges.length, 'the trace has a network log').toBeGreaterThan(20);

  // 1. The trace of the network. Each secret is only where it has to be.
  const where = (secret: string) => whereIs(exchanges, secret, basePath);
  for (const [name, password] of [
    ['A', A],
    ['B', B],
    ['C', C],
  ] as const) {
    const places = where(password);
    expect(places.length, `password ${name} was sent`).toBeGreaterThan(0);
    for (const place of places)
      expect(PASSWORD_ROUTES.has(place), `password ${name}: ${place}`).toBe(true);
  }
  expect(where(reset.token), 'the reset token').toEqual([
    'POST /auth/password-reset/confirm requestBody',
  ]);
  expect(where(verify.token), 'the verification token').toEqual([
    'POST /auth/verify-email requestBody',
  ]);
  expect(where(pat), 'the access token').toEqual(['POST /tokens responseBody']);
  for (const cookie of [session, sessionAfter]) {
    for (const place of where(cookie)) {
      expect(place, 'a session cookie').toMatch(/ (requestHeaders|responseHeaders)$/);
    }
  }

  // 2. The addresses the page was at, and what the browser keeps.
  for (const secret of [A, B, C, reset.token, verify.token, pat, session, sessionAfter]) {
    for (const address of visited) expect(decodeURIComponent(address)).not.toContain(secret);
    expect(kept).not.toContain(secret);
  }
  expect(JSON.parse(kept)).toMatchObject({ script: '' }); // the session cookie cannot be read by script

  // 3. The log of the server.
  const log = readFileSync(
    resolve(import.meta.dirname, `../test-results/stack-${testInfo.project.name}.log`),
    'utf8',
  );
  for (const secret of [A, B, C, reset.token, verify.token, pat, session, sessionAfter]) {
    expect(log).not.toContain(secret);
  }
});

// A secret stored from the settings screen (M5 sprint 3): its value is in the one request that sends it and
// nowhere else. The screen never shows it, the list of secrets never returns it, the box that held it is
// emptied, and neither the address bar, the browser's storage nor the server's log holds it.
test('a secret stored on the settings page is only in the request that sends it', async ({
  browser,
  baseURL,
  at,
  basePath,
}, testInfo) => {
  test.slow();
  const context = await browser.newContext({ baseURL });
  await context.tracing.start({ snapshots: true, screenshots: false, sources: false });
  const page = await context.newPage();
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  const name = `e2e.trace.${randomBytes(4).toString('hex')}`;
  const value = `a-secret-value-${randomBytes(8).toString('hex')}`;

  await page.goto(at('/login'));
  await page.getByLabel('Username').fill(admin.username);
  await page.getByLabel('Password', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

  await page.goto(at('/admin/settings/secrets'));
  await page.getByLabel('Name', { exact: false }).first().fill(name);
  await page.getByLabel('Value', { exact: false }).fill(value);
  await page.getByRole('button', { name: 'Store the secret' }).click();
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByText(`The secret ${name} was stored.`),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('rowheader', { name })).toBeVisible();
  // The page, as the browser holds it, has no trace of the value.
  const html = await page.content();
  const kept = await page.evaluate(() =>
    JSON.stringify({ local: { ...window.localStorage }, session: { ...window.sessionStorage } }),
  );
  await page.getByRole('button', { name: `Delete the secret ${name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('rowheader', { name })).toHaveCount(0);

  const zip = testInfo.outputPath('secret-trace.zip');
  await context.tracing.stop({ path: zip });
  await context.close();

  const exchanges = readTrace(zip);
  expect(exchanges.length, 'the trace has a network log').toBeGreaterThan(10);
  // On the wire the value is in the body of the request that sends it, and nowhere else: no address, no
  // header, no response (not the answer to the PUT, not the list that follows).
  expect(whereIs(exchanges, value, basePath)).toEqual([`PUT /secrets/${name} requestBody`]);
  expect(html).not.toContain(value);
  expect(kept).not.toContain(value);
  for (const address of visited) expect(decodeURIComponent(address)).not.toContain(value);
  const log = readFileSync(
    resolve(import.meta.dirname, `../test-results/stack-${testInfo.project.name}.log`),
    'utf8',
  );
  expect(log).not.toContain(value);
});

const toast = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Notifications' });

// The logs screen (M5 sprint 4) shows the request that stored a secret. The value must not be on that page
// or in any answer behind it: it is in the one request that sends it, as on the settings screen above.
test('a secret stored on the settings page stays out of the logs page and the wire behind it', async ({
  browser,
  baseURL,
  at,
  basePath,
}, testInfo) => {
  test.slow();
  const context = await browser.newContext({ baseURL });
  await context.tracing.start({ snapshots: true, screenshots: false, sources: false });
  const page = await context.newPage();
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  const name = `e2e.logs.${unique('s')}`;
  const value = `a-logged-secret-${unique('v')}-${unique('w')}`;
  await signInThroughPage(page, at, admin);
  await page.goto(at('/admin/settings/secrets'));
  await page.getByLabel('Name', { exact: false }).first().fill(name);
  await page.getByLabel('Value', { exact: false }).fill(value);
  await page.getByRole('button', { name: 'Store the secret' }).click();
  await expect(toast(page).getByText(`The secret ${name} was stored.`)).toBeVisible();

  // The trail has the request; it must not have the value, on the page or in the answers behind it.
  await page.goto(
    at(`/admin/logs?endpoint=${encodeURIComponent('/api/internal/secrets')}&method=PUT`),
  );
  const newest = page.getByRole('table', { name: 'Logs' }).getByRole('row').nth(1);
  await newest.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Log entry', level: 1 })).toBeVisible();
  const html = await page.content();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();

  const zip = testInfo.outputPath('logs-trace.zip');
  await context.tracing.stop({ path: zip });
  await context.close();
  const exchanges = readTrace(zip);
  expect(exchanges.length).toBeGreaterThan(10);
  expect(whereIs(exchanges, value, basePath)).toEqual([`PUT /secrets/${name} requestBody`]);
  expect(html).not.toContain(value);
  for (const address of visited) expect(decodeURIComponent(address)).not.toContain(value);
  const log = readFileSync(
    resolve(import.meta.dirname, `../test-results/stack-${testInfo.project.name}.log`),
    'utf8',
  );
  expect(log).not.toContain(value);

  // Put the stack back.
  const cleanup = await adminApiFor(browser, baseURL, at);
  await cleanup.delete(name);
});

/** Deletes a secret the test stored (a small helper: the page of the test is signed out by then). */
async function adminApiFor(
  browser: import('@playwright/test').Browser,
  baseURL: string | undefined,
  at: (path: string) => string,
) {
  const context = await browser.newContext({ baseURL });
  const login = await context.request.post(at('/api/internal/auth/login'), { data: admin });
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  return {
    async delete(name: string) {
      await context.request.delete(at(`/api/internal/secrets/${encodeURIComponent(name)}`), {
        headers: { 'x-csrf-token': csrf },
      });
      await context.close();
    },
  };
}

// The inbox (M5 sprint 4): a mail whose link is a credential never becomes an inbox item. A person with a
// reset link waiting signs in, opens the bell, the inbox page and the live stream, and the token is on none of
// those pages or answers; the password is in the one request that sends it.
test('the inbox, the bell and the live stream never carry the token of a reset mail', async ({
  browser,
  playwright,
  baseURL,
  at,
  basePath,
}, testInfo) => {
  test.slow();
  const api = await adminApi(playwright, baseURL, at);
  const who = newPerson('inboxsec');
  await activeUser(api, at, who);
  const email = `${who.username}@example.org`;
  expect(
    (await api.request.post(at('/api/internal/auth/password-reset'), { data: { email } })).status(),
  ).toBe(202);
  await api.dispose();
  const reset = linkIn(await mailTo(basePath, email, 'identity.password-reset'));

  const context = await browser.newContext({ baseURL });
  await context.tracing.start({ snapshots: true, screenshots: false, sources: false });
  const page = await context.newPage();
  await signInThroughPage(page, at, who);
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await expect(page.getByRole('region', { name: 'Inbox' })).toBeVisible();
  await page.goto(at('/inbox'));
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  const html = await page.content();
  await page.waitForTimeout(500);
  const zip = testInfo.outputPath('inbox-trace.zip');
  await context.tracing.stop({ path: zip });
  await context.close();

  const exchanges = readTrace(zip);
  expect(exchanges.some((exchange) => exchange.path.endsWith('/inbox/stream'))).toBe(true);
  expect(whereIs(exchanges, reset.token, basePath)).toEqual([]);
  expect(html).not.toContain(reset.token);
  expect(whereIs(exchanges, who.password, basePath)).toEqual(['POST /auth/login requestBody']);
  const log = readFileSync(
    resolve(import.meta.dirname, `../test-results/stack-${testInfo.project.name}.log`),
    'utf8',
  );
  expect(log).not.toContain(reset.token);
});
