import { expect, signIn, test, admin } from './support/fixtures.ts';

// The prototype of M5 sprint 1 (plan §0 item 6, ADR-0027): the whole stack, with a real browser, must
// keep the `__Host-session` cookie on http://localhost, pass `Set-Cookie` through the proxy, and send it
// back so that a server-rendered page knows who is signed in. Every journey depends on this.
test.describe('the session cookie through the proxy', () => {
  test('is set by the API through the web origin, kept by Chromium, and used for the next page', async ({
    page,
    context,
    at,
  }) => {
    await page.goto(at('/'));
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();

    await signIn(page.request, at, admin);

    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name === '__Host-session');
    expect(session, 'Chromium kept the __Host- cookie on http://localhost').toBeDefined();
    expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });

    // A server-rendered page asks the API with the forwarded cookie and shows who is signed in.
    await page.goto(at('/'));
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await expect(page.getByText(`You are signed in as ${admin.username}.`)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  });
});
