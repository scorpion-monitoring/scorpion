import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

// The sidebar (M12a, sprint 1, item 5): exactly one entry is current, the most specific one, and an entry whose path
// lies below another entry's path is drawn indented under it.

test.describe('the sidebar of an administrator', () => {
  test('marks only Pending approvals on /admin/users/pending and draws it under Users', async ({
    page,
    at,
  }) => {
    await signInThroughPage(page, at, admin);
    await page.goto(at('/admin/users/pending'));
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Pending approvals' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Pending approvals' })).toHaveAttribute(
      'data-depth',
      '1',
    );
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).toHaveAttribute(
      'data-depth',
      '0',
    );

    // The parent is current on its own page and on a page below it that has no entry of its own.
    await page.goto(at('/admin/users'));
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('marks only Impact on /services/evaluate and Services on the catalogue', async ({
    page,
    at,
  }) => {
    await signInThroughPage(page, at, admin);
    await page.goto(at('/services/evaluate'));
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const impact = nav.getByRole('link', { name: 'Impact' });
    await expect(impact).toHaveAttribute('aria-current', 'page');
    await expect(impact).toHaveAttribute('data-depth', '1');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Services', exact: true })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.goto(at('/services'));
    await expect(nav.getByRole('link', { name: 'Services', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });
});
