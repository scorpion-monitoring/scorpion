import { makePng } from '@scorpion/testing';
import { violations } from './support/a11y.ts';
import { activeUser, adminApi, apiAs, newPerson, unique } from './support/admin.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';
import { uniqueRorId } from './support/ror.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';
import type { Locator, Page } from '@playwright/test';

// M6 sprint 4: no serious or critical axe violation on the screens of the organisations (the list, the new
// form with its field errors, the editor with a logo and the delete dialog, the organisation page), in both
// themes. The logo has an `alt` text from the organisation's name, which axe checks too.

test.use({ reducedMotion: 'reduce' });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the screens of the organisations, ${scheme} theme`, () => {
    test('have no serious violation', async ({ page, playwright, baseURL, at }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const abbreviation = unique(`AX${scheme.slice(0, 1)}`).toUpperCase();
      const created = await api.send('POST', '/organisations', {
        type: 'provider',
        abbreviation,
        name: `Accessible ${unique('n')}`,
        description: 'A plain text description.\nWith a second line.',
        website: 'https://accessible.example.org',
        rorId: uniqueRorId(), // a ROR id names one organisation
        sameAs: ['https://www.wikidata.org/wiki/Q1'],
        contactEmail: 'info@accessible.example.org',
        contactType: 'support',
      });
      expect(created.status).toBe(201);
      const { id, name } = created.body as { id: string; name: string };
      // A logo, so that the image and its alt text are on the screens.
      const logo = await api.request.put(at(`/api/internal/organisations/${id}/logo`), {
        headers: { 'x-csrf-token': api.csrf, 'content-type': 'application/octet-stream' },
        data: makePng(32),
      });
      expect(logo.status()).toBe(200);

      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await signInThroughPage(page, at, admin);
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);

      await page.goto(at('/admin/organisations'));
      await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
      await expect(page.getByRole('rowheader', { name: abbreviation })).toBeVisible();
      await clean('the list');
      await page.getByLabel('Search by abbreviation or name').fill('no-such-organisation-xyz');
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByText('No organisation matches.')).toBeVisible();
      await clean('the empty list');

      await page.goto(at('/admin/organisations/new'));
      await expect(page.getByRole('heading', { name: 'New organisation', level: 1 })).toBeVisible();
      await clean('the new form');
      await page.getByLabel('ROR id').fill(`https://ror.org/${uniqueRorId()}`);
      await expect(page.getByTestId('ror-preview')).toBeVisible();
      await page.getByRole('button', { name: 'Create the organisation' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'The changes were not saved' }),
      ).toBeVisible();
      await clean('the new form with its errors');

      await page.goto(at(`/admin/organisations/${id}`));
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.getByRole('img', { name: `Logo of ${name}` })).toBeVisible();
      await clean('the editor');
      await page.getByRole('button', { name: 'Delete…' }).click();
      await expect(page.getByRole('dialog', { name: `Delete ${name}?` })).toBeVisible();
      await clean('the delete dialog');
      await page.getByRole('button', { name: 'Cancel' }).click();

      await page.goto(at(`/organisations/${id}`));
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.getByRole('img', { name: `Logo of ${name}` })).toBeVisible();
      await clean('the organisation page');
      await api.dispose();
    });
  });
}

// M6 sprint 5: the member and manager screens. No serious or critical axe violation on the profile page (as a
// plain User and as a manager, with the dialogs open), on the administrator's list of requests and on the
// dashboard with its card, in both themes; the badges are words; the card's heading fits its slot. A second
// test goes through request, approve, promote, remove, edit and leave with the keyboard only, and checks where
// the focus is after each dialog and each action.

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
  test.describe(`the screens of the membership, ${scheme} theme`, () => {
    test('have no serious violation', async ({ browser, playwright, baseURL, at }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const org = await makeOrg(api, uniqueAbbreviation(`MX${scheme.slice(0, 1)}`), true);
      const manager = newPerson('axmgr');
      const member = newPerson('axmem');
      const asker = newPerson('axask');
      await memberOf(api, playwright, baseURL, at, manager, org, 'manager');
      await memberOf(api, playwright, baseURL, at, member, org);
      await activeUser(api, at, asker);
      const askerApi = await apiAs(playwright, baseURL, at, asker);
      expect(
        (await askerApi.send('POST', `/organisations/${org.id}/membership`)).status,
      ).toBeLessThan(300);
      await askerApi.dispose();

      const clean = async (page: Page, what: string) =>
        expect(await violations(page), what).toEqual([]);
      const as = async (who: typeof manager) => {
        const opened = await pageAs(browser, baseURL, at, who);
        await opened.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        return opened;
      };

      // A plain User: their rows with badges in words, the search, no manager section.
      const plain = await as(member);
      await plain.page.goto(at(`/account/organisations?q=${org.abbreviation}`));
      await expect(plain.page.getByRole('rowheader', { name: org.abbreviation })).toBeVisible();
      await expect(plain.page.getByText('Member', { exact: true }).first()).toBeVisible();
      await clean(plain.page, 'the profile page of a plain User');
      await plain.page.getByRole('button', { name: `Leave ${org.abbreviation}` }).click();
      await expect(plain.page.getByRole('dialog')).toBeVisible();
      await clean(plain.page, 'the leave dialog');
      await plain.close();

      // A manager: requests, members, the edit form with its logo block, and both dialogs.
      const mgr = await as(manager);
      const page = mgr.page;
      await page.goto(at('/account/organisations'));
      const section = page
        .getByRole('region', { name: 'My organisations' })
        .getByRole('region', { name: org.name });
      await expect(section.getByRole('button', { name: /^Approve the request of/ })).toBeVisible();
      await expect(section.getByText('Pending', { exact: true })).toHaveCount(0); // requests are rows, not badges
      await clean(page, 'the manager section');
      await section.getByRole('button', { name: /^Reject the request of/ }).click();
      await expect(page.getByRole('dialog', { name: /^Reject the request of/ })).toBeVisible();
      await clean(page, 'the reject dialog');
      await page.getByRole('button', { name: 'Cancel' }).click();
      await section.getByRole('button', { name: new RegExp(`^Remove ${member.username}`) }).click();
      await expect(page.getByRole('dialog', { name: `Remove ${member.username}?` })).toBeVisible();
      await clean(page, 'the remove dialog');
      await page.getByRole('button', { name: 'Cancel' }).click();
      // The card on the dashboard has its own heading in the slot's level, and its link.
      await page.goto(at('/'));
      const card = page.getByRole('region', { name: 'Membership requests' });
      await expect(card.getByRole('heading', { level: 2 })).toBeVisible();
      await clean(page, 'the dashboard with the card');
      await mgr.close();

      // An Admin: the list of requests, and the list of members of the organisation.
      const boss = await as(admin);
      await boss.page.goto(at(`/admin/memberships?organisation=${org.id}`));
      await expect(boss.page.getByRole('row').filter({ hasText: asker.username })).toBeVisible();
      await clean(boss.page, 'the list of requests');
      await boss.page.goto(at(`/admin/memberships?state=approved&organisation=${org.id}`));
      await expect(boss.page.getByRole('row').filter({ hasText: member.username })).toBeVisible();
      await clean(boss.page, 'the list of members');
      await boss.close();
      await api.dispose();
    });
  });
}

