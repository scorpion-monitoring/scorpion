import type { Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { adminApi, unique } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

// M9 sprint 2: an Admin looks after the indicators and the KPI sets in the browser. The journey creates an
// indicator with a unit and bounds and a qualitative one, builds a KPI set with them (the paginated picker, a
// necessity per row), sets the evaluation, sees that an indicator in use cannot be deleted, and cleans up. Every
// test makes its own data under a name of its own (specs of a run share one database, a retry must not meet what
// its first try left). Under both base paths, in both themes for axe.

const toast = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test.describe('journey: create an indicator, build a set, set the evaluation', () => {
  test('works from the empty form to the saved evaluation, and refuses to delete what a set uses', async ({
    page,
    at,
  }) => {
    test.slow();
    await signInThroughPage(page, at, admin);
    const tag = unique('kpi');
    const views = `Views ${tag}`;
    const comment = `Comment ${tag}`;
    const setName = `Set ${tag}`;

    // The list, then the new form: a unit-bearing indicator with bounds.
    await page.goto(at('/kpi/indicators'));
    await expect(page.getByRole('heading', { name: 'Indicators', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'New indicator' }).click();
    await expect(page.getByRole('heading', { name: 'New indicator', level: 1 })).toBeVisible();
    await page.getByLabel(/^Name/).fill(views);
    await page.getByLabel('Description').fill('How often a page was opened');
    await page.getByLabel('Example').fill('120');
    await page.getByLabel(/^Thematic category/).selectOption({ label: 'Usage' });
    await page.getByLabel(/^Value type/).selectOption({ label: 'Whole number' });
    await page.getByLabel('Unit').selectOption({ label: 'Count' });
    await page.getByLabel('Smallest value').fill('0');
    await page.getByLabel('Largest value').fill('abc');
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(page.getByText('Enter a number, for example 0 or 12.5.')).toBeVisible();
    await page.getByLabel('Largest value').fill('1000');
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(toast(page).getByText(`${views} was created.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: views, level: 1 })).toBeVisible();
    await expect(page.getByText('Used in 0 KPI sets.')).toBeVisible();

    // A qualitative indicator: the type is fixed to text and the bounds are gone.
    await page.goto(at('/kpi/indicators/new'));
    await page.getByLabel(/^Name/).fill(comment);
    await page.getByLabel(/^Thematic category/).selectOption({ label: 'Satisfaction' });
    await page.getByLabel('Qualitative indicator').check();
    await expect(page.getByLabel(/^Value type/)).toBeDisabled();
    await expect(page.getByLabel('Smallest value')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(toast(page).getByText(`${comment} was created.`)).toBeVisible();

    // A duplicate name is shown on its field.
    await page.goto(at('/kpi/indicators/new'));
    await page.getByLabel(/^Name/).fill(views.toUpperCase());
    await page.getByLabel(/^Thematic category/).selectOption({ label: 'Usage' });
    await page.getByLabel(/^Value type/).selectOption({ label: 'Whole number' });
    await page.getByRole('button', { name: 'Create the indicator' }).click();
    await expect(page.getByText('This name is already taken.').first()).toBeVisible();

    // The list finds both by their tag, and a filter narrows it.
    await page.goto(at(`/kpi/indicators?q=${tag}`));
    await expect(page.getByRole('rowheader', { name: views })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: comment })).toBeVisible();
    await page.getByLabel('Kind').selectOption({ label: 'Qualitative' });
    await expect(page.getByRole('rowheader', { name: comment })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: views })).toHaveCount(0);

    // The set: create it with a RIMO category, then add both indicators through the picker.
    await page.goto(at('/kpi/sets'));
    await page.getByRole('link', { name: 'New KPI set' }).click();
    await page.getByLabel(/^Name/).fill(setName);
    await page.getByLabel('RIMO category').selectOption({ label: 'Web application' });
    await page.getByRole('button', { name: 'Create the KPI set' }).click();
    await expect(toast(page).getByText(`${setName} was created.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: setName, level: 1 })).toBeVisible();
    await expect(page.getByText('The set has no indicators.')).toBeVisible();

    await page.getByLabel('Search indicators').fill(tag);
    await page.getByRole('button', { name: 'Search', exact: true }).last().click();
    await page.getByRole('button', { name: `Add ${views}` }).click();
    await page.getByRole('button', { name: `Add ${comment}` }).click();
    await expect(page.getByText('There are unsaved changes.').first()).toBeVisible();
    await page.getByLabel(`Necessity of ${views}`).selectOption({ label: 'Mandatory' });
    await page.getByLabel(`Necessity of ${comment}`).selectOption({ label: 'Recommended' });
    await page.getByRole('button', { name: 'Save the indicators' }).click();
    await expect(toast(page).getByText('The indicators were saved.')).toBeVisible();

    // The evaluation: the headline is a saved row; a text indicator has no aggregate.
    await page.getByLabel('Headline indicator').selectOption({ label: comment });
    await expect(page.getByLabel('Aggregate')).toBeDisabled();
    await expect(page.getByText('This value type has no aggregate.')).toBeVisible();
    await page.getByLabel('Headline indicator').selectOption({ label: views });
    await page.getByLabel('Aggregate').selectOption({ label: 'Sum' });
    await page.getByRole('button', { name: 'Save the evaluation' }).click();
    await expect(toast(page).getByText('The evaluation was saved.')).toBeVisible();

    // After a reload everything is as saved, and the list shows the badges.
    await page.reload();
    await expect(page.getByLabel(`Necessity of ${views}`)).toHaveValue('mandatory');
    await expect(page.getByLabel(`Necessity of ${comment}`)).toHaveValue('recommended');
    await expect(page.getByLabel('Headline indicator')).toHaveValue(/.+/);
    await expect(page.getByLabel('Aggregate')).toHaveValue('sum');
    await page.goto(at(`/kpi/sets?q=${tag}`));
    await expect(page.getByRole('rowheader', { name: setName })).toBeVisible();
    await expect(page.getByText('1 Mandatory')).toBeVisible();
    await expect(page.getByText('1 Recommended')).toBeVisible();

    // An indicator a set uses cannot be deleted; the page says where it is used.
    await page.goto(at(`/kpi/indicators?q=${tag}`));
    await page.getByRole('link', { name: views }).click();
    await expect(page.getByText('Used in 1 KPI set.')).toBeVisible();
    await page.getByRole('button', { name: 'Delete…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(/while it is in use: 1 KPI set, 1 evaluation/)).toBeVisible();

    // Removing the headline from the set clears the evaluation; then the set and the indicators can go.
    await page.goto(at(`/kpi/sets?q=${tag}`));
    await page.getByRole('link', { name: setName }).click();
    await page.getByRole('button', { name: `Remove ${views}` }).click();
    await expect(
      page.getByText('Removing the headline indicator also clears the evaluation.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save the indicators' }).click();
    await expect(toast(page).getByText('The indicators were saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Delete…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(toast(page).getByText(`${setName} was deleted.`)).toBeVisible();
    for (const name of [views, comment]) {
      await page.goto(at(`/kpi/indicators?q=${tag}`));
      await page.getByRole('link', { name }).click();
      await page.getByRole('button', { name: 'Delete…' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(toast(page).getByText(`${name} was deleted.`)).toBeVisible();
    }
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the screens of the indicators and KPI sets, ${scheme} theme`, () => {
    test.use({ reducedMotion: 'reduce' });
    test('have no serious accessibility violation', async ({ page, playwright, baseURL, at }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const tag = unique(`ax${scheme.slice(0, 1)}`);
      const ind = await api.send('POST', '/kpi/indicators', {
        name: `Accessible ${tag}`,
        description: 'Plain text',
        valueType: 'integer',
        unit: 'count',
        min: 0,
        thematic: 'Usage',
      });
      expect(ind.status, JSON.stringify(ind.body)).toBe(201);
      const indicatorId = (ind.body as { id: string }).id;
      const set = await api.send('POST', '/kpi/sets', {
        name: `Accessible set ${tag}`,
        rimoCategory: 'Web_application',
      });
      const setId = (set.body as { id: string }).id;
      expect(
        (
          await api.send('PUT', `/kpi/sets/${setId}/indicators`, {
            indicators: [{ indicatorId, necessity: 'mandatory' }],
          })
        ).status,
      ).toBe(200);
      expect(
        (await api.send('PUT', `/kpi/sets/${setId}/evaluation`, { indicatorId, aggregate: 'sum' }))
          .status,
      ).toBe(200);

      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await signInThroughPage(page, at, admin);
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);

      await page.goto(at(`/kpi/indicators?q=${tag}`));
      await expect(page.getByRole('rowheader', { name: `Accessible ${tag}` })).toBeVisible();
      await clean('the indicator list');
      await page.goto(at('/kpi/indicators?q=no-such-indicator-xyz'));
      await expect(page.getByText('No indicator matches.')).toBeVisible();
      await clean('the empty indicator list');

      await page.goto(at('/kpi/indicators/new'));
      await expect(page.getByRole('heading', { name: 'New indicator', level: 1 })).toBeVisible();
      await clean('the new indicator form');
      await page.getByRole('button', { name: 'Create the indicator' }).click();
      await expect(page.getByText('must not be empty').first()).toBeVisible();
      await clean('the new indicator form with its errors');

      await page.goto(at(`/kpi/indicators/${indicatorId}`));
      await expect(
        page.getByRole('heading', { name: `Accessible ${tag}`, level: 1 }),
      ).toBeVisible();
      await clean('the indicator editor');
      await page.getByRole('button', { name: 'Delete…' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await clean('the delete dialog');
      await page.getByRole('button', { name: 'Cancel' }).click();

      await page.goto(at(`/kpi/sets?q=${tag}`));
      await expect(page.getByRole('rowheader', { name: `Accessible set ${tag}` })).toBeVisible();
      await clean('the set list');
      await page.goto(at('/kpi/sets/new'));
      await clean('the new set form');

      await page.goto(at(`/kpi/sets/${setId}`));
      await expect(
        page.getByRole('heading', { name: `Accessible set ${tag}`, level: 1 }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('button', { name: `Add Accessible ${tag}` })
          .or(page.getByText('In the set').first()),
      ).toBeVisible();
      await clean('the set editor with its picker, rows and evaluation');
      await api.dispose();
    });
  });
}
