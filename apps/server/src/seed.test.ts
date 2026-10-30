import { DemoSeedRefused, loadConfig, type CommandIo } from '@scorpion/kernel';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeOptions } from './runtime.ts';
import { productionOriginProblem, seedCommand } from './seed.ts';

const config = (ORIGIN: string) => loadConfig({ DATABASE_URL: 'postgres://x/y', ORIGIN });

describe('productionOriginProblem', () => {
  it.each([
    ['production on a public host', 'https://scorpion.nbi.example.de', 'production', true],
    ['production on localhost', 'http://localhost:3000', 'production', false],
    ['production on a reserved domain', 'https://demo.example.org', 'production', false],
    ['production on .invalid', 'https://scorpion.invalid', 'production', false],
    ['development on a public host', 'https://scorpion.nbi.example.de', 'development', false],
    ['no NODE_ENV on a public host', 'https://scorpion.nbi.example.de', undefined, false],
  ])('%s', (_name, origin, env, refused) => {
    expect(productionOriginProblem(config(origin), { NODE_ENV: env }) !== undefined).toBe(refused);
  });
});

function setup(origin = 'http://localhost:3000') {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIo = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    readSecret: () => Promise.reject(new Error('no secret is read')),
  };
  const options = {
    config: config(origin),
    profile: { name: 'registry', modules: [] },
  } as unknown as RuntimeOptions & { config: ReturnType<typeof config> };
  const run = vi.fn().mockResolvedValue({ 'core.identity': { created: 2, existing: 0 } });
  return { out, err, io, options, run };
}

describe('seedCommand', () => {
  it('refuses to run without --demo, and says only demo data exists', async () => {
    const s = setup();
    expect(await seedCommand({ options: s.options, args: [], io: s.io, env: {}, run: s.run })).toBe(
      2,
    );
    expect(s.err.join('')).toMatch(/Only demo data exists/);
    expect(s.run).not.toHaveBeenCalled();
  });

  it('refuses an unknown flag and a profile that is not the one this build is', async () => {
    const a = setup();
    expect(
      await seedCommand({
        options: a.options,
        args: ['--demo', '--x'],
        io: a.io,
        env: {},
        run: a.run,
      }),
    ).toBe(2);
    const b = setup();
    expect(
      await seedCommand({
        options: b.options,
        args: ['--demo', '--profile', 'full'],
        io: b.io,
        env: {},
        run: b.run,
      }),
    ).toBe(2);
    expect(b.err.join('')).toMatch(/profile "registry", not "full"/);
    expect(b.run).not.toHaveBeenCalled();
  });

  it('seeds, names the profile and prints what each module reported', async () => {
    const s = setup();
    const code = await seedCommand({
      options: s.options,
      args: ['--demo', '--profile', 'registry'],
      io: s.io,
      env: { SCORPION_DEMO_PASSWORD: 'chosen by the operator' },
      run: s.run,
    });
    expect(code).toBe(0);
    expect(s.run).toHaveBeenCalledWith(
      s.options,
      { password: 'chosen by the operator', allowProduction: false },
      s.io,
    );
    expect(s.out.join('\n')).toContain('Demo data for the profile "registry"');
    expect(s.out.join('\n')).toContain('core.identity: 2 created, 0 existing');
  });

  it('refuses a production build on a public address unless --allow-production is given', async () => {
    const s = setup('https://scorpion.nbi.example.de');
    const env = { NODE_ENV: 'production' };
    expect(
      await seedCommand({ options: s.options, args: ['--demo'], io: s.io, env, run: s.run }),
    ).toBe(1);
    expect(s.err.join('')).toMatch(/public address/);
    expect(s.run).not.toHaveBeenCalled();
    expect(
      await seedCommand({
        options: s.options,
        args: ['--demo', '--allow-production'],
        io: s.io,
        env,
        run: s.run,
      }),
    ).toBe(0);
    expect(s.run).toHaveBeenCalledWith(
      s.options,
      { password: undefined, allowProduction: true },
      s.io,
    );
  });

  it('turns a refusal of a module into exit code 1 with its message', async () => {
    const s = setup();
    s.run.mockRejectedValue(
      new DemoSeedRefused('the database holds 1 account(s) that are not demo accounts'),
    );
    expect(
      await seedCommand({ options: s.options, args: ['--demo'], io: s.io, env: {}, run: s.run }),
    ).toBe(1);
    expect(s.err.join('')).toMatch(/Refused: the database holds 1 account/);
  });
});
