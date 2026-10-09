import { expect, inBothThemes, test } from './support.ts';

// Wizard (harness/scenes/wizard.svelte): three steps, the second validated, state kept across steps, and a
// guard against leaving a page with unsaved work.

test.describe('Wizard', () => {
  test('moves on only when the step is fine, and keeps what was typed when a step is left and opened again', async ({
    page,
    scene,
  }) => {
    await scene('wizard');
    await expect(page.getByRole('heading', { name: 'Step 1 of 3: Who' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a name.');
    await expect(page.getByRole('heading', { name: 'Step 1 of 3: Who' })).toBeVisible();

    await page.getByLabel('Name').fill('Ada');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Step 2 of 3: Contact' })).toBeFocused();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter an email address.');
    await page.getByLabel('Email').fill('ada@example.org');

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Name')).toHaveValue('Ada');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByLabel('Email')).toHaveValue('ada@example.org');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('review-name')).toHaveText('Ada');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByTestId('done')).toHaveText('Ada <ada@example.org>');
  });

  test('shows the progress, and lets the person go back to a step they have reached from it', async ({
    page,
    scene,
  }) => {
    await scene('wizard');
    const progress = page.getByRole('navigation', { name: 'Progress' });
    await expect(progress.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
    await expect(progress.getByRole('button')).toHaveCount(0); // no step beyond the first has been reached
    await page.getByLabel('Name').fill('Ada');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(progress.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'step');
    await progress.getByRole('button', { name: 'Who' }).click();
    await expect(page.getByRole('heading', { name: 'Step 1 of 3: Who' })).toBeVisible();
    await expect(progress.getByRole('button', { name: 'Contact' })).toBeVisible();
  });

  test('asks before the page is left while work is unsaved, and not when there is none or when it is done', async ({
    page,
    scene,
  }) => {
    await scene('wizard');
    const wantsConfirm = () =>
      page.evaluate(() =>
        (window as unknown as { __wantsConfirm: () => boolean }).__wantsConfirm(),
      );
    expect(await wantsConfirm()).toBe(false);
    await page.getByLabel('Name').fill('Ada');
    expect(await wantsConfirm()).toBe(true);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Email').fill('ada@example.org');
    await page.getByRole('button', { name: 'Next' }).click();
    expect(await wantsConfirm()).toBe(true);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByTestId('done')).not.toBeEmpty();
    expect(await wantsConfirm()).toBe(false);
  });

  test("[component:Wizard] keyboard: Tab and Enter move through the steps, and focus lands on the new step's heading", async ({
    page,
    scene,
  }) => {
    await scene('wizard');
    await page.getByLabel('Name').focus();
    await page.keyboard.type('Ada');
    await page.getByRole('button', { name: 'Next' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Step 2 of 3: Contact' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
    await page.keyboard.type('ada@example.org');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Step 3 of 3: Review' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('done')).toHaveText('Ada <ada@example.org>');
  });

  inBothThemes('[component:Wizard] axe: first step', 'wizard');
  inBothThemes('[component:Wizard] axe: a step with a problem', 'wizard', async (page) => {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
