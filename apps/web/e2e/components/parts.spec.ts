import { expect, inBothThemes, test } from './support.ts';

// Toasts, the confirm dialog, tabs, the breadcrumb and pagination: what each does, that it works with the
// keyboard alone, and that axe finds nothing serious in either theme.

test.describe('Toasts', () => {
  test('a success goes by itself, and an error stays until it is dismissed', async ({
    page,
    scene,
  }) => {
    await scene('parts');
    await page.getByRole('button', { name: 'Success' }).click();
    const region = page.getByRole('region', { name: 'Notifications' });
    await expect(region.getByText('Saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Error' }).click();
    await expect(region.getByRole('alert')).toContainText('That failed.');
    await expect(region.getByText('Saved.')).toBeHidden({ timeout: 6000 });
    await expect(region.getByRole('alert')).toBeVisible();
    await region.getByRole('button', { name: 'Dismiss this notification' }).click();
    await expect(region.getByRole('alert')).toBeHidden();
  });

  test('[component:Toasts] keyboard: an error is closed with Enter', async ({ page, scene }) => {
    await scene('parts');
    await page.getByRole('button', { name: 'Error' }).focus();
    await page.keyboard.press('Enter');
    const dismiss = page.getByRole('button', { name: 'Dismiss this notification' });
    await dismiss.focus();
    await expect(dismiss).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toBeHidden();
  });

  inBothThemes('[component:Toasts] axe: toasts showing', 'parts', async (page) => {
    await page.getByRole('button', { name: 'Success' }).click();
    await page.getByRole('button', { name: 'Info' }).click();
    await page.getByRole('button', { name: 'Error' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

test.describe('ConfirmDialog', () => {
  test('confirms, or cancels, and says which', async ({ page, scene }) => {
    await scene('parts');
    await page.getByRole('button', { name: 'End every session' }).click();
    const dialog = page.getByRole('dialog', { name: 'End every session?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('confirmed')).toHaveText('no');
    await page.getByRole('button', { name: 'End every session' }).click();
    await dialog.getByRole('button', { name: 'End them' }).click();
    await expect(page.getByTestId('confirmed')).toHaveText('yes');
  });

  test('[component:ConfirmDialog] keyboard: opens on the safe choice, keeps focus inside, Escape cancels and gives focus back', async ({
    page,
    scene,
  }) => {
    await scene('parts');
    const opener = page.getByRole('button', { name: 'End every session' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'End every session?' });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press('Tab');
      const outside = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active !== null &&
          active !== document.body &&
          !document.querySelector('dialog[open]')?.contains(active)
        );
      });
      expect(outside, 'focus left the dialog').toBe(false);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.getByTestId('confirmed')).toHaveText('no');
  });

  inBothThemes('[component:ConfirmDialog] axe: dialog open', 'parts', async (page) => {
    await page.getByRole('button', { name: 'End every session' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test.describe('Tabs', () => {
  test('shows the panel of the selected tab', async ({ page, scene }) => {
    await scene('parts');
    await expect(page.getByRole('tabpanel')).toHaveText('Panel one');
    await page.getByRole('tab', { name: 'Two' }).click();
    await expect(page.getByRole('tabpanel')).toHaveText('Panel two');
    await expect(page.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
  });

  test('[component:Tabs] keyboard: arrows, Home and End move and select; one Tab goes into the panel', async ({
    page,
    scene,
  }) => {
    await scene('parts');
    await page.getByRole('tab', { name: 'One' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Two' })).toBeFocused();
    await expect(page.getByRole('tabpanel')).toHaveText('Panel two');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Three' })).toBeFocused();
    await page.keyboard.press('ArrowRight'); // wraps round
    await expect(page.getByRole('tab', { name: 'One' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Three' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'One' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tabpanel')).toBeFocused();
  });

  inBothThemes('[component:Tabs] axe', 'parts');
});

test.describe('Breadcrumb', () => {
  test('is a labelled navigation that marks the page it is on', async ({ page, scene }) => {
    await scene('parts');
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav.getByRole('link')).toHaveText(['Home', 'Admin']);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Users');
  });

  test('[component:Breadcrumb] keyboard: the links are reached with Tab', async ({
    page,
    scene,
  }) => {
    await scene('parts');
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await nav.getByRole('link', { name: 'Home' }).focus();
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name: 'Admin' })).toBeFocused();
  });

  inBothThemes('[component:Breadcrumb] axe', 'parts');
});

test.describe('Pagination', () => {
  test('shows the range and the current page, and moves', async ({ page, scene }) => {
    await scene('parts');
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await expect(nav.getByRole('status')).toHaveText('41–60 of 134');
    await expect(nav.getByRole('button', { name: 'Page 3' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await nav.getByRole('button', { name: 'Next' }).click();
    await expect(nav.getByRole('status')).toHaveText('61–80 of 134');
    await expect(page.getByTestId('page')).toHaveText('3');
    await nav.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
    await expect(page.getByTestId('page')).toHaveText('0');
    await expect(nav.getByRole('status')).toHaveText('1–50 of 134');
    await expect(nav.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  test('[component:Pagination] keyboard: Enter on a page button and on Next', async ({
    page,
    scene,
  }) => {
    await scene('parts');
    const nav = page.getByRole('navigation', { name: 'Pages' });
    await nav.getByRole('button', { name: 'Page 1', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('page')).toHaveText('0');
    await nav.getByRole('button', { name: 'Next' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('page')).toHaveText('1');
  });

  inBothThemes('[component:Pagination] axe', 'parts');
});
