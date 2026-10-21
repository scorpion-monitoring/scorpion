import type { Page, Request } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { activeUser, adminApi, newPerson, permissionsOf, type AdminApi } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { pageAs } from './support/members.ts';

// M11 sprint 2: the dashboard on the start page. A signed-in person sees the default dashboard (the cards of what they
// may do), customises it from the FAB menu (add, move and resize with the buttons and with the pointer, remove, reset),
// and it is saved one second after the last change and comes back. Every test makes its own people (the specs of a run
// share one database) and runs under both base paths. What the browser sends itself is counted and printed
// (`[dashboard-calls]`) and written into the report.

const PENDING = 'Registrations waiting for approval';
const DEAD = 'Mail that could not be delivered';
const MEMBERSHIP = 'Membership requests';

/** A new administrator: the default dashboard of an administrator has the pending and the delivery card. */
async function administrator(api: AdminApi, at: (path: string) => string, prefix: string) {
  const credentials = newPerson(prefix);
  const id = await activeUser(api, at, credentials);
  expect((await api.send('POST', `/users/${id}/roles`, { role: 'admin' })).status).toBe(200);
  return { credentials, id };
}

/** What the browser sends to the API itself, and which files it fetches for the grid. */
function watch(page: Page) {
  const calls: string[] = [];
  const gridFiles: string[] = [];
  const puts: Request[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const at = url.pathname.indexOf('/api/internal/');
    if (at >= 0) {
      const call = `${request.method()} ${url.pathname.slice(at + 13)}${url.search}`;
      calls.push(call);
      if (request.method() === 'PUT' && url.pathname.endsWith('/ui/dashboard')) puts.push(request);
    }
  });
  // The grid's code has a hashed file name; it is the script that holds Snapgrid's markup.
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith('.js')) return;
    void response
      .text()
      .then((text) => {
        if (text.includes('snapgrid-item')) gridFiles.push(url.pathname);
      })
      .catch(() => undefined);
  });
  return {
    calls,
    gridFiles,
    puts,
    clear() {
      calls.length = 0;
      puts.length = 0;
    },
  };
}

const tileOf = (page: Page, heading: string) =>
  page.locator('[data-grid-id]').filter({ has: page.getByRole('heading', { name: heading }) });

/**
 * The membership card draws something only when requests wait for a decision, and an administrator is asked about every
 * request of the instance, which the specs that ran before this one may have left. The summary is answered as "nothing
 * waiting", so the layout does not depend on the shared database. (The browser still sends the request; it is counted.)
 */
async function quiet(page: Page) {
  await page.route('**/api/internal/memberships/summary', (route) =>
    route.fulfill({ json: { pending: 0, manages: false } }),
  );
}

const fab = (page: Page) => page.getByRole('button', { name: 'Customise dashboard' });

/** The boxes of the tiles that are drawn, by their heading. */
async function boxes(page: Page, headings: string[]) {
  const found: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
  for (const heading of headings) {
    const tile = tileOf(page, heading).first();
    found[heading] =
      (await tile.count()) > 0 && (await tile.isVisible()) ? await tile.boundingBox() : null;
  }
  return found;
}

const sameBox = (
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number } | null,
) =>
  a !== null &&
  b !== null &&
  Math.abs(a.x - b.x) < 2 &&
  Math.abs(a.y - b.y) < 2 &&
  Math.abs(a.width - b.width) < 2 &&
  Math.abs(a.height - b.height) < 2;

const saved = (page: Page) => page.getByRole('status').filter({ hasText: 'Saved' });

