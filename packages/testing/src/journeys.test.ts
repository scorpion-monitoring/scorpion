import { describe, expect, it } from 'vitest';
import { parseJourney, stepTitleProblem } from './journeys.ts';

const good = `
import { test } from '../support/fixtures.ts';
test.describe('J06: Create a service with the wizard', () => {
  test('a member creates a service', async ({ page }) => {
    await test.step('Open the wizard from the catalogue', async () => {});
    await test.step("Enter the member's short name", async () => {});
    await test.step(\`Choose a licence\`, async () => {});
  });
  test('another', async () => {});
});
`;

describe('parseJourney', () => {
  it('reads the id, slug, title, steps in order and the number of tests', () => {
    expect(parseJourney('j06-create-service.spec.ts', good)).toEqual({
      id: 'j06',
      slug: 'create-service',
      file: 'j06-create-service.spec.ts',
      title: 'Create a service with the wizard',
      steps: [
        'Open the wizard from the catalogue',
        "Enter the member's short name",
        'Choose a licence',
      ],
      tests: 2,
      problems: [],
    });
  });

  it.each([
    ['a file name that is not jNN-slug', 'register.spec.ts', good, /file name/],
    [
      'a spec with no step',
      'j01-a.spec.ts',
      "test.describe('J01: A', () => { test('x', () => {}); });",
      /no test\.step/,
    ],
    [
      'a step title from a variable',
      'j01-a.spec.ts',
      "test.describe('J01: A', () => { test.step(name, async () => {}); });",
      /not a plain string/,
    ],
    [
      'a heading with another id',
      'j02-a.spec.ts',
      good.replace('J06', 'J07'),
      /must start with "J02: "/,
    ],
    [
      'a step that ends with a full stop',
      'j06-a.spec.ts',
      good.replace('Choose a licence', 'Choose a licence.'),
      /ends with punctuation/,
    ],
    [
      'a step that starts in lower case',
      'j06-a.spec.ts',
      good.replace('Choose a licence', 'choose a licence'),
      /capital letter/,
    ],
  ])('reports %s', (_name, file, source, problem) => {
    expect(parseJourney(file, source).problems.join('\n')).toMatch(problem);
  });
});

describe('stepTitleProblem', () => {
  it.each([
    ['Open the wizard', undefined],
    ['', 'empty'],
    [' Open the wizard', 'spaces'],
    ['Open the wizard.', 'punctuation'],
    ['open the wizard', 'capital'],
    ['Open ${what}', 'built from a value'],
    ['X'.repeat(121), 'longer'],
  ])('%s', (title, problem) => {
    const found = stepTitleProblem(title);
    if (problem === undefined) expect(found).toBeUndefined();
    else expect(found).toContain(problem);
  });
});
