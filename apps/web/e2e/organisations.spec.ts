import { makePng } from '@scorpion/testing';
import { activeUser, adminApi, apiAs, newPerson, unique } from './support/admin.ts';
import { mailTo, withDb } from './support/db.ts';
import {
  auditPayloads,
  makeOrg,
  memberOf,
  pageAs,
  prefixOf,
  rowOf,
  rowOfTable,
  toast,
  uniqueAbbreviation,
  waitingOnCard,
} from './support/members.ts';
import { jsonLd, watchCsp } from './support/page-checks.ts';
import { uniqueRorId } from './support/ror.ts';
import { admin, expect, saveSettings, signInThroughPage, test } from './support/fixtures.ts';
import { ADMIN } from './support/stack.ts';
import { mailbox } from '@scorpion/testing';

// M6 sprint 4, journey 1: an Admin creates, edits and deletes organisations in the browser, and the detail
// page carries the Schema.org block. Each test makes its own organisations (unique names), so a retry never
// meets what an earlier try left.

test.describe('journey 1: an Admin looks after the organisations', () => {
  test('creates a provider with every field and a logo, a consortium with the field errors shown, edits, replaces the logo, deletes; the page block parses', async ({
    page,
    at,
    basePath,
    baseURL,
  }) => {
    test.slow();
    const csp = await watchCsp(page);
    await signInThroughPage(page, at, admin);
    const ror = uniqueRorId();
    const provider = { abbreviation: unique('PRV').toUpperCase(), name: `Provider ${unique('n')}` };
    const consortium = {
      abbreviation: unique('CON').toUpperCase(),
      name: `Consortium ${unique('n')}`,
    };

    // The administration lists the page; the new form offers every field.
    await page.goto(at('/admin/organisations'));
    await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'New organisation' }).click();
    await expect(page.getByRole('heading', { name: 'New organisation', level: 1 })).toBeVisible();
    await expect(page.getByText('You can add a logo once the organisation exists.')).toBeVisible();

    // The provider: every field, a pasted ROR link that previews as the bare id, one extra link, a contact point.
    await page.getByLabel(/^Type/).selectOption({ label: 'Provider' });
    await page.getByLabel(/^Abbreviation/).fill(provider.abbreviation);
    await page.getByLabel(/^Name/).fill(provider.name);
    await page.getByLabel('Description').fill('A <b>test</b> provider & more');
    await page.getByLabel('Website').fill('https://provider.example.org');
    await page.getByLabel('ROR id').fill(`https://ror.org/${ror}`);
    await expect(page.getByTestId('ror-preview')).toContainText(ror);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Other pages about the organisation, item 1' })
      .fill('https://www.wikidata.org/wiki/Q1');
    await page.getByLabel('Contact address').fill('info@provider.example.org');
    await page.getByLabel('Contact type').fill('customer support');
    await expect(
      page.getByText('Use a shared address, not a person’s', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Create the organisation' }).click();
    await expect(toast(page).getByText(`${provider.name} was created.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: provider.name, level: 1 })).toBeVisible();

    // The logo, then its replacement: the editor shows the stored file, under the base path.
    await page
      .getByLabel('Upload a logo')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: makePng(24) });
    await expect(toast(page).getByText('The logo was saved.')).toBeVisible();
    const logo = page.getByRole('img', { name: `Logo of ${provider.name}` });
    await expect(logo).toBeVisible();
    const first = await logo.getAttribute('src');
    expect(first).toMatch(
      new RegExp(`^${basePath === '/' ? '' : basePath}/api/internal/files/[0-9a-f]{64}$`),
    );
    await page.getByLabel('Upload a logo').setInputFiles({
      name: 'logo2.png',
      mimeType: 'image/png',
      buffer: makePng(40, [200, 30, 30]),
    });
    await expect(logo).not.toHaveAttribute('src', first!);

    // The consortium: a duplicate abbreviation and a bad ROR id are shown on their fields.
    await page.goto(at('/admin/organisations/new'));
    await page.getByLabel(/^Type/).selectOption({ label: 'Consortium' });
    await page.getByLabel(/^Abbreviation/).fill(consortium.abbreviation);
    await page.getByLabel(/^Name/).fill(consortium.name);
    await page.getByRole('button', { name: 'Create the organisation' }).click();
    await expect(page.getByRole('heading', { name: consortium.name, level: 1 })).toBeVisible();
    const consortiumUrl = page.url();

    await page.goto(at('/admin/organisations/new'));
    await page.getByLabel(/^Type/).selectOption({ label: 'Consortium' });
    await page.getByLabel(/^Abbreviation/).fill(consortium.abbreviation);
    await page.getByLabel(/^Name/).fill(`Another ${unique('n')}`);
    await page.getByLabel('ROR id').fill('not-a-ror-id');
    await page.getByRole('button', { name: 'Create the organisation' }).click();
    const problems = page.getByRole('alert').filter({ hasText: 'The changes were not saved' });
    await expect(problems.getByText('The ROR id is not valid')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New organisation', level: 1 })).toBeVisible();
    // Without the bad id the abbreviation is judged: it is taken by the first consortium.
    await page.getByLabel('ROR id').fill('');
    await page.getByRole('button', { name: 'Create the organisation' }).click();
    await expect(problems.getByText('This abbreviation is already taken.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New organisation', level: 1 })).toBeVisible();

    // Edit the consortium, its name included.
    await page.goto(consortiumUrl);
    const renamed = `Renamed ${unique('n')}`;
    await page.getByLabel(/^Name/).fill(renamed);
    await page.getByLabel('Description').fill('Now with a description');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(toast(page).getByText('The organisation was saved.')).toBeVisible();
    await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();

    // The detail page of the provider: the fields, and a Schema.org block that parses, names the organisation
    // and carries the logo under the base path, with no policy violation.
    await page.goto(at('/admin/organisations'));
    await page.getByLabel('Search by abbreviation or name').fill(provider.abbreviation);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('link', { name: provider.abbreviation }).click();
    await page.getByRole('link', { name: 'View the organisation page' }).click();
    await expect(page.getByRole('heading', { name: provider.name, level: 1 })).toBeVisible();
    await expect(page.getByText('A <b>test</b> provider & more')).toBeVisible();
    await expect(page.getByRole('link', { name: ror })).toHaveAttribute(
      'href',
      `https://ror.org/${ror}`,
    );
    await expect(page.getByRole('link', { name: 'info@provider.example.org' })).toBeVisible();
    const profile = await jsonLd(page);
    expect(profile).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: provider.name,
      alternateName: provider.abbreviation,
      url: 'https://provider.example.org',
      contactPoint: { email: 'info@provider.example.org', contactType: 'customer support' },
    });
    expect(profile.sameAs).toEqual([`https://ror.org/${ror}`, 'https://www.wikidata.org/wiki/Q1']);
    const origin = new URL(baseURL!).origin;
    expect(profile.logo?.url).toMatch(
      new RegExp(`^${origin}${basePath === '/' ? '' : basePath}/api/internal/files/[0-9a-f]{64}$`),
    );
    expect(profile['@id']).toBe(
      `${origin}${basePath === '/' ? '' : basePath}/organisations/${page.url().split('/').pop()}`,
    );
    expect(await csp()).toEqual([]);

    // Delete the consortium (unused): the confirm says what goes with it.
    await page.goto(consortiumUrl);
    await page.getByRole('button', { name: 'Delete…' }).click();
    const dialog = page.getByRole('dialog', { name: `Delete ${renamed}?` });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('all its memberships and its logo are removed', { exact: false }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete the organisation' }).click();
    await expect(toast(page).getByText(`${renamed} was deleted.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
    await page.getByLabel('Search by abbreviation or name').fill(consortium.abbreviation);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No organisation matches.')).toBeVisible();
  });

  test('shows hostile organisation text as text: the block stays data, nothing runs, the policy is not violated', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const csp = await watchCsp(page);
    const name = `</script><script>window.pwned=1</script> <!-- & ${unique('h')}`;
    const created = await api.send('POST', '/organisations', {
      type: 'provider',
      abbreviation: unique('HOS').toUpperCase(),
      name,
      description: '<img src=x onerror=window.pwned=2>',
      sameAs: ['https://example.org/?a=1&b=<2>'],
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    await signInThroughPage(page, at, admin);
    await page.goto(at(`/organisations/${id}`));
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('<img src=x onerror=window.pwned=2>')).toBeVisible();
    expect((await jsonLd(page)).name).toBe(name);
    expect(
      await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
    ).toBeUndefined();
    expect(await csp()).toEqual([]);
    // The same text in the server's HTML: no second script element and no unescaped end tag inside the block.
    const html = await (await page.request.get(at(`/organisations/${id}`))).text();
    expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(1);
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(block).not.toMatch(/[<>&]/);
    await api.dispose();
  });
});

// M6 sprint 5, journeys 2 to 7: the member and manager screens. Every journey makes its own organisations and
// accounts (unique names), because the specs of a run share one database and a retry must not meet what its
// first try left. Two people act at once in two browser contexts; a direct call from a second session of the
// same account stands for "the API would answer".

test.describe('journey 3: nobody decides on their own request', () => {
  test('an Admin who asked has no approve button, and a direct decision is refused with 403', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const org = await makeOrg(api, uniqueAbbreviation('OWN'));
    const asked = await api.send('POST', `/organisations/${org.id}/membership`);
    expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(300);
    try {
      const boss = await pageAs(browser, baseURL, at, admin);
      await boss.page.goto(at(`/admin/memberships?organisation=${org.id}`));
      const own = rowOfTable(boss.page, ADMIN.username);
      await expect(own.getByText('Pending')).toBeVisible();
      await expect(own.getByRole('button')).toHaveCount(0);
      await expect(
        own.getByText('This is your own request. Somebody else decides on it.'),
      ).toBeVisible();

      const row = await rowOf(api, org.id, 'requested', ADMIN.username);
      expect(row.allowedActions).toEqual([]);
      for (const decision of ['approved', 'rejected']) {
        const refused = await api.send('POST', `/memberships/${row.id}/decision`, { decision });
        expect(refused.status, decision).toBe(403);
      }
      await boss.close();
    } finally {
      await api.send('DELETE', `/organisations/${org.id}/membership`);
      await api.dispose();
    }
  });
});

test.describe('journey 4: managers decide for their own organisation', () => {
  test('an Admin promotes; the manager gets the mail and the card, approves, cannot demote themselves, removes a plain member and no manager; the last demotion sends the next request to the administrators only', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const org = await makeOrg(api, uniqueAbbreviation('MGR'));
    const other = await makeOrg(api, uniqueAbbreviation('OTH'));
    const alice = newPerson('alice');
    const carol = newPerson('carol');
    const second = newPerson('second');
    const dave = newPerson('dave');
    const aliceId = await memberOf(api, playwright, baseURL, at, alice, org);
    await memberOf(api, playwright, baseURL, at, carol, org);
    await memberOf(api, playwright, baseURL, at, second, org, 'manager');
    await activeUser(api, at, dave);

    // The Admin promotes alice on the administrator's list; the change shows.
    const boss = await pageAs(browser, baseURL, at, admin);
    await boss.page.goto(at(`/admin/memberships?state=approved&organisation=${org.id}`));
    await expect(rowOfTable(boss.page, alice.username)).toBeVisible();
    await rowOfTable(boss.page, alice.username)
      .getByRole('button', { name: `Make manager: ${alice.username}` })
      .click();
    await expect(boss.page.getByText(`${alice.username} is now a manager.`).first()).toBeVisible();
    await boss.close();

    // dave asks; alice (now a manager) gets the mail and the card.
    const daveApi = await apiAs(playwright, baseURL, at, dave);
    expect((await daveApi.send('POST', `/organisations/${org.id}/membership`)).status).toBeLessThan(
      300,
    );
    await daveApi.dispose();
    const mail = await mailTo(
      basePath,
      `${alice.username}@example.org`,
      'registry.membership-requested',
    );
    expect(mail.text).toContain(dave.username);

    const manager = await pageAs(browser, baseURL, at, alice);
    const page = manager.page;
    await page.goto(at('/'));
    await expect.poll(() => waitingOnCard(page)).toBeGreaterThan(0);
    await page.getByRole('region', { name: 'Membership requests' }).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`${prefixOf(basePath)}/account/organisations$`));

    // Only their own organisation is in the manager section.
    const mine = page.getByRole('region', { name: 'My organisations' });
    await expect(mine.getByRole('heading', { name: org.name, level: 3 })).toBeVisible();
    await expect(mine).not.toContainText(other.abbreviation);
    const aliceApi = await apiAs(playwright, baseURL, at, alice);
    expect(
      (
        await aliceApi.request.get(at(`/api/internal/memberships?organisationId=${other.id}`))
      ).status(),
    ).toBe(403);

    // Approve from the page.
    const section = mine.getByRole('region', { name: org.name });
    await rowOfTable(section, dave.username)
      .getByRole('button', { name: `Approve the request of ${dave.username}` })
      .click();
    await expect(section.getByText(`${dave.username} was approved.`).first()).toBeVisible();
    await expect(
      rowOfTable(section, dave.username).getByText('Member', { exact: true }),
    ).toBeVisible();

    // No button on their own row, and a direct change of their own role is refused.
    const ownRow = rowOfTable(section, alice.username);
    await expect(ownRow.getByRole('button')).toHaveCount(0);
    await expect(
      ownRow.getByText('You cannot change your own role', { exact: false }),
    ).toBeVisible();
    const aliceRow = await rowOf(api, org.id, 'approved', alice.username);
    expect(
      (await aliceApi.send('POST', `/memberships/${aliceRow.id}/role`, { role: 'member' })).status,
    ).toBe(403);

    // Remove a plain member: the count drops and the audit entry names the manager.
    const countBefore = (await api.get<{ memberCount: number }>(`/organisations/${org.id}`))
      .memberCount;
    const carolRow = await rowOf(api, org.id, 'approved', carol.username);
    await rowOfTable(section, carol.username)
      .getByRole('button', { name: `Remove ${carol.username} from the organisation` })
      .click();
    const dialog = page.getByRole('dialog', { name: `Remove ${carol.username}?` });
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(section.getByText(`${carol.username} was removed.`).first()).toBeVisible();
    await expect(rowOfTable(section, carol.username)).toHaveCount(0);
    expect((await api.get<{ memberCount: number }>(`/organisations/${org.id}`)).memberCount).toBe(
      countBefore - 1,
    );
    const left = await auditPayloads(
      basePath,
      'registry.membership.left@1',
      'membershipId',
      carolRow.id,
    );
    expect(left).toHaveLength(1);
    expect(left[0]!.payload).toMatchObject({ by: 'manager' });
    expect(left[0]!.userId).toBe(aliceId);

    // No remove button on another manager or on themselves, and a direct removal of a manager is refused.
    const secondRow = rowOfTable(section, second.username);
    await expect(
      secondRow.getByRole('button', { name: `Remove ${second.username} from the organisation` }),
    ).toHaveCount(0);
    await expect(secondRow.getByText('Only an administrator can remove a manager.')).toBeVisible();
    await expect(ownRow.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    const managerRow = await rowOf(api, org.id, 'approved', second.username);
    expect((await aliceApi.send('POST', `/memberships/${managerRow.id}/remove`)).status).toBe(403);
    await aliceApi.dispose();
    await manager.close();

    // The Admin demotes both managers: the next request reaches the administrators only.
    for (const row of [aliceRow, managerRow]) {
      expect(
        (await api.send('POST', `/memberships/${row.id}/role`, { role: 'member' })).status,
      ).toBe(200);
    }
    const erin = newPerson('erin');
    await activeUser(api, at, erin);
    const erinApi = await apiAs(playwright, baseURL, at, erin);
    expect((await erinApi.send('POST', `/organisations/${org.id}/membership`)).status).toBeLessThan(
      300,
    );
    await erinApi.dispose();
    await mailTo(basePath, ADMIN.email, 'registry.membership-requested'); // the administrators are told
    // Other journeys of the run made other administrators; the point is that no manager is mailed.
    await expect
      .poll(async () => {
        const mails = await withDb(basePath, (client) => mailbox(client).all());
        return mails
          .filter(
            (m) => m.template === 'registry.membership-requested' && m.text.includes(erin.username),
          )
          .map((m) => m.to);
      })
      .toContain(ADMIN.email);
    const mailed = (await withDb(basePath, (client) => mailbox(client).all()))
      .filter(
        (m) => m.template === 'registry.membership-requested' && m.text.includes(erin.username),
      )
      .map((m) => m.to);
    expect(mailed).not.toContain(`${alice.username}@example.org`);
    expect(mailed).not.toContain(`${second.username}@example.org`);
    await api.dispose();
  });
});

test.describe('journey 5: a plain User sees nothing of the administration or the manager section', () => {
  test('no entries, a 403 page on both admin URLs and on the API, no administration in the navigation answer', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('plain');
    await activeUser(api, at, who);
    await api.dispose();

    const person = await pageAs(browser, baseURL, at, who);
    const page = person.page;
    await page.goto(at('/account/organisations'));
    await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My organisations' })).toHaveCount(0);
    await expect(page.locator('a[href*="/admin"]')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByText('Administration')).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Membership requests' })).toHaveCount(0);
    // The one entry a person has is the one under their account.
    await expect(nav.getByRole('link', { name: 'Organisations' })).toBeVisible();

    for (const path of ['/admin/organisations', '/admin/memberships']) {
      const response = await page.goto(at(path));
      expect(response?.status(), path).toBe(403);
      await expect(page.getByText('You are not allowed to open this page.'), path).toBeVisible();
    }
    // And the dashboard draws no card and no error.
    await page.goto(at('/'));
    await expect(page.getByRole('region', { name: 'Membership requests' })).toHaveCount(0);

    // The API: the lists and every write of the administration answer 403 or an empty summary.
    const mine = await apiAs(playwright, baseURL, at, who);
    expect((await mine.request.get(at('/api/internal/memberships'))).status()).toBe(403);
    const summary = await mine.request.get(at('/api/internal/memberships/summary'));
    expect(await summary.json()).toEqual({ pending: 0, manages: false });
    expect(
      (
        await mine.send('POST', '/organisations', {
          type: 'provider',
          abbreviation: 'NOPE',
          name: 'Nope',
        })
      ).status,
    ).toBe(403);
    const navigation = (await (
      await mine.request.get(at('/api/internal/ui/navigation'))
    ).json()) as {
      nav: { path: string }[];
      routes: { path: string }[];
    };
    expect(navigation.nav.filter((entry) => entry.path.startsWith('/admin'))).toEqual([]);
    await mine.dispose();
    await person.close();
  });
});

test.describe('journey 6: the cap on open requests', () => {
  test('a reject, and a request again after it, show the limit of one set on the settings form', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const first = await makeOrg(api, uniqueAbbreviation('CAP'));
    const second = await makeOrg(api, uniqueAbbreviation('CAQ'));
    const who = newPerson('capped');
    await activeUser(api, at, who);
    const original = (
      await api.get<{ values: { membership?: { maxPendingPerUser?: number } } }>(
        '/settings/registry.organisations',
      )
    ).values.membership?.maxPendingPerUser;
    try {
      const boss = await pageAs(browser, baseURL, at, admin);
      await boss.page.goto(at('/admin/settings/registry.organisations'));
      await boss.page.getByLabel('Open membership requests per person').fill('1');
      await boss.page.getByRole('button', { name: 'Save' }).click();
      await expect(toast(boss.page).getByText('saved', { exact: false })).toBeVisible();

      const person = await pageAs(browser, baseURL, at, who);
      const page = person.page;
      const ask = (org: { abbreviation: string }) =>
        page.getByRole('button', { name: `Ask to become a member of ${org.abbreviation}` });
      const find = async (org: { abbreviation: string }) => {
        await page.goto(at(`/account/organisations?q=${org.abbreviation}`));
        await expect(page.getByRole('rowheader', { name: org.abbreviation })).toBeVisible();
      };
      await find(first);
      await ask(first).click();
      await expect(
        rowOfTable(page, first.abbreviation).getByText('Pending', { exact: true }),
      ).toBeVisible();
      // The second request is over the limit: said in words, nothing changes.
      await find(second);
      await ask(second).click();
      await expect(
        page.getByText('You already have the most open requests allowed.', { exact: false }),
      ).toBeVisible();
      await expect(rowOfTable(page, second.abbreviation).getByText('Pending')).toHaveCount(0);

      // The Admin rejects the first; the person asks again and is pending again.
      const row = await rowOf(api, first.id, 'requested', who.username);
      expect(
        (await api.send('POST', `/memberships/${row.id}/decision`, { decision: 'rejected' }))
          .status,
      ).toBe(200);
      await find(first);
      await expect(rowOfTable(page, first.abbreviation).getByText('Pending')).toHaveCount(0);
      await ask(first).click();
      await expect(
        rowOfTable(page, first.abbreviation).getByText('Pending', { exact: true }),
      ).toBeVisible();
      await person.close();
      await boss.close();
    } finally {
      await saveSettings(api.request, at, api.csrf, 'registry.organisations', (values) => ({
        ...values,
        membership: { ...(values.membership as object), maxPendingPerUser: original ?? 10 },
      }));
      await api.dispose();
    }
  });
});

test.describe('journey 7: a manager edits their organisation', () => {
  test('changes the description, ROR id, contact point and logo; the identity fields are read only; direct writes of the rest are refused', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const org = await makeOrg(api, uniqueAbbreviation('EDT'));
    const other = await makeOrg(api, uniqueAbbreviation('EDO'));
    const who = newPerson('editor');
    const whoId = await memberOf(api, playwright, baseURL, at, who, org, 'manager');
    const ror = uniqueRorId();

    const manager = await pageAs(browser, baseURL, at, who);
    const page = manager.page;
    await page.goto(at('/account/organisations'));
    const section = page
      .getByRole('region', { name: 'My organisations' })
      .getByRole('region', { name: org.name });
    await expect(
      section.getByText('Only an administrator can change these; ask one.'),
    ).toBeVisible();
    // Type, abbreviation and name are text, not fields.
    await expect(section.getByLabel(/^Name/)).toHaveCount(0);
    await expect(section.getByLabel(/^Abbreviation/)).toHaveCount(0);
    await expect(section.getByLabel(/^Type/)).toHaveCount(0);
    await expect(section.getByRole('term').filter({ hasText: 'Name' })).toBeVisible();

    await section.getByLabel('Description').fill('Looked after by its managers');
    await section.getByLabel('ROR id').fill(`https://ror.org/${ror}`);
    await section.getByLabel('Contact address').fill('team@editor.example.org');
    await section.getByLabel('Contact type').fill('support');
    await section.getByRole('button', { name: 'Save changes' }).click();
    await expect(toast(page).getByText('The organisation was saved.')).toBeVisible();
    await section.getByLabel('Upload a logo').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: makePng(32),
    });
    await expect(section.getByRole('img', { name: `Logo of ${org.name}` })).toBeVisible();

    // The detail page and its JSON-LD show it.
    await page.goto(at(`/organisations/${org.id}`));
    await expect(page.getByText('Looked after by its managers')).toBeVisible();
    await expect(page.getByRole('link', { name: ror })).toBeVisible();
    const profile = await jsonLd(page);
    expect(profile).toMatchObject({
      name: org.name,
      contactPoint: { email: 'team@editor.example.org', contactType: 'support' },
    });
    expect(profile.sameAs).toContain(`https://ror.org/${ror}`);
    expect(profile.logo?.url).toContain(`${prefixOf(basePath)}/api/internal/files/`);

    // Direct calls from the manager's account: the identity fields, another organisation, create and delete.
    const mine = await apiAs(playwright, baseURL, at, who);
    expect(
      (await mine.send('PATCH', `/organisations/${org.id}`, { name: 'Hijacked' })).status,
    ).toBe(403);
    expect(
      (await mine.send('PATCH', `/organisations/${other.id}`, { description: 'Not mine' })).status,
    ).toBe(403);
    expect(
      (
        await mine.send('POST', '/organisations', {
          type: 'provider',
          abbreviation: unique('NEW').toUpperCase(),
          name: 'New',
        })
      ).status,
    ).toBe(403);
    expect((await mine.send('DELETE', `/organisations/${org.id}`)).status).toBe(403);
    await mine.dispose();
    const after = await api.get<{ name: string; description: string }>(`/organisations/${org.id}`);
    expect(after.name).toBe(org.name);
    expect(after.description).toBe('Looked after by its managers');
    expect(
      (await api.get<{ description: string | null }>(`/organisations/${other.id}`)).description,
    ).toBeNull();

    // The audit entry names the manager and the fields, and none of the values.
    const entries = await auditPayloads(
      basePath,
      'registry.organisation.updated@1',
      'organisationId',
      org.id,
    );
    const edit = entries.find((entry) =>
      (entry.payload.fields as string[]).includes('description'),
    );
    expect(edit, 'the edit of the description').toBeDefined();
    expect(edit!.userId).toBe(whoId);
    expect(edit!.payload).toMatchObject({ by: 'manager', actorId: whoId });
    expect(edit!.payload.fields).toEqual(expect.arrayContaining(['description', 'rorId']));
    expect(JSON.stringify(edit!.payload)).not.toContain('managers');
    expect(JSON.stringify(edit!.payload)).not.toContain('team@editor');
    await manager.close();
    await api.dispose();
  });
});