test.describe('journey: a person customises their dashboard', () => {
  test('sees the default dashboard, adds a widget, moves and resizes it with the buttons, removes another, reloads and sees the same layout', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashadm');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    const seen = watch(page);

    // Arrival: the page's load read the document on the server, so the browser asks for the cards' own data only.
    seen.clear();
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: 'What needs your attention' })).toBeVisible();
    await expect(page.getByRole('heading', { name: PENDING })).toBeVisible();
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    // The membership card has nothing to say (nothing is waiting), so it takes no room: not a hole.
    await expect(page.getByRole('heading', { name: MEMBERSHIP })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
    await page.waitForTimeout(2500);
    const original = await boxes(page, [PENDING, DEAD]);
    const arrival = [...seen.calls].sort();
    expect(arrival.filter((call) => call.includes('ui/dashboard'))).toEqual([]);
    expect(seen.puts, 'opening the page never writes').toHaveLength(0);
    console.log(`[dashboard-calls] arrival (a full page load): ${arrival.join(' | ')}`);
    test.info().annotations.push({ type: 'dashboard: arrival', description: arrival.join(' | ') });

    // Edit mode on: the grid is rebuilt, the widgets are not drawn again, so the browser sends nothing.
    seen.clear();
    await fab(page).click();
    await expect(fab(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: `Move ${PENDING}`, exact: true })).toBeVisible();
    await page.waitForTimeout(800);
    expect(seen.calls, 'turning edit mode on sends nothing').toEqual([]);
    console.log('[dashboard-calls] edit mode on (the grid is rebuilt): none');
    test.info().annotations.push({ type: 'dashboard: edit mode', description: 'none' });

    // Take the delivery card off (the save of that is its own burst), then add it again from the menu.
    await page.getByRole('button', { name: `Remove ${DEAD}` }).click();
    await expect(page.getByRole('heading', { name: DEAD })).toHaveCount(0);
    await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => seen.puts.length, { timeout: 5000 }).toBe(1);
    await expect(saved(page)).toBeVisible();

    // One burst: add from the menu, then move and resize with the buttons. The widget reads its own data; nothing is
    // sent while the changes are made, and one save follows the last of them.
    seen.clear();
    await fab(page).click();
    await expect(page.getByRole('button', { name: `Add ${DEAD}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Add ${DEAD}`, exact: true }).click();
    const added = page.getByRole('group', { name: DEAD, exact: true });
    await expect(added).toBeVisible();
    await expect(page.getByRole('button', { name: `Move ${DEAD}`, exact: true })).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: /Mail that could not be delivered added at row/ }),
    ).toBeVisible();
    // The menu closed and edit mode stays on.
    await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');
    const before = await added.boundingBox();
    await page.getByRole('button', { name: `Make ${DEAD} wider` }).click();
    await page.getByRole('button', { name: `Make ${DEAD} wider` }).click();
    await page.getByRole('button', { name: `Move ${DEAD} right` }).click();
    await page.getByRole('button', { name: `Make ${DEAD} taller` }).click();
    await expect(page.getByRole('button', { name: `Make ${DEAD} taller` })).toBeFocused();
    const after = await added.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 50);
    expect(seen.puts, 'nothing is saved while the changes are made').toHaveLength(0);
    await expect.poll(() => seen.puts.length, { timeout: 5000 }).toBe(1);
    await expect(saved(page)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(seen.puts, 'one burst, one save').toHaveLength(1);
    const burst = [...seen.calls];
    expect(burst.filter((call) => !call.startsWith('PUT'))).toEqual(['GET /notifications/status']);
    console.log(`[dashboard-calls] add then four button changes, one burst: ${burst.join(' | ')}`);
    test.info().annotations.push({ type: 'dashboard: a burst', description: burst.join(' | ') });

    // Remove another tile; focus goes to a tile, not to nothing.
    await page.getByRole('button', { name: `Remove ${PENDING}` }).click();
    await expect(page.getByRole('heading', { name: PENDING })).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    await expect.poll(() => seen.puts.length, { timeout: 5000 }).toBe(2);

    // Done turns edit mode off and focus goes back to the FAB button.
    await page.getByRole('button', { name: 'Customise dashboard' }).focus();
    await fab(page).press('Enter');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(fab(page)).toBeFocused();
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
    const view = await boxes(page, [DEAD]);

    // After a reload the same layout comes back.
    await page.reload();
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    await expect(page.getByRole('heading', { name: PENDING })).toHaveCount(0);
    expect(sameBox((await boxes(page, [DEAD]))[DEAD]!, view[DEAD]!)).toBe(true);
    await fab(page).click();
    await expect(page.getByRole('button', { name: `Add ${PENDING}`, exact: true })).toBeEnabled();

    // A second person's dashboard is unaffected.
    const other = await administrator(api, at, 'dashoth');
    const second = await pageAs(browser, baseURL, at, other.credentials);
    await quiet(second.page);
    await expect(second.page.getByRole('heading', { name: DEAD })).toBeVisible();
    await expect(second.page.getByRole('heading', { name: PENDING })).toBeVisible();
    expect(sameBox((await boxes(second.page, [PENDING]))[PENDING]!, original[PENDING]!)).toBe(true);
    await second.close();
    await opened.close();
    await api.dispose();
  });

  test('moves and resizes with the pointer: no request while dragging, one save afterwards', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashptr');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    const seen = watch(page);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    await fab(page).click();
    await page.keyboard.press('Escape');
    await expect(fab(page)).toBeFocused();
    await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');

    seen.clear();
    const dead = tileOf(page, DEAD);
    const start = (await dead.boundingBox())!;
    const grip = (await page
      .getByRole('button', { name: `Move ${DEAD}`, exact: true })
      .boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 40, grip.y + 60, { steps: 5 });
    await page.mouse.move(grip.x - 300, grip.y + 200, { steps: 12 });
    expect(seen.calls, 'a drag sends nothing').toEqual([]);
    await page.mouse.up();
    const moved = (await dead.boundingBox())!;
    expect(Math.abs(moved.x - start.x) + Math.abs(moved.y - start.y)).toBeGreaterThan(40);

    await dead.locator('.dashboard-resize').scrollIntoViewIfNeeded();
    const handle = (await dead.locator('.dashboard-resize').boundingBox())!;
    const size = (await dead.boundingBox())!;
    await page.mouse.move(handle.x + 12, handle.y + 12);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 30, { steps: 4 });
    await page.mouse.move(handle.x + 160, handle.y + 90, { steps: 10 });
    expect(seen.calls.filter((call) => !call.startsWith('PUT'))).toEqual([]);
    await page.mouse.up();
    expect((await dead.boundingBox())!.width).toBeGreaterThan(size.width + 20);
    await expect.poll(() => seen.puts.length, { timeout: 6000 }).toBe(1);
    await page.waitForTimeout(1500);
    expect(seen.puts).toHaveLength(1);
    console.log(`[dashboard-calls] a drag then a resize: ${seen.calls.join(' | ')}`);
    test
      .info()
      .annotations.push({ type: 'dashboard: pointer', description: seen.calls.join(' | ') });

    await page.reload();
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    const restored = (await tileOf(page, DEAD).boundingBox())!;
    expect(
      Math.abs(restored.width - (await dead.boundingBox().catch(() => restored))!.width),
    ).toBeLessThan(2);
    expect(restored.width).toBeGreaterThan(size.width + 20);
    await opened.close();
    await api.dispose();
  });

  test('"Reset to default" shows the default again and stores nothing until the next change', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashrst');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    const seen = watch(page);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    const original = await boxes(page, [PENDING, DEAD]);

    await fab(page).click();
    await page.getByRole('button', { name: `Remove ${PENDING}` }).click();
    await expect(page.getByRole('heading', { name: PENDING })).toHaveCount(0);
    await expect.poll(() => seen.puts.length, { timeout: 5000 }).toBe(1);

    seen.clear();
    await fab(page).click();
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByRole('heading', { name: PENDING })).toBeVisible();
    await expect(fab(page)).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: 'The default dashboard is shown' }),
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(2500);
    expect(seen.puts, 'a reset stores nothing by itself').toHaveLength(0);
    const reset = await boxes(page, [PENDING, DEAD]);
    expect(sameBox(reset[PENDING]!, original[PENDING]!)).toBe(true);
    expect(sameBox(reset[DEAD]!, original[DEAD]!)).toBe(true);
    await opened.close();
    await api.dispose();
  });

  test('a widget the person may no longer see is gone after the reload, with a message, and comes back with the permission', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashgone');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    const seen = watch(page);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: PENDING })).toBeVisible();
    // A change, so that a document is stored.
    await fab(page).click();
    await page.getByRole('button', { name: `Make ${DEAD} taller` }).click();
    await expect.poll(() => seen.puts.length, { timeout: 5000 }).toBe(1);

    expect((await api.send('DELETE', `/users/${who.id}/roles/admin`)).status).toBe(204);
    await page.reload();
    // Nothing is left to draw, so there is no heading and no grid; the message says why.
    await expect(
      page.getByText('2 widgets are no longer available and are not shown.'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: PENDING })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: DEAD })).toHaveCount(0);

    expect((await api.send('POST', `/users/${who.id}/roles`, { role: 'admin' })).status).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: PENDING })).toBeVisible();
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    await expect(page.getByText(/no longer available/)).toHaveCount(0);
    await opened.close();
    await api.dispose();
  });

  test('a save refused as a 422 reloads the repaired document and says what was dropped', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashfix');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    // The administrator role goes while the page is open: the next save names tiles that may no longer be placed.
    expect((await api.send('DELETE', `/users/${who.id}/roles/admin`)).status).toBe(204);
    await fab(page).click();
    await page.getByRole('button', { name: `Make ${DEAD} taller` }).click();
    await expect(page.getByText('Some of your widgets are no longer available.')).toBeVisible();
    await expect(page.getByRole('heading', { name: DEAD })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: PENDING })).toHaveCount(0);
    await opened.close();
    await api.dispose();
  });

  test('a person who may not store preferences sees that the dashboard is not saved, keeps the layout, and can try again', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const credentials = newPerson('dashnop');
    await activeUser(api, at, credentials);
    // The role `user` holds the right to store a preference. It is taken away for this test and put back: the specs of
    // a run take turns on one stack, so nobody else is signed in meanwhile.
    const user = await permissionsOf(api, 'user');
    try {
      const without = user.filter((permission) => permission !== 'core.settings.preference.write');
      expect(without).toHaveLength(user.length - 1);
      expect(
        (await api.send('PUT', '/roles/user/permissions', { permissions: without })).status,
      ).toBe(200);
      const opened = await pageAs(browser, baseURL, at, credentials);
      const page = opened.page;
      const seen = watch(page);
      await page.goto(at('/'));
      await expect(fab(page)).toBeVisible();
      await fab(page).click();
      await page.keyboard.press('Escape');
      // The one widget this person has (the membership card is drawn in edit mode even when it has nothing to say).
      const group = page.getByRole('group', { name: MEMBERSHIP, exact: true });
      await expect(group).toBeVisible();
      const before = (await group.boundingBox())!;
      await page.getByRole('button', { name: `Make ${MEMBERSHIP} taller` }).click();
      await expect.poll(() => seen.puts.length, { timeout: 6000 }).toBe(1);
      const alert = page
        .getByRole('alert')
        .filter({ hasText: 'cannot be saved with your account' });
      await expect(alert).toBeVisible();
      // No permission id or role name in the words.
      expect(await alert.innerText()).not.toMatch(/core\.|reviewer|preference|permission/i);
      // The layout stays on the page, and nothing is sent again by itself.
      const taller = (await group.boundingBox())!;
      expect(taller.height).toBeGreaterThan(before.height + 20);
      await page.waitForTimeout(4000);
      expect(seen.puts, 'no retry loop').toHaveLength(1);
      expect((await group.boundingBox())!.height).toBeCloseTo(taller.height, 0);
      // A retry is a request the person makes.
      await alert.getByRole('button', { name: 'Try again' }).click();
      await expect.poll(() => seen.puts.length).toBe(2);
      await expect(alert).toBeVisible();
      await opened.close();
    } finally {
      await api.send('PUT', '/roles/user/permissions', { permissions: user });
      await api.dispose();
    }
  });

  test('saves a change made a moment before the person leaves the page, and shows it when they come back', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashleave');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    const seen = watch(page);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    await fab(page).click();
    await page.keyboard.press('Escape');
    const before = (await tileOf(page, DEAD).boundingBox())!;
    await page.getByRole('button', { name: `Make ${DEAD} taller` }).click();
    expect(seen.puts, 'the second has not passed yet').toHaveLength(0);
    // A link of the shell: a client-side navigation, which takes the page away at once.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Services' })
      .click();
    await expect(page).toHaveURL(new RegExp(`${at('/services')}`));
    await expect.poll(() => seen.puts.length, { timeout: 5000 }).toBe(1);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Home' })
      .click();
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
    const after = (await tileOf(page, DEAD).boundingBox())!;
    expect(after.height).toBeGreaterThan(before.height + 20);
    await opened.close();
    await api.dispose();
  });

  test('a person whose widgets have nothing to say sees no heading and no grid, only the button, and finds the grid in edit mode', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const credentials = newPerson('dashplain');
    await activeUser(api, at, credentials);
    const opened = await pageAs(browser, baseURL, at, credentials);
    const page = opened.page;
    await quiet(page);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(fab(page)).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'What needs your attention' })).toHaveCount(0);
    await expect(page.locator('[data-grid-id]:visible')).toHaveCount(0);
    // Edit mode shows the grid, with the widget that has nothing to say, so that it can be removed.
    await fab(page).click();
    await expect(page.getByRole('heading', { name: 'What needs your attention' })).toBeVisible();
    await expect(page.getByRole('group', { name: MEMBERSHIP, exact: true })).toBeVisible();
    await expect(page.getByText('This widget has nothing to show right now.')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Customise dashboard' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What needs your attention' })).toHaveCount(0);
    await opened.close();
    await api.dispose();
  });

  test('a visitor sees no grid and no button', async ({ page, at }) => {
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What needs your attention' })).toHaveCount(0);
    await expect(fab(page)).toHaveCount(0);
    await expect(page.locator('[data-grid-id]')).toHaveCount(0);
  });

  test('loads the grid on the start page and on no other page', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashchk');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    const seen = watch(page);
    seen.gridFiles.length = 0;
    for (const path of ['/docs', '/inbox', '/profile', '/admin/users']) {
      await page.goto(at(path));
      await expect(page.getByRole('main')).toBeVisible();
    }
    expect(seen.gridFiles, 'no other page asks for the grid').toEqual([]);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: PENDING })).toBeVisible();
    expect(seen.gridFiles.length).toBeGreaterThan(0);
    // Back to another page by a client navigation, and to the start page again: still one chunk, fetched once.
    const once = new Set(seen.gridFiles);
    expect(once.size).toBe(seen.gridFiles.length);
    await opened.close();
    await api.dispose();
  });

  test('a narrow screen stacks the tiles in reading order and offers no dragging', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashnar');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: PENDING })).toBeVisible();
    await expect(page.locator('.snapgrid')).toHaveCount(0);
    const pending = (await page.getByRole('heading', { name: PENDING }).boundingBox())!;
    const dead = (await page.getByRole('heading', { name: DEAD }).boundingBox())!;
    expect(dead.y).toBeGreaterThan(pending.y);
    expect(Math.abs(dead.x - pending.x)).toBeLessThan(4);
    await fab(page).click();
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
    await expect(page.locator('.dashboard-resize')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Remove ${PENDING}` })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await opened.close();
    await api.dispose();
  });

  test('the whole journey works with the keyboard alone', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const who = await administrator(api, at, 'dashkey');
    const opened = await pageAs(browser, baseURL, at, who.credentials);
    await quiet(opened.page);
    const page = opened.page;
    const seen = watch(page);
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();

    // Open the FAB with Enter, add a widget with Enter.
    await fab(page).focus();
    await page.keyboard.press('Enter');
    await expect(fab(page)).toHaveAttribute('aria-expanded', 'true');
    // Tab order: the button, then the items of the menu.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toMatch(/^Add /);
    await page.getByRole('button', { name: `Add ${DEAD}`, exact: true }).focus();
    await page.keyboard.press('Enter');
    // The delivery card is on the default dashboard already, so the new one is the last of two.
    const grip = page.getByRole('button', { name: `Move ${DEAD}`, exact: true }).last();
    await expect(grip).toBeFocused();

    // Move it with the buttons, resize it, with Enter and Space.
    await page
      .getByRole('button', { name: `Make ${DEAD} wider` })
      .last()
      .focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(
      page.getByRole('status').filter({ hasText: `${DEAD} resized: width 6` }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: `Move ${DEAD} right` })
      .last()
      .focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: `${DEAD} moved to row` }),
    ).toBeVisible();

    // The keyboard drag of dnd-kit on the grip: Space picks up, an arrow moves, Space drops.
    await grip.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[id^="dnd-kit-announcement"]')).toHaveText(
      /Picked up Mail that could not be delivered/,
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await expect(grip).toBeFocused();

    // Remove another tile with the button; focus stays inside the grid.
    await page.getByRole('button', { name: `Remove ${PENDING}` }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: PENDING })).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);

    // Escape closes the menu and puts focus on the FAB button.
    await fab(page).focus();
    await page.keyboard.press('Enter');
    await expect(fab(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(fab(page)).toBeFocused();

    // Done by keyboard, reload, the same dashboard.
    await fab(page).press('Enter');
    await page.getByRole('button', { name: 'Done', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(fab(page)).toBeFocused();
    await expect.poll(() => seen.puts.length, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
    const rects = () =>
      tileOf(page, DEAD).evaluateAll((tiles) =>
        tiles.map((tile) => {
          const { x, y, width, height } = tile.getBoundingClientRect();
          // The page may be scrolled differently before and after a reload: positions are the page's, not the window's.
          return [x + scrollX, y + scrollY, width, height].map(Math.round);
        }),
      );
    const view = await rects();
    await page.reload();
    await expect(page.getByRole('heading', { name: DEAD }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: PENDING })).toHaveCount(0);
    expect(await rects()).toEqual(view);
    expect(view).toHaveLength(2);
    await opened.close();
    await api.dispose();
  });
});

test.describe('accessibility: the dashboard has no serious violation', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`in view mode, in edit mode and with the menu open, ${scheme} theme`, async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const who = await administrator(api, at, `dasha${scheme[0]}`);
      const opened = await pageAs(browser, baseURL, at, who.credentials);
      const page = opened.page;
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(at('/'));
      await expect(page.getByRole('heading', { name: PENDING })).toBeVisible();
      await expect(page.getByRole('heading', { name: DEAD })).toBeVisible();
      expect(await violations(page), 'view mode').toEqual([]);

      await fab(page).click();
      await expect(
        page.getByRole('button', { name: `Move ${PENDING}`, exact: true }),
      ).toBeVisible();
      expect(await violations(page), 'edit mode with the menu open').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(fab(page)).toHaveAttribute('aria-expanded', 'false');
      expect(await violations(page), 'edit mode').toEqual([]);
      await opened.close();
      await api.dispose();
    });
  }
});
