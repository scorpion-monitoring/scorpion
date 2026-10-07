import type { Page } from '@playwright/test';
import { expect, inBothThemes, test } from './support.ts';

// SchemaForm on a settings-like schema (harness/scenes/schema-form.svelte): what it draws for every kind
// of field, what it sends, how it shows the server's messages, and that it can be used with the keyboard.

const stored = {
  enabled: true,
  name: 'Scorpion',
  port: 25,
  mode: 'plain',
  tags: ['one'],
  limits: { burst: 10, perMinute: 60 },
  providers: [{ id: 'a', label: 'First' }, { id: 'b' }],
};

/** What the form sent, as the scene printed it. */
const submitted = async (page: Page) =>
  JSON.parse(await page.getByTestId('submitted').innerText()) as Record<string, unknown>;
const name = (page: Page) => page.getByLabel(/^Name\b/);

test.describe('SchemaForm', () => {
  test('draws a labelled control for every kind of field, with its hint and its group', async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    await expect(name(page)).toHaveValue('Scorpion');
    await expect(page.getByText('What people see.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Note' }).first()).toBeVisible(); // a long string is a text area
    await expect(page.getByLabel('Contact address')).toHaveAttribute('type', 'email');
    const server = page.getByRole('group', { name: 'Server' });
    await expect(server.getByRole('spinbutton', { name: 'Port' })).toHaveValue('25');
    await expect(server.getByRole('spinbutton', { name: 'Port' })).toHaveAttribute('max', '65535');
    await expect(server.getByLabel('Mode')).toHaveValue('plain');
    await expect(server.getByRole('option')).toHaveText(['plain', 'tls', 'starttls']);
    await expect(page.getByRole('group', { name: 'Limits' }).getByLabel('Burst')).toHaveValue('10');
    await expect(page.getByTestId('widget-note')).toHaveText('Custom widget');
  });

  test('never shows a stored secret, asks the browser for a new password, and sends it only when typed', async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    const token = page.getByLabel('Access token');
    await expect(token).toHaveAttribute('type', 'password');
    await expect(token).toHaveAttribute('autocomplete', 'new-password');
    await expect(token).toHaveValue('');
    await expect(page.getByText('A stored value is never shown.')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    expect(await submitted(page)).not.toHaveProperty('token');
    await token.fill('s3cret');
    await page.getByRole('button', { name: 'Save' }).click();
    expect(await submitted(page)).toHaveProperty('token', 's3cret');
  });

  test('sends what was filled in, and nothing for a field that was emptied', async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('count')).toHaveText('1');
    expect(await submitted(page)).toEqual(stored);

    await name(page).fill('Renamed');
    await page.getByLabel('Contact address').fill('a@example.org');
    await page.getByLabel('Contact address').fill('');
    await page.getByRole('spinbutton', { name: 'Port' }).fill('2525');
    await page.getByLabel('Mode').selectOption('tls');
    await page.getByRole('checkbox', { name: 'Enabled' }).uncheck();
    await page.getByRole('button', { name: 'Save' }).click();
    expect(await submitted(page)).toEqual({
      ...stored,
      name: 'Renamed',
      port: 2525,
      mode: 'tls',
      enabled: false,
    });
  });

  test('adds, edits and removes the items of an array of scalars', async ({ page, scene }) => {
    await scene('schema-form');
    const tags = page.getByRole('group', { name: 'Tags', exact: true });
    await tags.getByRole('button', { name: 'Add' }).click();
    await expect(tags.getByRole('textbox', { name: 'Tags, item 2' })).toBeFocused();
    await page.keyboard.type('two');
    await tags.getByRole('button', { name: 'Remove Tags, item 1' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await submitted(page)).tags).toEqual(['two']);
  });

  test('adds, moves and removes the items of an array of objects, and says what it did', async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    const providers = page.getByRole('group', { name: 'Providers', exact: true });
    await providers.getByRole('button', { name: 'Add' }).click();
    await expect(providers.getByRole('status')).toHaveText('Providers: item 3 added.');
    await expect(
      providers
        .getByRole('group', { name: 'Providers, item 3' })
        .getByRole('textbox', { name: /^Id/ }),
    ).toBeFocused();
    await page.keyboard.type('c');
    await providers.getByRole('button', { name: 'Move Providers, item 3, up' }).click();
    await expect(providers.getByRole('status')).toHaveText(
      'Providers: item 3 moved to position 2.',
    );
    await providers.getByRole('button', { name: 'Remove Providers, item 1' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await submitted(page)).providers).toEqual([{ id: 'c' }, { id: 'b' }]);
  });

  test('offers a choice between shapes and shows the fields of the chosen one', async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    const transport = page.getByLabel('Transport');
    await expect(page.getByLabel('Host')).toBeHidden();
    await transport.selectOption({ label: 'smtp' });
    await page.getByLabel('Host').fill('mail.example.org');
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await submitted(page)).transport).toEqual({
      type: 'smtp',
      host: 'mail.example.org',
    });
    await transport.selectOption({ label: 'none' });
    await expect(page.getByLabel('Host')).toBeHidden();
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await submitted(page)).transport).toEqual({
      type: 'none',
    });
  });

  test("puts the server's messages on the fields they name, and lists them all", async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    await page.getByRole('button', { name: 'Simulate errors' }).click();
    const summary = page.getByRole('alert');
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('listitem')).toHaveText([
      'Name: Name is already used.',
      'Limits › Burst: Burst is too small.',
      'Providers › Item 2 › Id: Provider id is taken.',
      'Tags: Too many tags.',
    ]);
    const nameField = name(page);
    await expect(nameField).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Name is already used.').last()).toBeVisible();
    const described = await nameField.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${described!.split(' ').at(-1)}"]`)).toHaveText(
      'Name is already used.',
    );
    await expect(
      page.getByRole('group', { name: 'Providers, item 2' }).getByRole('textbox', { name: /^Id/ }),
    ).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('group', { name: 'Limits' }).getByLabel('Burst')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('offers to load the current values after a version conflict, and does not save', async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    await page.getByRole('button', { name: 'Simulate conflict' }).click();
    await expect(page.getByText('Somebody else changed this')).toBeVisible();
    await page.getByRole('button', { name: 'Load the current values' }).click();
    await expect(name(page)).toHaveValue('Reloaded');
    await expect(page.getByText('Somebody else changed this')).toBeHidden();
    await expect(page.getByTestId('count')).toHaveText('0');
  });

  test('speaks German when the page does', async ({ page, scene }) => {
    await scene('schema-form', { lang: 'de' });
    await expect(page.getByRole('button', { name: 'Speichern' })).toBeVisible();
    await expect(
      page
        .getByRole('group', { name: 'Tags', exact: true })
        .getByRole('button', { name: 'Hinzufügen' }),
    ).toBeVisible();
  });

  test('[component:SchemaForm] keyboard: Tab goes through the fields in order, Space toggles, Enter in a field saves, and an item is moved without the mouse', async ({
    page,
    scene,
  }) => {
    await scene('schema-form');
    await page.getByRole('checkbox', { name: 'Enabled' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked();
    await page.keyboard.press('Tab');
    await expect(name(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Note')).toBeFocused();
    // The select changes by typing the start of an option (the arrow keys open the list on some platforms).
    await page.getByLabel('Mode').focus();
    await page.keyboard.type('tl');
    await expect(page.getByLabel('Mode')).toHaveValue('tls');
    // Enter in a text field submits the form.
    await name(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('count')).toHaveText('1');
    expect(await submitted(page)).toMatchObject({
      enabled: false,
      mode: 'tls',
    });
    // An item of an array moves with the keyboard, and focus stays on the control that moved it.
    const providers = page.getByRole('group', { name: 'Providers', exact: true });
    await providers.getByRole('button', { name: 'Move Providers, item 1, down' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      providers.getByRole('button', { name: 'Move Providers, item 2, down' }),
    ).toBeDisabled();
    await expect(
      providers.getByRole('button', { name: 'Move Providers, item 2, up' }),
    ).toBeFocused();
    await expect(
      providers
        .getByRole('group', { name: 'Providers, item 2' })
        .getByRole('textbox', { name: /^Id/ }),
    ).toHaveValue('a');
  });

  inBothThemes('[component:SchemaForm] axe: the form as stored', 'schema-form');
  inBothThemes(
    "[component:SchemaForm] axe: with the server's messages and a conflict",
    'schema-form',
    async (page) => {
      await page.getByRole('button', { name: 'Simulate conflict' }).click();
      await page.getByRole('button', { name: 'Simulate errors' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  );
});
