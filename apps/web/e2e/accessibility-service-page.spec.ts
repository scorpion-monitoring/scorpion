import type { Locator, Page } from '@playwright/test';
import { makePng } from '@scorpion/testing';
import { violations } from './support/a11y.ts';
import { adminApi, newPerson, unique } from './support/admin.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';
import { makeConsortium, makeReviewer } from './support/services.ts';
import { expect, test } from './support/fixtures.ts';

// M7 sprint 6 (plan §10 item 6): no serious or critical axe violation on the service page in view and edit mode,
// on both confirm dialogs and on the two public pages, in both themes, with an icon whose `alt` text comes from the
// name; and keyboard-only paths through edit, rename, publish and unpublish, with the focus returning to a sensible
// element after each dialog and action.

test.use({ reducedMotion: 'reduce' });

/** Presses Tab until the element has the focus; fails when the keyboard cannot reach it. */
async function tabTo(page: Page, target: Locator, presses = 120) {
  for (let i = 0; i < presses; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`the keyboard cannot reach ${String(target)}`);
}

/** Replaces the text of the focused field with the keyboard. */
async function typeOver(page: Page, text: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
}

async function world(
  playwright: Parameters<typeof adminApi>[0],
  baseURL: string | undefined,
  at: (path: string) => string,
  browser: Parameters<typeof pageAs>[0],
) {
  const api = await adminApi(playwright, baseURL, at);
  const provider = await makeOrg(api, uniqueAbbreviation('AXP'));
  const consortium = await makeConsortium(api, uniqueAbbreviation('AXC'));
  const manager = newPerson('axmgr');
  await memberOf(api, playwright, baseURL, at, manager, provider, 'manager');
  const reviewer = newPerson('axrev');
  await makeReviewer(api, at, reviewer);
  const tag = unique('ax');
  const made = await api.send('POST', '/services', {
    slug: `${tag}-svc`,
    name: `${tag} Accessible service`,
    provider: provider.id,
    consortia: [consortium.id],
    description: `A service for the checks ${tag}`,
    url: `https://example.org/${tag}`,
    sameAs: [`https://example.org/${tag}/more`],
    license: 'MIT',
    contact: { email: `team-${tag}@example.org`, type: 'support' },
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const service = {
    id: (made.body as { id: string }).id,
    slug: `${tag}-svc`,
    name: `${tag} Accessible service`,
  };
  const icon = await api.request.put(at(`/api/internal/services/${service.id}/icon`), {
    headers: { 'x-csrf-token': api.csrf, 'content-type': 'application/octet-stream' },
    data: makePng(32),
  });
  expect(icon.status(), await icon.text()).toBe(200);
  return { api, provider, consortium, manager, reviewer, service, browser };
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the service page, ${scheme} theme`, () => {
    test('has no serious violation in view and edit mode, in both dialogs and on the public pages', async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const w = await world(playwright, baseURL, at, browser);
      const { service } = w;
      const clean = async (page: Page, what: string) =>
        expect(await violations(page), what).toEqual([]);

      // The manager: the view (with an icon whose alt text comes from the name) and the edit form.
      const managing = await pageAs(browser, baseURL, at, w.manager);
      const page = managing.page;
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(at(`/services/${service.slug}`));
      await expect(page.getByRole('img', { name: `Icon of ${service.name}` })).toBeVisible();
      await clean(page, 'the service page, view');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.getByRole('heading', { name: `Edit ${service.name}` })).toBeVisible();
      await clean(page, 'the service page, edit mode of a manager');
      // The form with a field error shown.
      await page.getByLabel(/^Name/).fill('');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('This field is required.')).toBeVisible();
      await clean(page, 'the edit form with an error');
      await managing.close();

      // A member's edit form holds the fixed values and the reason.
      const member = newPerson('axmem');
      await memberOf(w.api, playwright, baseURL, at, member, w.provider);
      const membering = await pageAs(browser, baseURL, at, member);
      await membering.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await membering.page.goto(at(`/services/${service.slug}`));
      await membering.page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(membering.page.getByText('Fixed values')).toBeVisible();
      await clean(membering.page, 'the service page, edit mode of a member');
      await membering.close();

      // The Reviewer: both confirm dialogs, open.
      const reviewing = await pageAs(browser, baseURL, at, w.reviewer);
      const rpage = reviewing.page;
      await rpage.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await rpage.goto(at(`/services/${service.slug}`));
      await rpage.getByRole('button', { name: 'Make public' }).click();
      await expect(
        rpage.getByRole('dialog', { name: `Make ${service.name} public?` }),
      ).toBeVisible();
      await clean(rpage, 'the publish dialog');
      await rpage.getByRole('dialog').getByRole('button', { name: 'Make public' }).click();
      await expect(rpage.getByRole('status').filter({ hasText: 'is now public.' })).toBeVisible();
      await clean(rpage, 'the service page, public, with the status line');
      await rpage.getByRole('button', { name: 'Make private' }).click();
      await expect(
        rpage.getByRole('dialog', { name: `Make ${service.name} private?` }),
      ).toBeVisible();
      await clean(rpage, 'the unpublish dialog');
      await rpage.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

      // The public pages, as an anonymous visitor sees them.
      const visitor = await browser.newContext({
        baseURL,
        reducedMotion: 'reduce',
        colorScheme: scheme,
      });
      const anon = await visitor.newPage();
      await anon.goto(at(`/public/services/${service.slug}`));
      await expect(anon.getByRole('img', { name: `Icon of ${service.name}` })).toBeVisible();
      await clean(anon, 'the public service page');
      await anon.goto(at(`/public/organisations/${w.provider.id}`));
      await expect(anon.getByRole('heading', { name: w.provider.name, level: 1 })).toBeVisible();
      await clean(anon, 'the public organisation page');
      await visitor.close();
      await reviewing.close();
      await w.api.dispose();
    });
  });
}

test.describe('the service page by keyboard', () => {
  test('edit, rename and cancel without a mouse: the focus follows the person', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at, browser);
    const { service } = w;
    const managing = await pageAs(browser, baseURL, at, w.manager);
    const page = managing.page;
    await page.goto(at(`/services/${service.slug}`));

    // Edit opens the form and the focus goes to its heading; Cancel gives it back to the button.
    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    await tabTo(page, edit);
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { name: `Edit ${service.name}` });
    await expect(heading).toBeFocused();
    await tabTo(page, page.getByRole('button', { name: 'Cancel' }));
    await page.keyboard.press('Enter');
    await expect(edit).toBeFocused();

    // Rename with the keyboard alone: the short name and the name, then the save button that appears.
    await page.keyboard.press('Enter');
    await expect(heading).toBeFocused();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    const slug = page.getByLabel(/^Short name/);
    await tabTo(page, slug);
    const next = `${service.slug}-renamed`;
    await typeOver(page, next);
    await tabTo(page, page.getByLabel(/^Name/));
    await typeOver(page, `${service.name} renamed`);
    const save = page.getByRole('button', { name: 'Save changes' });
    await tabTo(page, save);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(at(`/services/${next}`));
    // The line that says what happened has the focus, and the new name is the heading.
    await expect(
      page.getByRole('status').filter({ hasText: 'The old address still works.' }).first(),
    ).toBeVisible();
    await expect(page.locator('#service-status')).toBeFocused();
    await expect(
      page.getByRole('heading', { name: `${service.name} renamed`, level: 1 }),
    ).toBeVisible();
    // The old address still opens the page.
    await page.goto(at(`/services/${service.slug}`));
    await expect(page).toHaveURL(at(`/services/${next}`));
    await managing.close();
    await w.api.dispose();
  });

  test('publish and unpublish without a mouse: Escape and Cancel give the focus back, a confirm moves it to the line that says what happened', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at, browser);
    const { service } = w;
    const reviewing = await pageAs(browser, baseURL, at, w.reviewer);
    const page = reviewing.page;
    await page.goto(at(`/services/${service.slug}`));

    const publish = page.getByRole('button', { name: 'Make public' });
    await tabTo(page, publish);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Make ${service.name} public?` });
    await expect(dialog).toBeVisible();
    // The keyboard is inside the dialog; Escape closes it and returns to the button.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(publish).toBeFocused();

    // Again, and confirm with the keyboard: Tab from Cancel to the confirm button.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole('button', { name: 'Make public' }), 5);
    await page.keyboard.press('Enter');
    await expect(page.locator('#service-status')).toBeFocused();
    await expect(page.locator('#service-status')).toContainText(`${service.name} is now public.`);

    // Unpublish: Cancel returns to the button, the confirm moves the focus to the status line.
    const unpublish = page.getByRole('button', { name: 'Make private' });
    await tabTo(page, unpublish);
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('dialog', { name: `Make ${service.name} private?` });
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Enter'); // the dialog opens on the safe choice: Cancel
    await expect(confirm).toHaveCount(0);
    await expect(unpublish).toBeFocused();
    await page.keyboard.press('Enter');
    await tabTo(page, confirm.getByRole('button', { name: 'Make private' }), 5);
    await page.keyboard.press('Enter');
    await expect(page.locator('#service-status')).toBeFocused();
    await expect(page.locator('#service-status')).toContainText(`${service.name} is now private.`);
    await reviewing.close();
    await w.api.dispose();
  });
});
