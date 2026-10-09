// What the organisation screens need to read from a failure beyond the shell's generic words. Pure (no
// Svelte, no ui-kit), so it is unit tested; the page turns the result into text through the catalogue.
import { ApiError } from '@scorpion/contracts/client';

/** The stable problem type of a delete or a type change that a reference blocks (`organisation-in-use`). */
export const ORGANISATION_IN_USE = 'organisation-in-use';

/**
 * The module ids the problem of an `organisation-in-use` names ("The organisation is still in use by: a,
 * b."): the server names the modules and never the rows. Empty when the text does not say.
 */
export function modulesInUse(detail: string): string[] {
  const match = /in use by: (.+?)\.?$/.exec(detail.trim());
  return match
    ? match[1]!
        .split(',')
        .map((id) => id.trim())
        .filter((id) => /^[a-z][a-z0-9.-]{0,63}$/.test(id))
    : [];
}

/** `modules` is the list the problem names (possibly empty) when a reference blocks the change; else `undefined`. */
export function referenceBlock(error: unknown): { modules: string[] } | undefined {
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    error.type?.endsWith(ORGANISATION_IN_USE)
  ) {
    return { modules: modulesInUse(error.message) };
  }
  return undefined;
}
