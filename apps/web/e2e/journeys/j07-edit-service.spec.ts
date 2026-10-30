import { makePng } from '@scorpion/testing';
import { adminApi, apiAs, newPerson, unique } from '../support/admin.ts';
import { expect, test } from '../support/fixtures.ts';
import { docShot } from '../support/doc-shot.ts';
import {
  alsoMemberOf,
  makeOrg,
  memberOf,
  pageAs,
  toast,
  uniqueAbbreviation,
} from '../support/members.ts';
import {
  IDENTITY_LINE,
  makeCatalogueService,
  makeConsortium,
  serviceEvents,
} from '../support/services.ts';

// J07: edit a service and rename its slug. Moved from services.spec.ts ("journey 3: editing a service") with every assertion.
// The page draws its form from what the API says the caller may change, never from a role: a member has no short name and no
// owner to change (they are shown with the reason), a manager has both.
test.describe('J07: edit a service and rename its slug', () => {
  test('a member edits the description, links, contact point, icon, name, licence, stage and consortia, and cannot change the short name or the owner', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const provider = await makeOrg(api, uniqueAbbreviation('EDA'));
    const first = await makeConsortium(api, uniqueAbbreviation('EDC'));
    const second = await makeConsortium(api, uniqueAbbreviation('EDD'));
    const member = newPerson('edmem');
    await memberOf(api, playwright, baseURL, at, member, provider);
    const tag = unique('ed');
    const slug = `${tag}-svc`;
    const name = `${tag} Edit service`;
    const made = await api.send('POST', '/services', {
      slug,
      name,
      provider: provider.id,
      consortia: [first.id],
      stage: 'DEV',
      license: 'MIT',
      description: 'Before',
      contact: { email: `before-${tag}@example.org`, type: 'support' },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = (made.body as { id: string }).id;

    const opened = await pageAs(browser, baseURL, at, member);
    const page = opened.page;
    await test.step('Open the page of the service', async () => {
      await page.goto(at(`/services/${slug}`));
      // The words: the stage as the vocabulary words it, the licence by name, who runs it as a link.
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.getByText('Private', { exact: true })).toBeVisible();
      await expect(page.getByText('Development', { exact: true })).toBeVisible();
      await expect(page.getByText('MIT License')).toBeVisible();
      await expect(page.getByRole('link', { name: provider.name })).toHaveAttribute(
        'href',
        at(`/organisations/${provider.id}`),
      );
      await expect(page.getByRole('link', { name: `before-${tag}@example.org` })).toBeVisible();
      // A member may edit, and has no button to make it public.
      await expect(page.getByRole('button', { name: 'Make public' })).toHaveCount(0);
    });
    await test.step('Open the edit form', async () => {
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.getByRole('heading', { name: `Edit ${name}`, level: 2 })).toBeVisible();
      await docShot(page, 'j07', 'edit-form');
    });

    await test.step('See that the short name and the owner are fixed, with the reason', async () => {
      // The short name and the owner are shown, read-only, with the reason; they are no controls.
      await expect(page.getByText(IDENTITY_LINE)).toBeVisible();
      await expect(page.getByLabel(/^Short name/)).toHaveCount(0);
      await expect(page.getByLabel(/^Operated by/)).toHaveCount(0);
      const fixed = page.getByRole('region', { name: 'Fixed values' });
      await expect(fixed).toContainText(slug);
      await expect(fixed).toContainText(provider.name);
      // A save is offered only when something changed.
      await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    });

    const renamed = `${name} v2`;
    await test.step('Change the name, and see the save button follow the change', async () => {
      await page.getByLabel(/^Name/).fill(renamed);
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
      await page.getByLabel(/^Name/).fill(name);
      await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
      await page.getByLabel(/^Name/).fill(renamed);
    });
    await test.step('Change the description and the stage', async () => {
      await page.getByLabel('Description', { exact: true }).fill(`After ${tag}`);
      await page.getByLabel(/^Stage/).selectOption({ label: 'Production' });
    });
    await test.step('Choose another licence', async () => {
      await page.getByRole('searchbox', { name: 'Licence' }).fill('Apache-2.0');
      await page.getByRole('button', { name: /^Apache License 2\.0 Apache-2\.0/ }).click();
      await expect(page.getByText('Chosen licence: Apache License 2.0')).toBeVisible();
    });
    await test.step('Add a link and change the contact point', async () => {
      const links = page.getByRole('group', { name: 'Further links' });
      await links.getByRole('button', { name: 'Add' }).click();
      await links.getByRole('textbox').fill(`https://example.org/${tag}`);
      await page.getByLabel(/^Contact address/).fill(`after-${tag}@example.org`);
      await page.getByLabel('Kind of contact').fill('helpdesk');
    });
    await test.step('Swap the consortium', async () => {
      // Consortia: a member may change them: one off, one on.
      await page.getByRole('checkbox', { name: `${first.name} (${first.abbreviation})` }).uncheck();
      await page.getByRole('checkbox', { name: `${second.name} (${second.abbreviation})` }).check();
    });
    await test.step('Upload an icon', async () => {
      // The icon has its own block and is saved on its own.
      await page.getByLabel('Upload an icon').setInputFiles({
        name: 'icon.png',
        mimeType: 'image/png',
        buffer: makePng(32),
      });
      await expect(toast(page).getByText('The icon was saved.')).toBeVisible();
    });
    await test.step('Save the changes', async () => {
      await page.getByRole('button', { name: 'Save changes' }).click();
    });

    await test.step('Read the new record in words', async () => {
      // The page says what happened, with the focus on that line, and shows the new record in words.
      const status = page.getByRole('status').filter({ hasText: 'Your changes were saved.' });
      await expect(status).toBeFocused();
      await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();
      await expect(page.getByText('Production', { exact: true })).toBeVisible();
      await expect(page.getByText('Apache License 2.0')).toBeVisible();
      await expect(page.getByText(`After ${tag}`)).toBeVisible();
      await expect(page.getByRole('link', { name: `https://example.org/${tag}` })).toHaveAttribute(
        'rel',
        'noopener noreferrer',
      );
      await expect(page.getByRole('link', { name: `after-${tag}@example.org` })).toBeVisible();
      await expect(page.getByRole('img', { name: `Icon of ${renamed}` })).toBeVisible();
      await expect(page.getByRole('link', { name: second.name })).toBeVisible();
      await expect(page.getByRole('link', { name: first.name })).toHaveCount(0);
      await docShot(page, 'j07', 'service-after-edit');
    });
    const stored = await api.get<{
      name: string;
      slug: string;
      stage: string;
      license: string;
      sameAs: string[];
      contactEmail: string;
      contactType: string;
      organisations: { role: string; id: string }[];
    }>(`/services/${id}`);
    expect(stored).toMatchObject({
      name: renamed,
      slug,
      stage: 'PROD',
      license: 'Apache-2.0',
      sameAs: [`https://example.org/${tag}`],
      contactEmail: `after-${tag}@example.org`,
      contactType: 'helpdesk',
    });
    expect(stored.organisations.map((o) => [o.role, o.id])).toEqual([
      ['provider', provider.id],
      ['consortium', second.id],
    ]);

    // A direct request for the short name or the owner is 403 and changes nothing (the whole request is refused).
    const asMember = await apiAs(playwright, baseURL, at, member);
    for (const change of [{ slug: `${tag}-sneaky` }, { name: 'Sneaky', slug: `${tag}-sneaky2` }]) {
      const refused = await asMember.send('PATCH', `/services/${id}`, change);
      expect(refused.status, JSON.stringify(refused.body)).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain('sneaky');
    }
    await asMember.dispose();
    expect(await api.get(`/services/${id}`)).toMatchObject({ slug, name: renamed });

    // The audit entry names who changed what: the actor, `by`, and the field names, never a value.
    const updated = await serviceEvents(basePath, 'registry.service.updated@1', id);
    const entry = updated.at(-1)!;
    expect(entry.payload.by).toBe('member');
    expect(entry.userId).not.toBeNull();
    expect(entry.payload.fields as string[]).toEqual(
      expect.arrayContaining(['name', 'description', 'stage', 'license', 'sameAs', 'consortia']),
    );
    expect(JSON.stringify(entry.payload)).not.toContain(`after-${tag}@example.org`);
    expect(JSON.stringify(entry.payload)).not.toContain(`After ${tag}`);
    await opened.close();
    await api.dispose();
  });

  test('a manager renames it (the old address still works, the new short name cannot be taken) and moves it to another organisation they manage', async ({
    browser,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const home = await makeOrg(api, uniqueAbbreviation('MVA'));
    const other = await makeOrg(api, uniqueAbbreviation('MVB'));
    const foreign = await makeOrg(api, uniqueAbbreviation('MVX'));
    const manager = newPerson('mvmgr');
    await memberOf(api, playwright, baseURL, at, manager, home, 'manager');
    await alsoMemberOf(api, playwright, baseURL, at, manager, other, 'manager');
    const tag = unique('mv');
    const oldSlug = `${tag}-old`;
    const newSlug = `${tag}-new`;
    const name = `${tag} Moving service`;
    const service = await makeCatalogueService(api, oldSlug, { name, provider: home.id });
    const taken = await makeCatalogueService(api, `${tag}-taken`, {
      name: `${tag} Taken`,
      provider: home.id,
    });

    const opened = await pageAs(browser, baseURL, at, manager);
    const page = opened.page;
    const slugField = page.getByLabel(/^Short name/);
    await test.step('Open the service by its id and the edit form', async () => {
      await page.goto(at(`/services/${service.id}`));
      // An id resolves, and the address becomes the short name's.
      await expect(page).toHaveURL(at(`/services/${oldSlug}`));
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      // No fixed values and no reason: a manager may change both.
      await expect(page.getByText(IDENTITY_LINE)).toHaveCount(0);
      await expect(slugField).toHaveValue(oldSlug);
    });

    await test.step('Try a short name that is taken and read the error on the field', async () => {
      // A short name that is taken is refused on its field, in words, without the value.
      await slugField.fill(taken.slug);
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(slugField).toHaveAttribute('aria-invalid', 'true');
      const slugError = page.getByText('This short name is already taken');
      await expect(slugError).toBeVisible();
      await expect(slugError).not.toContainText(taken.slug);
      await expect(slugField).toHaveValue(taken.slug);
      // Changing the field takes the message away.
      await slugField.fill(newSlug);
      await expect(slugError).toHaveCount(0);
    });

    await test.step('Move the service to another organisation you manage and save', async () => {
      // The owner: only the organisations this person manages are offered, never the other one.
      const operated = page.getByLabel(/^Operated by/);
      await expect(
        operated.getByRole('option', { name: new RegExp(foreign.abbreviation) }),
      ).toHaveCount(0);
      await expect(
        operated.getByRole('option', { name: new RegExp(home.abbreviation) }),
      ).toHaveCount(1);
      await operated.selectOption(other.id);
      await page.getByRole('button', { name: 'Save changes' }).click();
    });

    await test.step('Land on the new address with a note that the old one still works', async () => {
      // The address is the new one, and the notice says the old one still works.
      await expect(page).toHaveURL(at(`/services/${newSlug}`));
      await expect(
        page.getByRole('status').filter({ hasText: 'The old address still works.' }).first(),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: other.name })).toBeVisible();
      await expect(page.getByRole('link', { name: home.name })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    });

    await test.step('Open the old address and the id and land on the new one', async () => {
      // The old address redirects to the new one; so does the id; and nobody else can take the old short name.
      await page.goto(at(`/services/${oldSlug}`));
      await expect(page).toHaveURL(at(`/services/${newSlug}`));
      await page.goto(at(`/services/${service.id}`));
      await expect(page).toHaveURL(at(`/services/${newSlug}`));
    });
    const reuse = await api.send('POST', '/services', {
      slug: oldSlug,
      name: `${tag} Reuse`,
      provider: home.id,
    });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(409);

    // A direct request to move it to an organisation the manager does not manage is 403, and nothing changes.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const asManager = await apiAs(playwright, baseURL, at, manager);
    const refused = await asManager.send('PATCH', `/services/${service.id}`, {
      provider: foreign.id,
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    await asManager.dispose();
    const stored = await api.get<{ organisations: { role: string; id: string }[] }>(
      `/services/${service.id}`,
    );
    expect(stored.organisations.map((o) => [o.role, o.id])).toEqual([['provider', other.id]]);

    // The audit entries: the rename and the move name the manager's group and the field names.
    const updated = await serviceEvents(basePath, 'registry.service.updated@1', service.id);
    expect(updated.at(-1)!.payload.by).toBe('manager');
    expect(updated.at(-1)!.payload.fields as string[]).toEqual(
      expect.arrayContaining(['slug', 'provider']),
    );
    const renamedEvents = await serviceEvents(
      basePath,
      'registry.service.slugChanged@1',
      service.id,
    );
    expect(renamedEvents).toHaveLength(1);
    await opened.close();
    await api.dispose();
  });
});
