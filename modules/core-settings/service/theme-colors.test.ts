import { Forbidden, Invalid, Unauthorized, type FieldProblem } from '@scorpion/contracts';
import { themeStylesheet } from '@scorpion/contracts/theme-colors';
import { makeSetting } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useSettings } from '../test/harness.ts';

// M12a sprint 4: the theme colours are branding settings of core.settings. A save goes through the settings service like any other
// (permission, version, `settings.changed@1` in the same transaction); a set that fails WCAG AA is refused with the pair named and
// nothing of the save is written; a value that is not `#rrggbb`, or a name that is not a token, never gets stored.

const harness = useSettings();
const ANONYMOUS = { kind: 'anonymous' } as const;

/** A readable custom set: a dark teal primary in light, an amber primary in dark (text colours derived). */
const CUSTOM = {
  light: { primary: '#0f5c5c', 'base-100': '#ffffff' },
  dark: { primary: '#fbbf24', accent: '#a78bfa', 'accent-content': '#1e1b4b' },
};

async function setup() {
  const started = await harness.start();
  const admin = await started.actorOf('admin');
  const service = started.settings.settings;
  const current = () => service.get(admin, 'core.settings');
  /** Saves `branding` (merged into what is stored) as the administrator. */
  const save = async (branding: Record<string, unknown>, actor = admin) => {
    const before = await current();
    const values = before.values as { branding: Record<string, unknown> };
    return service.update(actor, 'core.settings', {
      version: before.version,
      values: { ...values, branding: { ...values.branding, ...branding } },
    });
  };
  const outbox = async () =>
    (
      await started.kernel.pool.query(
        "select payload from kernel_outbox where name = 'settings.changed@1' order by id",
      )
    ).rows as { payload: { keys: string[] } }[];
  return {
    ...started,
    admin,
    member: await started.actorOf('user'),
    service,
    current,
    save,
    outbox,
  };
}

async function refusal(promise: Promise<unknown>): Promise<FieldProblem[]> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Invalid);
  return [...((error as Invalid).errors ?? [])];
}

