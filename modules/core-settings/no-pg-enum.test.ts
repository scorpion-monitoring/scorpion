// CLAUDE.md rule 8: stages, categories, necessity levels, sender types and aggregates are
// vocabularies (data), never a pg enum. This fails on any `pgEnum(...)` in a Drizzle schema and on
// any `CREATE TYPE ... AS ENUM` in a migration or a schema file of the repository, in every module
// and in the kernel. A new enum has to be a vocabulary in core.settings.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..');
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  '.svelte-kit',
  '.git',
  'coverage',
  '.code-review-graph',
]);

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else found.push(path);
  }
  return found;
}

export const PG_ENUM = /\bpgEnum\s*\(|\bAS\s+ENUM\b|\bCREATE\s+TYPE\b[^;]*\bENUM\b/i;

/** The schema and migration files of every package: where an enum could be declared. */
const candidates = () =>
  ['apps', 'modules', 'packages', 'tools']
    .flatMap((root) => files(join(repo, root)))
    .filter(
      (path) =>
        (path.endsWith('.sql') && path.includes('migrations')) ||
        (/(^|\/)schema\.ts$/.test(path) && path.includes('/db/')),
    );

describe('no pg enum anywhere (CLAUDE.md rule 8)', () => {
  it('finds the schema and migration files it is supposed to scan', () => {
    const found = candidates().map((path) => relative(repo, path));
    expect(found).toContain('modules/core-settings/db/schema.ts');
    expect(found).toContain('modules/core-settings/migrations/0001_vocabularies.sql');
    expect(found.some((path) => path.startsWith('packages/kernel/'))).toBe(true);
    expect(found.length).toBeGreaterThan(15);
  });

  it.each([
    ['a drizzle enum', "export const stage = pgEnum('stage', ['DEV', 'PROD']);"],
    ['a drizzle enum with a line break', "pgEnum\n('stage', ['DEV'])"],
    ['a create type', 'CREATE TYPE "public"."stage" AS ENUM(\'DEV\', \'PROD\');'],
    ['lower case', "create type necessity as enum ('mandatory');"],
    ['an alter', "ALTER TYPE stage ADD VALUE 'TERM'; CREATE TYPE s AS ENUM ('a');"],
  ])('the pattern catches %s', (_name, source) => {
    expect(PG_ENUM.test(source)).toBe(true);
  });

  it.each([
    ['a vocabulary table', 'CREATE TABLE "settings_vocabulary_term" ("key" text);'],
    [
      'a text column that mentions the word',
      '"description" text DEFAULT \'an enumeration of terms\'',
    ],
  ])('the pattern ignores %s', (_name, source) => {
    expect(PG_ENUM.test(source)).toBe(false);
  });

  it('finds no pg enum in any schema or migration', () => {
    const offenders = candidates()
      .filter((path) => PG_ENUM.test(readFileSync(path, 'utf8')))
      .map((path) => relative(repo, path));
    expect(offenders, 'use a vocabulary of core.settings instead of a pg enum').toEqual([]);
  });
});
