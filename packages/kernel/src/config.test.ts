import { describe, expect, it } from 'vitest';
import { KernelStartupError } from './errors.ts';
import { loadConfig, mountPath } from './config.ts';

const base = { DATABASE_URL: 'postgres://scorpion:s3cret-pw@localhost:5432/scorpion' };

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof KernelStartupError) return error.problems;
    throw error;
  }
  throw new Error('expected loadConfig to fail');
}

describe('loadConfig', () => {
  it('applies the defaults', () => {
    expect(loadConfig(base)).toEqual({
      ...base,
      PROFILE: 'full',
      PORT: 3000,
      BASE_PATH: '/',
      LOG_LEVEL: 'info',
      WORKER_MODE: 'inline',
      ORIGIN: 'http://localhost:3000',
    });
  });

  it('reads every variable', () => {
    expect(
      loadConfig({
        ...base,
        PROFILE: 'kpi-tracker',
        PORT: '8080',
        BASE_PATH: '/a/b',
        LOG_LEVEL: 'debug',
        WORKER_MODE: 'separate',
        ORIGIN: 'https://scorpion.example.org',
      }),
    ).toEqual({
      ...base,
      PROFILE: 'kpi-tracker',
      PORT: 8080,
      BASE_PATH: '/a/b',
      LOG_LEVEL: 'debug',
      WORKER_MODE: 'separate',
      ORIGIN: 'https://scorpion.example.org',
    });
  });

  it('takes the default ORIGIN from the port', () => {
    expect(loadConfig({ ...base, PORT: '4000' }).ORIGIN).toBe('http://localhost:4000');
  });

  it('treats an empty variable as not set', () => {
    const config = loadConfig({ ...base, PORT: '', WORKER_MODE: '', BASE_PATH: '' });
    expect(config).toMatchObject({ PORT: 3000, WORKER_MODE: 'inline', BASE_PATH: '/' });
  });

  it('ignores variables it does not know', () => {
    expect(() => loadConfig({ ...base, PATH: '/usr/bin', HOME: '/root' })).not.toThrow();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(loadConfig(base))).toBe(true);
  });

  const invalid: [string, Record<string, string>, string][] = [
    ['a missing DATABASE_URL', {}, 'DATABASE_URL: Invalid input'],
    [
      'a DATABASE_URL that is not postgres',
      { DATABASE_URL: 'mysql://x/y' },
      'DATABASE_URL: must be a postgres:// or postgresql:// URL',
    ],
    ['a text PORT', { ...base, PORT: 'http' }, 'PORT: must be a whole number'],
    ['PORT 0', { ...base, PORT: '0' }, 'PORT: '],
    ['PORT 70000', { ...base, PORT: '70000' }, 'PORT: '],
    [
      'a BASE_PATH without a leading slash',
      { ...base, BASE_PATH: 'a/b' },
      'BASE_PATH: must be "/" or a path',
    ],
    [
      'a BASE_PATH with a trailing slash',
      { ...base, BASE_PATH: '/a/b/' },
      'BASE_PATH: must be "/" or a path',
    ],
    [
      'a BASE_PATH with an empty segment',
      { ...base, BASE_PATH: '/a//b' },
      'BASE_PATH: must be "/" or a path',
    ],
    ['an unknown LOG_LEVEL', { ...base, LOG_LEVEL: 'loud' }, 'LOG_LEVEL: '],
    ['an unknown WORKER_MODE', { ...base, WORKER_MODE: 'both' }, 'WORKER_MODE: '],
    [
      'an ORIGIN with a path',
      { ...base, ORIGIN: 'https://x.org/app' },
      'ORIGIN: must be an origin',
    ],
    [
      'an ORIGIN with a trailing slash',
      { ...base, ORIGIN: 'https://x.org/' },
      'ORIGIN: must be an origin',
    ],
    [
      'an ORIGIN that is not http(s)',
      { ...base, ORIGIN: 'ftp://x.org' },
      'ORIGIN: must be an origin',
    ],
    ['a PROFILE with capitals', { ...base, PROFILE: 'Full' }, 'PROFILE: must be a profile name'],
  ];

  it.each(invalid)('rejects %s', (_name, env, expected) => {
    expect(problemsOf(env).join('\n')).toContain(expected);
  });

  it('lists every problem at once', () => {
    const problems = problemsOf({ PORT: 'x', WORKER_MODE: 'both', LOG_LEVEL: 'loud' });
    expect(problems.map((p) => p.split(':')[0]).sort()).toEqual([
      'DATABASE_URL',
      'LOG_LEVEL',
      'PORT',
      'WORKER_MODE',
    ]);
  });

  it('never echoes a value, so a password in DATABASE_URL cannot leak into the message', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://scorpion:s3cret-pw@localhost/x', PORT: 'oops-secret' });
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cret-pw');
      expect((error as Error).message).not.toContain('oops-secret');
      return;
    }
    throw new Error('expected loadConfig to fail');
  });
});

describe('mountPath', () => {
  it.each([
    ['/', ''],
    ['/scorpion', '/scorpion'],
    ['/a/b', '/a/b'],
  ])('%s → "%s"', (basePath, expected) => {
    expect(mountPath({ BASE_PATH: basePath })).toBe(expected);
  });
});
