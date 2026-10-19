import type { Locator, Page } from '@playwright/test';
import { makePng } from '@scorpion/testing';
import { violations } from './support/a11y.ts';
import { adminApi, newPerson, unique } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';
import { makeConsortium } from './support/services.ts';
import { fillBasics, openWizard } from './support/wizard.ts';

// M7 sprint 5: no serious or critical axe violation on any step of the create wizard, with its errors, with the
// licence results open, with the JSON console beside it (this stack runs outside production) and on the screen
// after the creation, in both themes; and a path through the whole wizard with the keyboard alone: from the link
// in the catalogue to the created service and back.

test.use({ reducedMotion: 'reduce' });

/** Presses Tab until the element has the focus; fails when the keyboard cannot reach it. */
async function tabTo(page: Page, target: Locator, presses = 150) {
  for (let i = 0; i < presses; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`the keyboard cannot reach ${String(target)}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the create wizard, ${scheme} theme`, () => {
    test('has no serious violation on any step, with its errors, the licence results, the console and the screen after the creation', async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const provider = await makeOrg(api, uniqueAbbreviation('AXW'));
      const consortium = await makeConsortium(api, uniqueAbbreviation('AXC'));
      const member = newPerson('axwiz');
      await memberOf(api, playwright, baseURL, at, member, provider);
      const opened = await pageAs(browser, baseURL, at, member);
      const page = opened.page;
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);
      const tag = unique('ax');

      await openWizard(page, at);
      await clean('step 1, as it starts (with the console)');

      // The errors of a step: required fields, marked, with the summary above.
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByText('Some answers need attention')).toBeVisible();
      await expect(page.getByText('This field is required.')).toHaveCount(2);
      await clean('step 1 with its errors');

      // The licence results open: a list of buttons with badges in words.
      await fillBasics(page, { slug: `${tag}-a`, name: `${tag} Accessible` });
      await page.getByRole('searchbox', { name: 'Licence' }).fill('GPL');
      await expect(page.getByRole('status').filter({ hasText: /licences? found/ })).toBeVisible();
      await expect(page.getByText('deprecated').first()).toBeVisible();
      await clean('step 1 with the licence results and a deprecated one marked');
      await page
        .getByRole('button', { name: /^GNU General Public License v3\.0 only/ })
        .first()
        .click();
      await expect(page.getByText(/^Chosen licence:/)).toBeVisible();
      await clean('step 1 with a licence chosen');
      await page.getByRole('button', { name: 'Next' }).click();

      await expect(page.getByRole('heading', { name: 'Step 2 of 4: Who runs it' })).toBeVisible();
      await clean('step 2');
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByText('This field is required.')).toBeVisible();
      await clean('step 2 with its error');
      await page.getByLabel(/^Operated by/).selectOption(provider.id);
      await page
        .getByRole('checkbox', { name: `${consortium.name} (${consortium.abbreviation})` })
        .check();
      await page.getByRole('button', { name: 'Next' }).click();

      await expect(page.getByRole('heading', { name: 'Step 3 of 4: Contact' })).toBeVisible();
      await clean('step 3');
      await page.getByLabel(/^Contact address/).fill(`help-${tag}@example.org`);
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(
        page.getByText('Give both an address and a kind of contact, or neither.'),
      ).toBeVisible();
      await clean('step 3 with the pair rule broken');
      await page.getByLabel('Kind of contact').fill('support');
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByRole('heading', { name: 'Step 4 of 4: KPIs' })).toBeVisible();
      await clean('step 4, the KPIs, without a set chosen');
      await page.getByRole('button', { name: 'Create service' }).click();

      await expect(page.getByRole('heading', { name: 'Service created' })).toBeVisible();
      await clean('the screen after the creation, without an icon');
      await page.getByLabel('Upload an icon').setInputFiles({
        name: 'icon.png',
        mimeType: 'image/png',
        buffer: makePng(32),
      });
      await expect(page.getByRole('img', { name: `Icon of ${tag} Accessible` })).toBeVisible();
      await clean('the screen after the creation, with the icon');
      await opened.close();
      await api.dispose();
    });
  });
}

test.describe('the create wizard by keyboard', () => {
  test('goes from the link in the catalogue through the three steps to the created service, and back, without a mouse', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('KBW'));
    const member = newPerson('kbwiz');
    await memberOf(api, playwright, baseURL, at, member, provider);
    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;
    const tag = unique('kb');

    await page.goto(at('/services'));
    await tabTo(page, page.getByRole('link', { name: 'New service' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Step 1 of 4: Basics' })).toBeVisible();

    // Step 1: the two required fields, then a licence searched and chosen from the list of results.
    await tabTo(page, page.getByLabel(/^Short name/));
    await page.keyboard.type(`${tag}-kb`);
    await page.keyboard.press('Tab');
    await page.keyboard.type(`${tag} Keyboard service`);
    await tabTo(page, page.getByRole('searchbox', { name: 'Licence' }));
    await page.keyboard.type('MIT');
    const mit = page.getByRole('button', { name: /^MIT License MIT/ });
    await expect(mit).toBeVisible();
    await tabTo(page, mit);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Chosen licence: MIT License')).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Next' }));
    await page.keyboard.press('Enter');

    // Moving on takes the focus to the heading of the new step.
    const step2 = page.getByRole('heading', { name: 'Step 2 of 4: Who runs it' });
    await expect(step2).toBeFocused();
    const operated = page.getByLabel(/^Operated by/);
    await tabTo(page, operated);
    // A closed choice is changed by typing the start of an option's text.
    await page.keyboard.type(provider.name.slice(0, 6));
    await expect(operated).toHaveValue(provider.id);
    await tabTo(page, page.getByRole('button', { name: 'Next' }));
    await page.keyboard.press('Enter');

    // The last step is the KPIs: the same button says what it does, and creating moves the focus to the result.
    const step3 = page.getByRole('heading', { name: 'Step 3 of 4: Contact' });
    await expect(step3).toBeFocused();
    await tabTo(page, page.getByRole('button', { name: 'Next' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Step 4 of 4: KPIs' })).toBeFocused();
    await tabTo(page, page.getByRole('button', { name: 'Create service' }));
    await page.keyboard.press('Enter');
    const done = page.getByRole('heading', { name: 'Service created' });
    await expect(done).toBeFocused();

    // The icon: the file control is reached by Tab (the file chooser itself belongs to the system).
    const file = page.getByLabel('Upload an icon');
    await tabTo(page, file);
    await file.setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: makePng(32) });
    await expect(page.getByRole('img', { name: `Icon of ${tag} Keyboard service` })).toBeVisible();

    // And back to the services by link.
    await tabTo(page, page.getByRole('link', { name: 'Back to the services' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(at('/services'));
    await opened.close();
    await api.dispose();
  });
});