test.describe('the membership screens by keyboard', () => {
  test('request, approve, promote, remove, edit and leave work without a mouse, and the focus lands somewhere sensible', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const org = await makeOrg(api, uniqueAbbreviation('KEY'));
    const manager = newPerson('kbmgr');
    const plain = newPerson('kbmem');
    const dave = newPerson('kbdave');
    await memberOf(api, playwright, baseURL, at, manager, org, 'manager');
    await memberOf(api, playwright, baseURL, at, plain, org);
    await activeUser(api, at, dave);

    // dave asks with the keyboard (the search finds the organisation, the button is reached by Tab).
    const asker = await pageAs(browser, baseURL, at, dave);
    await asker.page.goto(at(`/account/organisations?q=${org.abbreviation}`));
    const ask = asker.page.getByRole('button', {
      name: `Ask to become a member of ${org.abbreviation}`,
    });
    await tabTo(asker.page, ask);
    await asker.page.keyboard.press('Enter');
    await expect(
      asker.page
        .getByRole('row')
        .filter({ hasText: org.abbreviation })
        .getByText('Pending', { exact: true }),
    ).toBeVisible();

    // The manager: approve (focus goes to the line that says what happened), promote, remove through the dialog.
    const mgr = await pageAs(browser, baseURL, at, manager);
    const page = mgr.page;
    await page.goto(at('/account/organisations'));
    const section = page
      .getByRole('region', { name: 'My organisations' })
      .getByRole('region', { name: org.name });
    const approve = section.getByRole('button', {
      name: `Approve the request of ${dave.username}`,
    });
    await tabTo(page, approve);
    await page.keyboard.press('Enter');
    const said = section.getByText(`${dave.username} was approved.`).first();
    await expect(said).toBeVisible();
    await expect(said).toBeFocused();

    const promote = section.getByRole('button', { name: `Make ${plain.username} a manager` });
    await tabTo(page, promote);
    await page.keyboard.press('Enter');
    await expect(section.getByText(`${plain.username} is now a manager.`).first()).toBeFocused();
    // The manager they just made is another manager now: no remove button, and the reason in words.
    await expect(
      section.getByRole('button', { name: `Remove ${plain.username} from the organisation` }),
    ).toHaveCount(0);

    const remove = section.getByRole('button', {
      name: `Remove ${dave.username} from the organisation`,
    });
    await tabTo(page, remove);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Remove ${dave.username}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(':focus')).toHaveCount(1); // the focus is in the dialog
    await page.keyboard.press('Escape'); // Escape cancels and gives the focus back to the button
    await expect(dialog).toBeHidden();
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole('button', { name: 'Remove', exact: true }));
    await page.keyboard.press('Enter');
    await expect(section.getByText(`${dave.username} was removed.`).first()).toBeFocused();

    // The edit form, by keyboard.
    const description = section.getByLabel('Description');
    await tabTo(page, description);
    await page.keyboard.type('Typed without a mouse');
    await tabTo(page, section.getByRole('button', { name: 'Save changes' }));
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByText('The organisation was saved.'),
    ).toBeVisible();
    await mgr.close();

    await asker.close();

    // The member who became a manager leaves with the keyboard; Escape on the dialog returns the focus.
    const leaver = await pageAs(browser, baseURL, at, plain);
    await leaver.page.goto(at('/account/organisations'));
    const leave = leaver.page.getByRole('button', { name: `Leave ${org.abbreviation}` });
    await tabTo(leaver.page, leave);
    await leaver.page.keyboard.press('Enter');
    const confirm = leaver.page.getByRole('dialog', { name: `Leave ${org.name}?` });
    await expect(confirm).toBeVisible();
    await leaver.page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(leave).toBeFocused();
    await leaver.page.keyboard.press('Enter');
    await tabTo(leaver.page, confirm.getByRole('button', { name: 'Leave the organisation' }));
    await leaver.page.keyboard.press('Enter');
    await expect(
      leaver.page
        .getByRole('region', { name: 'Notifications' })
        .getByText('You left the organisation.'),
    ).toBeVisible();
    await leaver.close();
    await api.dispose();
  });
});
