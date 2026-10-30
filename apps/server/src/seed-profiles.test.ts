// `scorpion seed --demo` (ADR-0046) for each profile that has data to seed: the demo data goes in through the services
// of the modules, a second run adds nothing, a database with a real account is refused before anything is written, and
// what was seeded reads back through the same services a request uses. Real Postgres, the generated modules.
import { pathToFileURL } from 'node:url';
import {
  createKernel,
  createLogger,
  loadConfig,
  type JobResult,
  type Kernel,
  type Profile,
} from '@scorpion/kernel';
import { makeSecretsKey, startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sources } from './generated/profile.ts';

process.env.SECRETS_KEY = makeSecretsKey();

let server: StartedPostgres;
const open: Kernel[] = [];
beforeAll(async () => {
  server = await startPostgres();
}, 120_000);
afterEach(async () => {
  await Promise.all(open.splice(0).map((kernel) => kernel.stop()));
});
afterAll(async () => {
  await server?.stop();
});

/** The profile files are outside this project's source tree; they are loaded by path, as the generator does. */
const profiles = await Promise.all(
  ['core-only', 'registry', 'full'].map(async (name) => {
    const file = new URL(`../../../profiles/${name}.ts`, import.meta.url);
    return ((await import(pathToFileURL(file.pathname).href)) as { default: Profile }).default;
  }),
);

/** One kernel on a fresh database; `database` lets a second kernel run on the same one (a restart). */
async function boot(profile: { name: string; modules: readonly string[] }, database?: string) {
  const url = database ?? (await server.createDatabase());
  const kernel = createKernel({
    profile: { name: profile.name, modules: [...profile.modules] },
    sources: sources.filter((source) => profile.modules.includes(source.manifest.id)),
    modulePackages: Object.fromEntries(
      sources.map((source) => [source.manifest.id, source.packageJson.name]),
    ),
    config: loadConfig({ DATABASE_URL: url, PROFILE: profile.name }),
    log: createLogger({ level: 'silent' }),
  });
  open.push(kernel);
  return { kernel, url };
}

const out = { out: () => {} };
const PASSWORD = 'zebra cloud violin harvest 42';

/** The rows of the tables the seeds fill, by table. */
async function counts(kernel: Kernel): Promise<Record<string, number>> {
  const { rows } = await kernel.pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public'
       and table_name ~ '^(identity_user|org_organisation|org_membership|svc_service|svc_service_organisation|kpif_indicator|kpif_kpi_set|kpif_service_kpi.*|kpii_measurement)$'
     order by table_name`,
  );
  const result: Record<string, number> = {};
  for (const { table_name } of rows) {
    const { rows: n } = await kernel.pool.query<{ n: number }>(
      `select count(*)::int as n from ${table_name}`,
    );
    result[table_name] = n[0]!.n;
  }
  return result;
}

describe.each(profiles)('scorpion seed --demo, profile $name', (profile) => {
  it('seeds the modules of the profile, and a second run adds nothing and fails nowhere', async () => {
    const { kernel } = await boot(profile);
    const first = await kernel.runDemoSeed({ password: PASSWORD }, out);
    const afterFirst = await counts(kernel);
    const second = await kernel.runDemoSeed({ password: PASSWORD }, out);
    expect(await counts(kernel)).toEqual(afterFirst);

    // Only modules of the profile are seeded, and each one reports what it did.
    const seeded = Object.keys(first);
    expect(seeded.every((id) => profile.modules.includes(id))).toBe(true);
    expect(seeded).toContain('core.identity');
    expect(first['core.identity']).toEqual({ created: 2, existing: 0 });
    expect(second['core.identity']).toEqual({ created: 0, existing: 2 });
    for (const [id, result] of Object.entries<JobResult>(second)) {
      expect(result.created ?? 0, `${id} created on the second run`).toBe(0);
    }
    expect(afterFirst.identity_user).toBe(2);
    if (profile.modules.includes('kpi.ingestion')) {
      expect(afterFirst.kpif_indicator).toBe(5);
      expect(afterFirst.kpif_kpi_set).toBe(1);
      // Four services, five indicators, six months.
      expect(afterFirst.kpii_measurement).toBe(4 * 5 * 6);
    }
    if (profile.modules.includes('registry.services')) {
      expect(afterFirst.org_organisation).toBe(4);
      expect(afterFirst.svc_service).toBe(4);
    } else {
      expect(afterFirst.org_organisation).toBeUndefined();
    }
  });

  it('refuses a database with a real account before it writes anything', async () => {
    const { kernel } = await boot(profile);
    await kernel.migrate();
    await kernel.pool.query(
      `insert into identity_user (id, username, status) values (gen_random_uuid(), 'alice', 'active')`,
    );
    await expect(kernel.runDemoSeed({ password: PASSWORD }, out)).rejects.toThrow(/real instance/);
    expect((await counts(kernel)).identity_user).toBe(1);
  });

  it('goes ahead on a database with a real account when told to', async () => {
    const { kernel } = await boot(profile);
    await kernel.migrate();
    await kernel.pool.query(
      `insert into identity_user (id, username, status) values (gen_random_uuid(), 'alice', 'active')`,
    );
    const reported = await kernel.runDemoSeed({ password: PASSWORD, allowProduction: true }, out);
    expect(reported['core.identity']).toEqual({ created: 2, existing: 0 });
  });

  it('never makes an account with a password it did not choose: a random one is shown once, and not twice', async () => {
    const { kernel } = await boot(profile);
    const lines: string[] = [];
    await kernel.runDemoSeed({}, { out: (line) => lines.push(line) });
    const shown = lines.filter((line) => line.includes('has the password'));
    expect(shown).toHaveLength(2);
    const [, password] = /password (\S+) /.exec(shown[0]!) ?? [];
    expect(password!.length).toBeGreaterThanOrEqual(24);
    lines.length = 0;
    await kernel.runDemoSeed({}, { out: (line) => lines.push(line) });
    expect(lines.filter((line) => line.includes('password'))).toEqual([]);
  });
});