describe('the theme colours', () => {
  it('are empty by default: no colour, no version, the built-in themes apply', async () => {
    const { settings } = await setup();
    expect(await settings.getBranding()).toMatchObject({
      colors: { light: {}, dark: {} },
      themeVersion: null,
    });
  });

  it('are saved by an administrator, with the text colours derived, a version and the event', async () => {
    const { settings, save, outbox } = await setup();
    const saved = await save({ colors: CUSTOM });
    expect(saved.version).toBe(1);
    const branding = await settings.getBranding();
    expect(branding.colors).toEqual({
      light: {
        primary: '#0f5c5c',
        'primary-content': '#ffffff',
        'base-100': '#ffffff',
        'base-content': '#000000',
      },
      dark: {
        primary: '#fbbf24',
        'primary-content': '#000000',
        accent: '#a78bfa',
        'accent-content': '#1e1b4b',
      },
    });
    expect(branding.themeVersion).toMatch(/^[0-9a-f]{16}$/);
    // The first save of an empty instance stores the defaults of the other keys too, so `rateLimits` is named with it.
    expect((await outbox()).map((row) => row.payload.keys)).toEqual([['branding', 'rateLimits']]);
  });

  it('get a new version when they change, and the same one for the same colours', async () => {
    const { settings, save } = await setup();
    await save({ colors: CUSTOM });
    const first = (await settings.getBranding()).themeVersion;
    await save({ colors: { ...CUSTOM, dark: { primary: '#fcd34d' } } });
    const second = (await settings.getBranding()).themeVersion;
    expect(second).not.toBe(first);
    await save({ colors: CUSTOM });
    expect((await settings.getBranding()).themeVersion).toBe(first);
  });

  it('refuse a set that fails AA, naming the pair, and write nothing of the save (no row, no event)', async () => {
    const { settings, save, current, outbox } = await setup();
    await save({ instanceName: 'BioNet Registry' });
    const before = await current();
    const fields = await refusal(
      save({
        instanceName: 'Renamed in the same save',
        colors: { light: { primary: '#29b6f6', 'primary-content': '#ffffff' } },
      }),
    );
    expect(fields).toEqual([
      {
        in: 'body',
        path: 'values.branding.colors.light',
        message: 'In the light theme, primary-content on primary is 2.30:1, needs 4.5:1 (WCAG AA).',
      },
      {
        in: 'body',
        path: 'values.branding.colors.light',
        message: 'In the light theme, primary on base-100 is 2.15:1, needs 4.5:1 (WCAG AA).',
      },
      {
        in: 'body',
        path: 'values.branding.colors.light',
        message: 'In the light theme, primary on base-200 is 1.94:1, needs 3:1 (WCAG AA).',
      },
      {
        in: 'body',
        path: 'values.branding.colors.light',
        message: 'In the light theme, primary on base-300 is 1.72:1, needs 3:1 (WCAG AA).',
      },
    ]);
    expect(await current()).toEqual(before);
    expect(await settings.getBranding({ fresh: true })).toMatchObject({
      instanceName: 'BioNet Registry',
      colors: { light: {}, dark: {} },
    });
    expect(await outbox()).toHaveLength(1);
  });

  it('check each theme on its own: a failing dark set is named as dark', async () => {
    const { save } = await setup();
    const fields = await refusal(save({ colors: { dark: { 'base-content': '#1e293b' } } }));
    expect(fields.map((field) => field.message)).toEqual([
      'In the dark theme, base-content on base-100 is 1.32:1, needs 4.5:1 (WCAG AA).',
      'In the dark theme, base-content on base-200 is 1.19:1, needs 4.5:1 (WCAG AA).',
      'In the dark theme, base-content on base-300 is 1.00:1, needs 4.5:1 (WCAG AA).',
    ]);
  });

  it.each([
    ['a rule break', 'red;}body{display:none'],
    ['a closing style tag', '</style><script>alert(1)</script>'],
    ['a URL', 'url(https://evil.example/x.png)'],
    ['a short hex', '#fff'],
    ['a named colour', 'red'],
    ['rgb()', 'rgb(0, 0, 0)'],
    ['a variable', 'var(--color-error)'],
    ['a trailing semicolon', '#ffffff;'],
  ])('refuse %s as a value at save, and it never reaches the stylesheet', async (_, value) => {
    const { settings, save, current } = await setup();
    const before = await current();
    const fields = await refusal(save({ colors: { light: { primary: value } } }));
    expect(fields).toEqual([
      expect.objectContaining({ path: 'values.branding.colors.light.primary' }),
    ]);
    expect(await current()).toEqual(before);
    const branding = await settings.getBranding({ fresh: true });
    expect(themeStylesheet(branding.colors)).not.toContain(value);
  });

  it.each(['primary;}body{', 'radius-box', 'muted', 'color-primary'])(
    'refuse the unknown name %j at save',
    async (name) => {
      const { save, current } = await setup();
      const before = await current();
      const fields = await refusal(save({ colors: { light: { [name]: '#ffffff' } } }));
      expect(fields.map((field) => field.path)).toEqual(['values.branding.colors.light']);
      expect(await current()).toEqual(before);
    },
  );

  it('are reset per theme: the light set is cleared and the dark one stays', async () => {
    const { settings, save } = await setup();
    await save({ colors: CUSTOM });
    await save({ colors: { light: {}, dark: CUSTOM.dark } });
    const branding = await settings.getBranding();
    expect(branding.colors.light).toEqual({});
    expect(branding.colors.dark).toMatchObject(CUSTOM.dark);
    expect(branding.themeVersion).not.toBeNull();
    await save({ colors: { light: {}, dark: {} } });
    expect(await settings.getBranding()).toMatchObject({
      colors: { light: {}, dark: {} },
      themeVersion: null,
    });
  });

  it('are denied without core.settings.write (403) and for anonymous (401), and nothing is stored', async () => {
    const { service, member, kernel } = await setup();
    const input = { version: 0, values: { branding: { colors: CUSTOM } } };
    await expect(service.update(member, 'core.settings', input)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.update(ANONYMOUS, 'core.settings', input)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect((await kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
  });

  it('roll back with the event: a save whose event cannot be written stores no colour', async () => {
    const { settings, save, kernel, current } = await setup();
    await save({ colors: { dark: CUSTOM.dark } });
    const before = await current();
    const restore = await breakOutbox(kernel.pool);
    await expect(save({ colors: CUSTOM })).rejects.toThrow();
    await restore();
    expect(await current()).toEqual(before);
    expect((await settings.getBranding({ fresh: true })).colors.light).toEqual({});
  });

  it('are not measured again when a save leaves them as they were (a later change of the built-in colours locks nobody out)', async () => {
    const { save, kernel, current } = await setup();
    // Stored behind the service's back: a set that fails today, as one could after the built-in colours change in an upgrade.
    const failing = { light: { 'primary-content': '#29b6f6' } };
    await makeSetting(kernel.pool, 'core.settings', { branding: { colors: failing } });
    await expect(save({ instanceName: 'PlantData' })).resolves.toMatchObject({ version: 2 });
    // Changing them is measured.
    await refusal(save({ colors: { light: { 'primary-content': '#29b6f7' } } }));
    expect((await current()).version).toBe(2);
  });

  it('are measured for trusted code too: seed and seedKey refuse a failing set', async () => {
    const { settings, current } = await setup();
    const failing = { colors: { light: { 'base-content': '#f4f8fc' } } };
    await expect(
      settings.seedSettings('core.settings', { branding: failing }),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(
      settings.seedSettingKey('core.settings', 'branding', failing),
    ).rejects.toBeInstanceOf(Invalid);
    expect((await current()).version).toBe(0);
  });
});
