// matomo as the kernel sees it, its settings, and the service with its two inputs replaced (the routes against real
// Postgres are in apps/server/src/matomo-routes.test.ts).
import { ANONYMOUS, type Actor } from '@scorpion/contracts';
import { describe, expect, it, vi } from 'vitest';
import manifest, { isMatomoUrl, settingsSchema, type MatomoSettings } from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { trackerRoute } from './routes.ts';
import {
  baseUrl,
  createTrackerService,
  pseudonymousId,
  USER_ID_KEY_SECRET,
  USER_ID_LENGTH,
} from './service/tracker.ts';
import { MATOMO_WIDGETS } from './ui/routes.ts';

const user = (userId: string): Actor => ({
  kind: 'user',
  userId,
  username: 'someone',
  roles: [],
  via: 'session',
});

describe('the manifest', () => {
  it('has the id, its settings, the tracker widget, and no table, permission or job', () => {
    expect(manifest.id).toBe('matomo');
    expect(manifest.settings).toBe(settingsSchema);
    expect(manifest.schema).toBeUndefined();
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.jobs).toBeUndefined();
    expect(manifest.contributes?.['ui.widget']).toEqual(MATOMO_WIDGETS);
  });

  it('depends on core.settings and core.ui-shell only', () => {
    expect(
      Object.keys(packageJson.dependencies).filter((name) => name.startsWith('@scorpion/')),
    ).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-settings',
      '@scorpion/core-ui-shell',
      '@scorpion/kernel',
    ]);
  });

  it('has one route, public with a reason', () => {
    expect(trackerRoute.method).toBe('get');
    expect(trackerRoute.path).toBe('/matomo/tracker');
    expect(trackerRoute.public).toBe(true);
    expect(trackerRoute.publicReason).toBeTruthy();
  });
});

describe('settingsSchema', () => {
  it('is off, cookieless, respecting Do Not Track and without user ids by default', () => {
    expect(settingsSchema.parse({})).toEqual({
      enabled: false,
      cookieless: true,
      respectDoNotTrack: true,
      pseudonymousUserId: false,
    });
  });

  it.each([
    ['https://stats.example.org', true],
    ['https://stats.example.org/', true],
    ['https://example.org/matomo/', true],
    ['https://stats.example.org:8443/', true],
    ['http://stats.example.org/', false],
    ['https://stats.example.org/?x=1', false],
    ['https://stats.example.org/?', false],
    ['https://stats.example.org/#a', false],
    ['https://user:pw@stats.example.org/', false],
    ['https://*.example.org/', false],
    ['javascript:alert(1)', false],
    ['//stats.example.org/', false],
    ['stats.example.org', false],
    ['', false],
  ])('isMatomoUrl(%s) is %s', (value, expected) => {
    expect(isMatomoUrl(value)).toBe(expected);
    expect(settingsSchema.safeParse({ url: value }).success).toBe(expected);
  });

  it('refuses an address longer than 200 characters', () => {
    const long = `https://example.org/${'a'.repeat(181)}`;
    expect(settingsSchema.safeParse({ url: long }).success).toBe(false);
  });

  it.each([
    [{ enabled: true }, ['siteId', 'url']],
    [{ enabled: true, url: 'https://stats.example.org/' }, ['siteId']],
    [{ enabled: true, siteId: 3 }, ['url']],
    [{ enabled: true, url: 'https://stats.example.org/', siteId: 3 }, []],
    [{ enabled: false }, []],
  ])('%j: the fields that are missing are %j', (values, missing) => {
    const parsed = settingsSchema.safeParse(values);
    const paths = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
    expect(paths.sort()).toEqual(missing);
  });

  it.each([0, -1, 1.5, '3'])('refuses the site id %j, and an unknown key', (siteId) => {
    expect(settingsSchema.safeParse({ siteId }).success).toBe(false);
    expect(settingsSchema.safeParse({ other: true }).success).toBe(false);
  });
});

describe('pseudonymousId() and baseUrl()', () => {
  it('is stable for one key, differs per key and per user, and never contains the user id', () => {
    const id = pseudonymousId('key-a', 'user-1');
    expect(id).toMatch(new RegExp(`^[0-9a-f]{${USER_ID_LENGTH}}$`));
    expect(pseudonymousId('key-a', 'user-1')).toBe(id);
    expect(pseudonymousId('key-b', 'user-1')).not.toBe(id);
    expect(pseudonymousId('key-a', 'user-2')).not.toBe(id);
    expect(id).not.toContain('user-1');
  });

  it.each([
    ['https://stats.example.org', 'https://stats.example.org/'],
    ['https://stats.example.org/', 'https://stats.example.org/'],
    ['https://example.org/matomo', 'https://example.org/matomo/'],
  ])('baseUrl(%s) is %s', (url, expected) => {
    expect(baseUrl(url)).toBe(expected);
  });
});

describe('the tracker service', () => {
  const on: MatomoSettings = {
    enabled: true,
    url: 'https://stats.example.org',
    siteId: 7,
    cookieless: true,
    respectDoNotTrack: true,
    pseudonymousUserId: false,
  };
  const make = (settings: MatomoSettings, key?: string) => {
    const log = { warn: vi.fn() };
    const secret = vi.fn((name: string) =>
      Promise.resolve(name === USER_ID_KEY_SECRET ? key : undefined),
    );
    const service = createTrackerService({
      settings: () => Promise.resolve(settings),
      secret,
      log: log as never,
    });
    return { service, log, secret };
  };

  it('is off by default, and off when a needed setting is missing', async () => {
    expect(await make(settingsSchema.parse({})).service.tracker(ANONYMOUS)).toEqual({
      enabled: false,
    });
    expect(await make({ ...on, url: undefined }).service.tracker(ANONYMOUS)).toEqual({
      enabled: false,
    });
    expect(await make({ ...on, siteId: undefined }).service.tracker(ANONYMOUS)).toEqual({
      enabled: false,
    });
  });

  it('gives anybody the address with a trailing slash, the site and the flags, and no user id', async () => {
    const { service, secret } = make(on, 'the-key');
    const expected = {
      enabled: true,
      url: 'https://stats.example.org/',
      siteId: 7,
      cookieless: true,
      respectDoNotTrack: true,
    };
    expect(await service.tracker(ANONYMOUS)).toEqual(expected);
    expect(await service.tracker(user('u1'))).toEqual(expected);
    expect(secret).not.toHaveBeenCalled();
  });

  it('gives a signed-in caller their pseudonymous id with the option on, and an anonymous one none', async () => {
    const { service } = make({ ...on, pseudonymousUserId: true }, 'the-key');
    expect(await service.tracker(user('u1'))).toMatchObject({
      userId: pseudonymousId('the-key', 'u1'),
    });
    expect(await service.tracker(ANONYMOUS)).not.toHaveProperty('userId');
  });

  it('gives no id when the secret is missing, and says so once, without a value', async () => {
    const { service, log } = make({ ...on, pseudonymousUserId: true });
    expect(await service.tracker(user('u1'))).not.toHaveProperty('userId');
    expect(await service.tracker(user('u2'))).not.toHaveProperty('userId');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/u1|u2/);
  });
});
