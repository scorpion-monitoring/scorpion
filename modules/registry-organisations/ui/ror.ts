// The normalised preview of a ROR id in the form: what the server will store for what the person typed or
// pasted. Only the shape is checked here (the pattern and the check digits are the server's to judge, and
// its words are shown on the field), so a wrong id shows no preview rather than a wrong promise.
const BARE = /^0[a-hj-km-np-tv-z0-9]{6}[0-9]{2}$/;

/** `02skbsp27` for `02skbsp27`, `ror.org/02SKBSP27` and `https://ror.org/02skbsp27`; `undefined` otherwise. */
export function previewRor(input: string): string | undefined {
  const id = input
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?ror\.org\//, '');
  return BARE.test(id) ? id : undefined;
}

/** Where the id leads. */
export const rorLink = (id: string) => `https://ror.org/${id}`;
