import { Invalid } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { useSettings } from '../test/harness.ts';

const harness = useSettings();
const HASH = 'a'.repeat(64);

async function setup(options: Parameters<typeof harness.start>[0] = {}) {
  const started = await harness.start(options);
  const admin = await started.actorOf('admin');
  /** Saves `branding` as the whole settings of core.settings (a save replaces the object). */
  const save = async (branding: Record<string, unknown>, version?: number) => {
    const current = await started.settings.settings.get(admin, 'core.settings');
    return started.settings.settings.update(admin, 'core.settings', {
      version: version ?? current.version,
      values: { ...(current.values as object), branding },
    });
  };
  return { ...started, admin, save };
}

describe('the effective branding', () => {
  it('has the product name for the instance, a placeholder sender and nothing else by default', async () => {
    const { settings } = await setup();
    expect(await settings.getBranding()).toEqual({
      productName: 'Scorpion',
      instanceName: 'Scorpion',
      mailFrom: 'no-reply@localhost',
      contactEmail: null,
      imprintUrl: null,
      logos: { light: null, dark: null },
      legalPages: [],
    });
  });

  it('shows what an administrator saved, and falls back where a value is not set', async () => {
    const { settings, save } = await setup();
    await save({
      productName: 'Registry',
      instanceName: 'de.NBI Registry',
      mailFrom: 'registry@example.org',
      contactEmail: 'help@example.org',
      imprintUrl: 'https://example.org/imprint',
      logos: { light: HASH },
      legal: { terms: '# Terms', privacy: '   ', imprint: 'Us' },
    });
    expect(await settings.getBranding()).toEqual({
      productName: 'Registry',
      instanceName: 'de.NBI Registry',
      mailFrom: 'registry@example.org',
      contactEmail: 'help@example.org',
      imprintUrl: 'https://example.org/imprint',
      logos: { light: HASH, dark: null },
      legalPages: ['terms', 'imprint'],
    });
    await save({ productName: 'Registry' });
    expect(await settings.getBranding()).toMatchObject({
      instanceName: 'Registry',
      mailFrom: 'no-reply@localhost',
      legalPages: [],
    });
  });

  it.each([
    ['an empty instance name', { instanceName: ' ' }, 'values.branding.instanceName'],
    [
      'an instance name that is too long',
      { instanceName: 'x'.repeat(101) },
      'values.branding.instanceName',
    ],
    ['a sender that is too short', { mailFrom: 'a' }, 'values.branding.mailFrom'],
    [
      'a contact that is not an address',
      { contactEmail: 'not an address' },
      'values.branding.contactEmail',
    ],
    [
      'an imprint link that runs script',
      { imprintUrl: 'javascript:alert(1)' },
      'values.branding.imprintUrl',
    ],
    [
      'an imprint link with another scheme',
      { imprintUrl: 'ftp://example.org/' },
      'values.branding.imprintUrl',
    ],
    [
      'a logo that is not a hash',
      { logos: { light: '../../etc/passwd' } },
      'values.branding.logos.light',
    ],
    [
      'a logo hash in upper case',
      { logos: { light: 'A'.repeat(64) } },
      'values.branding.logos.light',
    ],
    [
      'a legal text that is too long',
      { legal: { terms: 'x'.repeat(100_001) } },
      'values.branding.legal.terms',
    ],
    ['an unknown legal page', { legal: { cookies: 'x' } }, 'values.branding.legal'],
    ['an unknown field', { tagline: 'x' }, 'values.branding'],
  ])('refuses %s with 422 and stores nothing', async (_name, branding, path) => {
    const { save, kernel } = await setup();
    const error = await save(branding).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    expect((error as Invalid).errors?.map((e) => e.path)).toContain(path);
    expect((await kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
  });

  it('does not put a stored value that is no longer valid into the branding: the key falls back', async () => {
    const { settings, kernel } = await setup();
    await kernel.pool.query(
      `insert into settings_setting (module_id, value) values ('core.settings', $1)`,
      [
        JSON.stringify({
          branding: { instanceName: 5 },
          rateLimits: { default: { burst: 7, perMinute: 7 } },
        }),
      ],
    );
    expect(await settings.getBranding()).toMatchObject({ instanceName: 'Scorpion' });
  });
});

describe('two processes', () => {
  it('a second process sees a change within the cache time, or at once with `fresh`', async () => {
    let now = 1_000_000;
    const first = await setup({ now: () => now, cacheTtlMs: 5_000 });
    const second = await harness.start({
      databaseUrl: first.databaseUrl,
      now: () => now,
      cacheTtlMs: 5_000,
    });
    expect((await second.settings.getBranding()).instanceName).toBe('Scorpion'); // now it is cached
    await first.save({ instanceName: 'Renamed' });
    expect((await first.settings.getBranding()).instanceName).toBe('Renamed'); // the writer at once
    expect((await second.settings.getBranding()).instanceName).toBe('Scorpion');
    expect((await second.settings.getBranding({ fresh: true })).instanceName).toBe('Renamed');
    now += 5_001;
    expect((await second.settings.getBranding()).instanceName).toBe('Renamed');
  });
});

describe('legal pages', () => {
  it('renders Markdown to sanitised HTML, and has nothing for a page without a text', async () => {
    const { branding, save } = await setup().then((s) => ({
      branding: s.settings.branding,
      save: s.save,
    }));
    expect(await branding.legal('terms')).toBeUndefined();
    await save({
      legal: {
        terms:
          '# Terms\n\nUse **at your own risk**, see [us](https://example.org).\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))',
        privacy: '   ',
      },
    });
    const document = await branding.legal('terms');
    expect(document).toMatchObject({ page: 'terms', title: 'Terms of use' });
    expect(document!.html).toContain('<h1>Terms</h1>');
    expect(document!.html).toContain('<strong>at your own risk</strong>');
    expect(document!.html).toContain('href="https://example.org"');
    expect(document!.html).not.toMatch(/<script|href="javascript/i);
    expect(await branding.legal('privacy')).toBeUndefined();
  });

  it('shows an edit at once in the process that wrote it', async () => {
    const { settings, save } = await setup();
    await save({ legal: { privacy: 'one' } });
    expect((await settings.branding.legal('privacy'))!.html).toBe('<p>one</p>');
    await save({ legal: { privacy: 'two' } });
    expect((await settings.branding.legal('privacy'))!.html).toBe('<p>two</p>');
  });

  it('survives text that is hostile to a parser', async () => {
    const { settings, save } = await setup();
    const hostile = [
      '[',
      '](',
      '**',
      '`'.repeat(500),
      '*'.repeat(500),
      '[a](b'.repeat(200),
      '> '.repeat(300),
      '#'.repeat(40),
    ].join('\n');
    await save({ legal: { imprint: hostile } });
    const started = Date.now();
    const document = await settings.branding.legal('imprint');
    expect(document!.html).not.toMatch(/<script/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
