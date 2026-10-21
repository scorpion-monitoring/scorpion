// The manifest of kpi.analytics: no table, the registries and what stops the start, the permission and the layers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineModule } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
import { AGGREGATE_AVERAGE, SCORE_VOLATILITY } from './service/registries.ts';
import { useAnalytics, type FixtureModule } from './test/harness.ts';
import { analyticsWorld, uniq } from './test/world.ts';

const h = useAnalytics();

/** A module next to kpi.analytics that contributes entries to one of its registries. */
function contributor(registry: string, entries: unknown[]): FixtureModule {
  const id = uniq('fixture.contrib').replace(/[^a-z.]/g, '');
  return {
    manifest: defineModule({ id, version: '0.0.0', contributes: { [registry]: entries } }) as never,
    packageJson: {
      name: `@scorpion/${id.replace('.', '-')}`,
      dependencies: { '@scorpion/kpi-analytics': 'workspace:*' },
    },
  };
}
const aggregate = (id: string) => ({ id, labels: { en: id }, apply: () => 1 });
const score = (id: string) => ({
  id,
  labels: { en: id },
  compute: () => ({ value: 1, band: null }),
});

describe('the manifest', () => {
  it('has no table and no table prefix', async () => {
    expect(manifest.id).toBe('kpi.analytics');
    expect(manifest.tablePrefix).toBeUndefined();
    expect(manifest.schema).toBeUndefined();
    expect(manifest.migrations).toBeUndefined();
    const w = await analyticsWorld(await h.start());
    const { rows } = await w.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and (table_name like 'kpia\\_%' or table_name like 'kpi\\_analytics%')",
    );
    expect(rows).toEqual([]);
  });

  it('gives the role user the plain permission, and no other', async () => {
    const w = await analyticsWorld(await h.start());
    const { rows } = await w.pool.query<{ role: string; permission: string }>(
      "select role_id as role, permission from authz_role_permission where permission like 'kpi.analytics.%' order by 1, 2",
    );
    expect(rows.map((row) => row.permission)).toEqual(['kpi.analytics.read']);
  });

  it('maps every term of the vocabulary `aggregate` to a function, and has the average and the volatility it shows', async () => {
    const w = await analyticsWorld(await h.start());
    const registered = new Set(['sum', 'avg', 'min', 'max']);
    for (const term of await w.settings.listTerms('aggregate'))
      expect(registered, term.key).toContain(term.key);
    expect(AGGREGATE_AVERAGE).toBe('avg');
    expect(SCORE_VOLATILITY).toBe('volatility');
  });
});

describe('the registries', () => {
  it('start with a new aggregate and a new score contributed by another module', async () => {
    const withAggregate = contributor('analytics.aggregate', [aggregate('median')]);
    const withScore = contributor('analytics.score', [score('trend')]);
    const w = await analyticsWorld(await h.start({ extra: [withAggregate, withScore] }));
    expect(w.kernel).toBeDefined();
  });

  it('stop the start when two aggregates, or two scores, have one id', async () => {
    await expect(
      h.start({ extra: [contributor('analytics.aggregate', [aggregate('sum')])] }),
    ).rejects.toThrow(/two aggregate entries have the id "sum"/);
    await expect(
      h.start({ extra: [contributor('analytics.score', [score('volatility')])] }),
    ).rejects.toThrow(/two score entries have the id "volatility"/);
    await expect(
      h.start({
        extra: [contributor('analytics.aggregate', [aggregate('twice'), aggregate('twice')])],
      }),
    ).rejects.toThrow(/id "twice"/);
  });

  it('stop the start for an entry that is not valid, naming the module', async () => {
    const bad = contributor('analytics.aggregate', [
      { id: 'Bad Id', labels: { en: 'x' }, apply: 'not a function' },
    ]);
    await expect(h.start({ extra: [bad] })).rejects.toThrow(String(bad.manifest.id));
  });
});

describe('the layers', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (name === 'node_modules' || name === 'dist' || name === 'test') return [];
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? walk(path)
        : path.endsWith('.ts') && !path.endsWith('.test.ts')
          ? [path]
          : [];
    });

  it('reads no table: no module code imports a database library or another module but through its public.ts', () => {
    for (const file of walk(import.meta.dirname)) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(
        /from 'drizzle-orm|from 'pg'|\.db\.(select|insert|update|delete|execute)\(/,
      );
      for (const match of source.matchAll(/from '(@scorpion\/[a-z-]+)(\/[a-z-]+)?'/g)) {
        const [, name, sub] = match;
        if (name === '@scorpion/contracts' || name === '@scorpion/kernel') continue;
        expect(sub, `${file}: ${match[0]}`).toBe('/public');
      }
    }
  });

  it('has no route that is not behind a permission', async () => {
    const w = await analyticsWorld(await h.start());
    const routes = w.kernel.routes.filter((entry) => entry.route.path.startsWith('/kpi/analytics'));
    expect(
      routes.map((entry) => `${entry.route.method.toUpperCase()} ${entry.route.path}`).sort(),
    ).toEqual(['GET /kpi/analytics/series', 'GET /kpi/analytics/summary']);
    for (const entry of routes) {
      expect(entry.route.public).toBeFalsy();
      expect(entry.route.permission).toBe('kpi.analytics.read');
    }
  });
});
