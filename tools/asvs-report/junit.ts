// Reads JUnit reports (Vitest, Playwright) for the evidence rule: a tag counts only if a test carrying it passed.
// The two reporters write plain, regular XML, so a small scanner is enough and no XML dependency is needed.

export interface TestCase {
  name: string;
  outcome: 'passed' | 'failed' | 'skipped';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? whole;
  });
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match?.[1] === undefined ? undefined : decode(match[1]);
}

/** Every `<testcase>` with its outcome. A case with a `failure` or `error` child failed, one with `skipped` was skipped. */
export function parseJunit(xml: string): TestCase[] {
  const cases: TestCase[] = [];
  const open = /<testcase\b([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml)) !== null) {
    const name = attribute(match[1] ?? '', 'name');
    if (name === undefined) continue;
    let outcome: TestCase['outcome'] = 'passed';
    if (match[2] !== '/') {
      const end = xml.indexOf('</testcase>', open.lastIndex);
      const inner = xml.slice(open.lastIndex, end === -1 ? undefined : end);
      if (/<(failure|error)\b/.test(inner)) outcome = 'failed';
      else if (/<skipped\b/.test(inner)) outcome = 'skipped';
    }
    cases.push({ name, outcome });
  }
  return cases;
}

/** The ASVS numbers tagged in a test title, from `[ASVS-6.2.1]`. */
export function tagsIn(name: string): string[] {
  return [...name.matchAll(/\[ASVS-(\d+\.\d+\.\d+)\]/g)].map((m) => m[1]!);
}

/** What the reports say about each tag. */
export interface TagResults {
  passed: Set<string>;
  failed: Set<string>;
}

export function collectTags(cases: readonly TestCase[]): TagResults {
  const result: TagResults = { passed: new Set(), failed: new Set() };
  for (const { name, outcome } of cases) {
    for (const tag of tagsIn(name)) {
      if (outcome === 'passed') result.passed.add(tag);
      else if (outcome === 'failed') result.failed.add(tag);
    }
  }
  return result;
}
