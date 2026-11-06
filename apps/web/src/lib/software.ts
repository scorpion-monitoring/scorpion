// The software's own identity, shown in the footer. It is NOT instance branding (CLAUDE.md rule 9, amended by ADR-0050):
// no setting changes it, and an operator cannot remove it. The version is read from the root package at build time.
declare const __SCORPION_VERSION__: string | undefined;

export const SOFTWARE = {
  name: 'Scorpion',
  version: typeof __SCORPION_VERSION__ === 'string' ? __SCORPION_VERSION__ : 'unknown',
  url: 'https://github.com/scorpion-monitoring/scorpion',
  licence: 'ISC',
  licenceUrl: 'https://github.com/scorpion-monitoring/scorpion/blob/main/LICENSE',
} as const;
