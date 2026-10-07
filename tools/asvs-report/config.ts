// What the tool assesses and where things live. The requirement ids themselves come from the pinned
// source file, never from here (docs/implementation.md §8.1, §8.2).

export const ASVS_VERSION = '5.0.0';
export const ASVS_LEVEL = 2;

export interface ChapterConfig {
  /** The chapter shortcode in the source file, `V6`. */
  chapter: string;
  /** The chapter number, the first part of a requirement id `6.2.1`. */
  number: number;
  /** The file stem under `docs/security/asvs/`. */
  slug: string;
  /** The chapter name as the source file spells it; checked against the source. */
  name: string;
  /** The name in the badge, as docs/implementation.md §8.5 shows it. */
  badgeName: string;
}

export const CHAPTERS: readonly ChapterConfig[] = [
  {
    chapter: 'V6',
    number: 6,
    slug: 'v6-authentication',
    name: 'Authentication',
    badgeName: 'V6 Authentication',
  },
  {
    chapter: 'V7',
    number: 7,
    slug: 'v7-session-management',
    name: 'Session Management',
    badgeName: 'V7 Session Management',
  },
  {
    chapter: 'V8',
    number: 8,
    slug: 'v8-authorization',
    name: 'Authorization',
    badgeName: 'V8 Authorization',
  },
  {
    chapter: 'V10',
    number: 10,
    slug: 'v10-oauth-oidc',
    name: 'OAuth and OIDC',
    badgeName: 'V10 OIDC client',
  },
];

/** The repository the Scorecard badge and the issue links refer to. */
export const REPOSITORY = { org: 'scorpion-monitoring', repo: 'scorpion' };

/** The project on bestpractices.dev (registered, in progress). */
export const BEST_PRACTICES_ID = 15237;

export const PATHS = {
  assessmentDir: 'docs/security/asvs',
  source: 'docs/security/asvs/source/OWASP_ASVS_5.0.0_en.json',
  sourceReadme: 'docs/security/asvs/source/README.md',
  readme: 'README.md',
  reportsDir: 'reports',
  vitestReport: 'reports/vitest-junit.xml',
  playwrightReport: 'reports/playwright-junit.xml',
} as const;

export const BADGE_START = '<!-- security-badges:start -->';
export const BADGE_END = '<!-- security-badges:end -->';

/** `pnpm security:asvs` writes `<slug>.yaml` by hand and `<slug>.md` by tool. */
export const yamlPath = (c: ChapterConfig) => `${PATHS.assessmentDir}/${c.slug}.yaml`;
export const reportPath = (c: ChapterConfig) => `${PATHS.assessmentDir}/${c.slug}.md`;
