import { makePng } from '@scorpion/testing';
import { violations } from './support/a11y.ts';
import { adminApi, unique } from './support/admin.ts';
import { uniqueRorId } from './support/ror.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

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
