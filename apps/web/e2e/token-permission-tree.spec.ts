import { expect, test } from './support/fixtures.ts';
import { violations } from './support/a11y.ts';
import { permissionBox, profileOf } from './support/profile.ts';

// The permissions of a new token as a tree per dotted segment (M12a, sprint 1, item 2): a parent selects or clears
// everything below it, says how many it covers, and the arrow keys and the space bar work.

test.describe('the permission tree of a new token', () => {
  test('starts closed, opens a group with its button and counts the ticked entries', async ({
    page,
    at,
  }) => {
    await profileOf(page, at, 'tree');
    const tokens = page.getByRole('region', { name: 'Access tokens' });
    const tree = tokens.getByTestId('permission-tree');

    const core = tree.getByRole('checkbox', { name: 'core', exact: true });
    await expect(core).toBeVisible();
    await expect(tree.getByRole('checkbox', { name: 'core.identity', exact: true })).toHaveCount(0);

    const leaf = await permissionBox(tokens, 'core.identity.me.read');
    await expect(leaf).toBeVisible();
    await leaf.check();
    // The parents are partly ticked, not ticked, and say 1 of N.
    await expect(core).toHaveJSProperty('indeterminate', true);
    await expect(core).not.toBeChecked();
    await expect(tree.getByTestId('perm-count').first()).toContainText(/^1 of \d+$/);
  });

  test('selects every permission below a group and clears them again', async ({ page, at }) => {
    await profileOf(page, at, 'treeall');
    const tokens = page.getByRole('region', { name: 'Access tokens' });
    const tree = tokens.getByTestId('permission-tree');
    const group = tree.getByRole('checkbox', { name: 'core', exact: true });

    await group.check();
    await expect(group).toBeChecked();
    // Open one branch: its leaves are ticked too.
    const leaf = await permissionBox(tokens, 'core.identity.me.read');
    await expect(leaf).toBeChecked();

    // Unticking one leaf makes the group partly ticked; the group's next click selects all again.
    await leaf.uncheck();
    await expect(group).toHaveJSProperty('indeterminate', true);
    await group.click();
    await expect(group).toBeChecked();
    await expect(leaf).toBeChecked();

    await group.uncheck();
    await expect(group).not.toBeChecked();
    await expect(leaf).not.toBeChecked();
  });

  test('is reachable with the keyboard: arrows move, right and left open and close, space ticks', async ({
    page,
    at,
  }) => {
    await profileOf(page, at, 'treekeys');
    const tokens = page.getByRole('region', { name: 'Access tokens' });
    const tree = tokens.getByTestId('permission-tree');

    // One entry is in the tab order.
    await expect(tree.locator('input[type=checkbox][tabindex="0"]')).toHaveCount(1);

    const first = tree.locator('input[type=checkbox]').first();
    await first.focus();
    const name = (await first.getAttribute('data-key'))!;
    // The first group's button; its name changes from "Show" to "Hide" when it opens.
    const opener = tree.getByRole('button').first();
    await expect(opener).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('ArrowRight');
    await expect(opener).toHaveAttribute('aria-expanded', 'true');
    // Right again enters the group: the focus is on a child now.
    await page.keyboard.press('ArrowRight');
    const child = await page.evaluate(() => document.activeElement?.getAttribute('data-key'));
    expect(child?.startsWith(`${name}.`)).toBe(true);
    // Left goes back to the parent, left again closes it.
    await page.keyboard.press('ArrowLeft');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(opener).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Space');
    await expect(first).toBeChecked();
    await page.keyboard.press('Space');
    await expect(first).not.toBeChecked();
    await page.keyboard.press('End');
    await expect(tree.locator('input[type=checkbox]').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
  });

  test('sends the flat list of permission ids when the token is created', async ({ page, at }) => {
    await profileOf(page, at, 'treesend');
    const tokens = page.getByRole('region', { name: 'Access tokens' });
    await tokens.getByLabel('Name').fill('tree token');
    await (await permissionBox(tokens, 'core.identity.me.read')).check();
    const request = page.waitForRequest(
      (made) => made.method() === 'POST' && made.url().endsWith('/tokens'),
    );
    await tokens.getByRole('button', { name: 'Create the token' }).click();
    const body = (await request).postDataJSON() as { scopes: string[] };
    expect(body.scopes).toEqual(['core.identity.me.read']);
  });

  test('has no serious accessibility violation, closed, open and partly ticked', async ({
    page,
    at,
  }) => {
    await profileOf(page, at, 'treeaxe');
    const tokens = page.getByRole('region', { name: 'Access tokens' });
    expect(await violations(page, '[data-testid="permission-tree"]'), 'closed').toEqual([]);
    await (await permissionBox(tokens, 'core.identity.me.read')).check();
    expect(await violations(page, '[data-testid="permission-tree"]'), 'open').toEqual([]);
  });
});
