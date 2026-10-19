// How the forms show a failure: the messages of the fields they draw go on those fields, and everything else (a
// problem of the whole request, a field the form does not draw, a list item such as `measuredBy[0]`) goes in one
// alert, so no message is lost. Pure.
import type { FormFailure } from '@scorpion/ui-kit';

const base = (path: string) => path.replace(/\[\d+\].*$/, '').replace(/\..*$/, '');

/** The messages for the fields in `names`, including the items of a list (`measuredBy[1]` is for `measuredBy`). */
export function errorsFor(failure: FormFailure | undefined, name: string): string[] {
  if (!failure) return [];
  return Object.entries(failure.fields)
    .filter(([path]) => base(path) === name)
    .flatMap(([, messages]) => messages);
}

/** What the alert says: the general messages, and the messages of fields that no control of the form shows. */
export function leftover(failure: FormFailure | undefined, shown: readonly string[]): string[] {
  if (!failure) return [];
  const rest = Object.entries(failure.fields)
    .filter(([path]) => !shown.includes(base(path)))
    .map(([path, messages]) => `${path}: ${messages.join(' ')}`);
  return [...failure.general, ...rest];
}
