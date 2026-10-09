import type { Page } from '@playwright/test';
import { makePng } from '@scorpion/testing';
import { adminApi, unique } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

// M6 sprint 4, journey 1: an Admin creates, edits and deletes organisations in the browser, and the detail
// page carries the Schema.org block. Each test makes its own organisations (unique names), so a retry never
// meets what an earlier try left.

const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });

/** The profile in the `<script type="application/ld+json">` block of the head, parsed. */
async function jsonLd(page: Page) {
  const block = page.locator('head script[type="application/ld+json"]');
  await expect(block).toHaveCount(1);
  return JSON.parse((await block.textContent())!) as Record<string, unknown> & {
    name: string;
    logo?: { url: string };
    contactPoint?: { email: string; contactType: string };
    sameAs?: string[];
  };
}

/** Collects the violations of the page's Content-Security-Policy, reported by the browser. */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective}: ${event.blockedURI}`,
      ),
    );
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

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
    await page.getByLabel('ROR id').fill('https://ror.org/02skbsp27');
    await expect(page.getByTestId('ror-preview')).toContainText('02skbsp27');
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
    await expect(page.getByRole('link', { name: '02skbsp27' })).toHaveAttribute(
      'href',
      'https://ror.org/02skbsp27',
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
    expect(profile.sameAs).toEqual([
      'https://ror.org/02skbsp27',
      'https://www.wikidata.org/wiki/Q1',
    ]);
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
