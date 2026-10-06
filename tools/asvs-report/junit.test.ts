import { describe, expect, it } from 'vitest';
import { collectTags, parseJunit, tagsIn } from './junit.ts';

const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="a.test.ts">
    <testcase classname="a.test.ts" name="passes [ASVS-6.2.1]" time="0.1"></testcase>
    <testcase classname="a.test.ts" name="selfclosing [ASVS-6.2.2]" time="0.1"/>
    <testcase classname="a.test.ts" name="fails [ASVS-6.2.3]" time="0.1"><failure message="boom">x</failure></testcase>
    <testcase classname="a.test.ts" name="errors [ASVS-6.2.4]" time="0.1"><error message="boom"/></testcase>
    <testcase classname="a.test.ts" name="skipped [ASVS-6.2.5]" time="0.1"><skipped/></testcase>
    <testcase classname="a.test.ts" name="both &quot;quoted&quot; &amp; [ASVS-6.2.6] [ASVS-6.2.7]" time="0.1"/>
    <testcase classname="a.test.ts" name="same tag, other test [ASVS-6.2.3]" time="0.1"/>
  </testsuite>
</testsuites>`;

describe('parseJunit', () => {
  it('reads the outcome of every test case and decodes entities', () => {
    expect(parseJunit(xml).map((c) => [c.name, c.outcome])).toEqual([
      ['passes [ASVS-6.2.1]', 'passed'],
      ['selfclosing [ASVS-6.2.2]', 'passed'],
      ['fails [ASVS-6.2.3]', 'failed'],
      ['errors [ASVS-6.2.4]', 'failed'],
      ['skipped [ASVS-6.2.5]', 'skipped'],
      ['both "quoted" & [ASVS-6.2.6] [ASVS-6.2.7]', 'passed'],
      ['same tag, other test [ASVS-6.2.3]', 'passed'],
    ]);
  });

  it('finds nothing in an empty report', () => {
    expect(parseJunit('<testsuites></testsuites>')).toEqual([]);
  });
});

describe('collectTags', () => {
  const tags = collectTags(parseJunit(xml));

  it('counts a tag as passed only for a passed test', () => {
    expect([...tags.passed].sort()).toEqual(['6.2.1', '6.2.2', '6.2.3', '6.2.6', '6.2.7']);
  });

  it('remembers a tag that a failing test carries, even when another test with it passed', () => {
    expect([...tags.failed].sort()).toEqual(['6.2.3', '6.2.4']);
  });

  it('does not count a skipped test', () => {
    expect(tags.passed.has('6.2.5')).toBe(false);
    expect(tags.failed.has('6.2.5')).toBe(false);
  });
});

describe('tagsIn', () => {
  it.each([
    ['no tag', []],
    ['one [ASVS-10.2.1]', ['10.2.1']],
    ['two [ASVS-7.2.2] [ASVS-7.2.3]', ['7.2.2', '7.2.3']],
    ['ASVS-7.2.2 without brackets', []],
    ['[ASVS-7.2] too short', []],
  ])('%s', (name, expected) => {
    expect(tagsIn(name)).toEqual(expected);
  });
});
