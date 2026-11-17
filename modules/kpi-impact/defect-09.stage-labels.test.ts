// Defect 9 of FEATURES §5: the legacy impact page counted `TERM` although it was not in its enum, and the stage labels differed between screens.
// Here the stage lines come from the vocabulary `stage`: a deactivated term is still counted under its own label, a key the vocabulary lacks is
// shown by its key, every active term is listed at zero, and the label is the vocabulary's. Never weaken or delete this test.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useImpact } from './test/harness.ts';
import { uniq } from './test/world.ts';

const h = useImpact();

async function setup() {
  const s = await h.start();
  const reviewer = await s.actor('reviewer');
  const admin = await s.actor('admin');
  const consortium = await makeOrganisation(s.pool, { type: 'consortium', name: uniq('Cons') });
  const stage = async (key: string, count: number) => {
    for (let i = 0; i < count; i++)
      await makeService(s.pool, { public: true, stage: key, consortia: [consortium.id] });
  };
  const summary = (locale?: string) =>
    s.impact.summary(reviewer, { consortium: consortium.id, locale });
  return { ...s, reviewer, admin, consortium, stage, summary };
}

const key = () =>
  uniq('S')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

describe('defect 9: the stage counts and their labels come from the vocabulary', () => {
  it('defect-09: counts a service of a deactivated term under that term, with the vocabulary label and active false', async () => {
    const s = await setup();
    const retired = key();
    await s.settings.vocabularies.createTerm(s.admin, 'stage', {
      key: retired,
      labels: { en: 'Retired stage' },
    });
    await s.stage(retired, 2);
    await s.settings.vocabularies.updateTerm(s.admin, 'stage', retired, { active: false });
    const line = (await s.summary()).stages.find((l) => l.key === retired);
    expect(line).toEqual({ key: retired, label: 'Retired stage', active: false, count: 2 });
  });

  it('defect-09: counts the built-in terminated stage, the one the legacy enum lacked, under its own line', async () => {
    const s = await setup();
    await s.stage('TERM', 1);
    const tiles = await s.summary();
    expect(tiles.stages.find((l) => l.key === 'TERM')).toMatchObject({
      label: 'Terminated',
      active: true,
      count: 1,
    });
    expect(tiles.otherStages).toEqual([]);
  });

  it('defect-09: shows a stage key the vocabulary does not list in otherStages by its key, never dropped and never under another name', async () => {
    const s = await setup();
    const ghost = key();
    await s.stage(ghost, 3);
    await s.stage('PROD', 1);
    const tiles = await s.summary();
    expect(tiles.otherStages).toEqual([{ key: ghost, count: 3 }]);
    expect(tiles.stages.map((l) => l.key)).not.toContain(ghost);
    expect(tiles.stages.reduce((sum, l) => sum + l.count, 0) + 3).toBe(tiles.total);
  });

  it('defect-09: lists every active term, at zero too, in the vocabulary order', async () => {
    const s = await setup();
    const listed = (await s.summary()).stages;
    const terms = await s.settings.listTerms('stage', { includeInactive: true });
    expect(listed.map((l) => l.key)).toEqual(terms.map((t) => t.key));
    expect(listed.every((l) => l.count === 0)).toBe(true);
    expect(listed.filter((l) => l.active).length).toBe(terms.filter((t) => t.active).length);
  });

  it('defect-09: changes the label a screen shows when the vocabulary label changes, and follows the caller’s language', async () => {
    const s = await setup();
    const custom = key();
    await s.settings.vocabularies.createTerm(s.admin, 'stage', {
      key: custom,
      labels: { en: 'First name', de: 'Erster Name' },
    });
    const label = async (locale?: string) =>
      (await s.summary(locale)).stages.find((l) => l.key === custom)?.label;
    expect(await label()).toBe('First name');
    expect(await label('de')).toBe('Erster Name');
    await s.settings.vocabularies.updateTerm(s.admin, 'stage', custom, {
      labels: { en: 'Second name', de: 'Zweiter Name' },
    });
    expect(await label()).toBe('Second name');
    expect(await label('de')).toBe('Zweiter Name');
  });

  it('defect-09: has no stage literal and no pg enum in the module source', () => {
    const root = import.meta.dirname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        if (entry.isDirectory()) walk(join(dir, entry.name));
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name))
          files.push(join(dir, entry.name));
      }
    };
    walk(root);
    // The harness and the helpers of the tests are not module source.
    const source = files.filter((file) => !file.includes(`${join(root, 'test')}`));
    expect(source.length).toBeGreaterThan(3);
    for (const file of source) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/['"`](DEV|DEMO|PROD|TERM)['"`]/);
      expect(text, file).not.toMatch(/pgEnum/);
    }
  });
});
