import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { admin, expect, person, signIn, test } from './support/fixtures.ts';
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
