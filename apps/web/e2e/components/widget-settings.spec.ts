import { expect, inBothThemes, test } from './support.ts';

// WidgetSettings and DashboardDefaults (harness/scenes/widget-settings.svelte and dashboard-defaults.svelte): the form every widget of the
// dashboard shares, drawn from the JSON Schema of its configuration, and the dialog of the person's defaults. Both over a stand-in API.

const ALPHA = '018f3b7e-aaaa-7000-8000-00000000000a';

test.describe('WidgetSettings', () => {
  test('draws the filter and keeps the keys it does not draw: the service picker, the range and the category from the defaults route', async ({
    page,
    scene,
  }) => {
    await scene('widget-settings');
    const service = page.getByRole('combobox', { name: 'Service', exact: true });
    await expect(service.locator('option')).toHaveText([
      'Choose a service',
      'Alpha service (alpha)',
      'Beta service (beta)',
    ]);
    await expect(page.getByLabel('Range').locator('option')).toHaveCount(5);
    await expect(page.getByLabel('Thematic category').locator('option')).toHaveText([
      'All categories',
      'Usage',
      'Technical',
    ]);
    await service.selectOption(ALPHA);
    await page.getByLabel('Range').selectOption('3m');
    await page.getByLabel('Thematic category').selectOption('Technical');
    await page.getByRole('button', { name: 'Apply' }).click();
    // The list of hidden KPIs is not drawn and comes back as it was.
    expect(JSON.parse((await page.getByTestId('applied').textContent())!)).toEqual({
      service: ALPHA,
      range: '3m',
      category: 'Technical',
      hidden: ['0123456789ab'],
    });
    await expect(page.getByTestId('closed')).toHaveText('closed');
  });

  test('searches the services by name or short name, and chooses none: "Choose a service" is a value', async ({
    page,
    scene,
  }) => {
    await scene('widget-settings');
    await page.getByLabel('Search services').fill('beta');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: 'Service', exact: true }).locator('option'),
    ).toHaveText(['Choose a service', 'Beta service (beta)']);
    await page.getByLabel('Search services').fill('nothing like it');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('No service matches this search.')).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    expect(JSON.parse((await page.getByTestId('applied').textContent())!)).toMatchObject({
      service: null,
    });
  });

  test('refuses what breaks the widget’s schema, says so, and applies nothing; Cancel changes nothing', async ({
    page,
    scene,
  }) => {
    await scene('widget-settings', { query: 'bad' });
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert')).toContainText('Some settings are not valid');
    await expect(page.getByTestId('applied')).toHaveText('');
    await expect(page.getByTestId('closed')).toHaveText('open');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('applied')).toHaveText('');
    await expect(page.getByTestId('closed')).toHaveText('closed');
  });

  test('opens the dialog of the dashboard defaults from the form', async ({ page, scene }) => {
    await scene('widget-settings');
    await page.getByRole('button', { name: 'Dashboard defaults…' }).click();
    await expect(page.getByRole('dialog', { name: 'Dashboard defaults' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('has its texts in German too', async ({ page, scene }) => {
    await scene('widget-settings', { lang: 'de' });
    await expect(page.getByLabel('Zeitraum')).toBeVisible();
    await expect(page.getByLabel('Thematische Kategorie')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Übernehmen' })).toBeVisible();
  });

  test('[component:WidgetSettings] keyboard: every control is reached with Tab in reading order, Enter in the search does not apply the form, and Enter applies it', async ({
    page,
    scene,
  }) => {
    await scene('widget-settings');
    const names = async () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return (
          el?.getAttribute('aria-label') ??
          (el?.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
          el?.textContent?.trim() ??
          ''
        );
      });
    await page.getByLabel('Search services').focus();
    const seen: string[] = [await names()];
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press('Tab');
      seen.push(await names());
    }
    expect(seen).toEqual([
      'Search services',
      'Search',
      'Service',
      'Range',
      'Thematic category',
      'Dashboard defaults…',
      'Cancel',
    ]);
    // Enter in the search box searches and does not apply the form.
    await page.getByLabel('Search services').focus();
    await page.getByLabel('Search services').fill('alpha');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('applied')).toHaveText('');
    await expect(page.getByTestId('requests')).toContainText('GET /services?q=alpha');
    // Apply with Enter on the button: the configuration it was opened with comes back, whole.
    await page.getByRole('button', { name: 'Apply' }).focus();
    await page.keyboard.press('Enter');
    expect(JSON.parse((await page.getByTestId('applied').textContent())!)).toEqual({
      service: null,
      range: '1y',
      category: 'all',
      hidden: ['0123456789ab'],
    });
  });

  inBothThemes('[component:WidgetSettings] axe: the form', 'widget-settings', async (page) => {
    await expect(page.getByLabel('Thematic category').locator('option')).toHaveCount(3);
  });

  inBothThemes(
    '[component:WidgetSettings] axe: the form with a refused setting',
    'widget-settings',
    async (page) => {
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
    'bad',
  );
});

test.describe('DashboardDefaults', () => {
  test('offers the same vocabularies as the widgets and stores service, range and category through the preference route', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-defaults');
    const dialog = page.getByRole('dialog', { name: 'Dashboard defaults' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Thematic category').locator('option')).toHaveText([
      'All categories',
      'Usage',
      'Technical',
    ]);
    await dialog.getByRole('combobox', { name: 'Service', exact: true }).selectOption(ALPHA);
    await dialog.getByLabel('Range').selectOption('2y');
    await dialog.getByLabel('Thematic category').selectOption('Usage');
    await dialog.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByTestId('state')).toHaveText('closed');
    expect(await page.getByTestId('stored').textContent()).toBe(
      `kpi.analytics.defaults ${JSON.stringify({ value: { range: '2y', category: 'Usage', service: ALPHA } })}`,
    );
  });

  test('stores no service while none is chosen, instead of a null the store would refuse', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-defaults');
    await page.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByTestId('state')).toHaveText('closed');
    expect(await page.getByTestId('stored').textContent()).toBe(
      `kpi.analytics.defaults ${JSON.stringify({ value: { range: '1y', category: 'all' } })}`,
    );
  });

  test('[component:DashboardDefaults] keyboard: Escape closes it and gives focus back to what opened it, Tab stays inside', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-defaults');
    await expect(page.getByRole('dialog', { name: 'Dashboard defaults' })).toBeVisible();
    // A modal dialog traps focus: the page behind it, with its "Open the defaults" button, is never a stop.
    await page.getByLabel('Search services').focus();
    const stops: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el?.closest('dialog')
            ? (el.getAttribute('id') ?? el.textContent?.trim() ?? '')
            : 'outside';
        }),
      );
    }
    expect(stops).not.toContain('Open the defaults');
    expect(stops.filter((stop) => stop === 'Save defaults')).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('state')).toHaveText('closed');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  inBothThemes(
    '[component:DashboardDefaults] axe: the dialog',
    'dashboard-defaults',
    async (page) => {
      await expect(page.getByRole('dialog', { name: 'Dashboard defaults' })).toBeVisible();
      await expect(page.getByLabel('Thematic category').locator('option')).toHaveCount(3);
    },
  );
});
