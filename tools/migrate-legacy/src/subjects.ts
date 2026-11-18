// The subjects file (decision 12): the legacy API returns no user id, and the OIDC subject (the legacy `USER.id`) is what
// lets a person keep their account. The maintainer reads the pairs once from where they live (a Neo4j query, or Keycloak's
// user list) into a text file of two columns, subject and username, separated by a tab or a comma, one per line; empty lines
// and lines starting with "#" are ignored. It holds personal data: it is read from outside the repository only.
import { readFile } from 'node:fs/promises';
import { refuseInsideRepository } from './files.ts';

export class SubjectsError extends Error {}

export interface Subjects {
  /** Lower-cased username → subject. */
  byUsername: Map<string, string>;
  /** Lower-cased usernames given with more than one subject: ambiguous, so not migrated. */
  ambiguous: Set<string>;
  lines: number;
}

const MAX_BYTES = 20_000_000;
const MAX_SUBJECT = 255;

export function parseSubjects(text: string): Subjects {
  const byUsername = new Map<string, string>();
  const ambiguous = new Set<string>();
  let lines = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const separator = line.includes('\t') ? '\t' : ',';
    const parts = line.split(separator).map((part) => part.trim());
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
      throw new SubjectsError(
        `Line ${index + 1} is not "subject${separator === '\t' ? '<tab>' : ','}username".`,
      );
    }
    const [subject, username] = parts as [string, string];
    if (subject.length > MAX_SUBJECT) {
      throw new SubjectsError(
        `Line ${index + 1}: the subject is longer than ${MAX_SUBJECT} characters.`,
      );
    }
    lines += 1;
    const key = username.toLowerCase();
    const known = byUsername.get(key);
    if (known !== undefined && known !== subject) ambiguous.add(key);
    byUsername.set(key, known ?? subject);
  });
  return { byUsername, ambiguous, lines };
}

/** Reads the subjects file from `path`, which must be outside the repository. */
export async function readSubjects(path: string): Promise<Subjects> {
  const file = refuseInsideRepository(path, 'The subjects file');
  const content = await readFile(file).catch(() => {
    throw new SubjectsError(`The subjects file ${file} cannot be read.`);
  });
  if (content.byteLength > MAX_BYTES)
    throw new SubjectsError(`The subjects file ${file} is too large.`);
  return parseSubjects(content.toString('utf8'));
}

export const noSubjects = (): Subjects => ({
  byUsername: new Map(),
  ambiguous: new Set(),
  lines: 0,
});
