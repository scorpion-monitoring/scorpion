// The terms of a vocabulary for the parts of this module that sit inside another module's page (the wizard step and
// the service section): read once per browser session and kept, so the second page that needs the necessity labels
// asks nobody. The API client is the key, so a test with a fresh client starts empty.
import { unwrap } from '@scorpion/contracts/client';
import type { getShell } from '@scorpion/ui-kit';
import type { Term } from './terms.ts';

type Api = ReturnType<typeof getShell>['api'];

const cache = new WeakMap<object, Map<string, Promise<Term[]>>>();

export function vocabularyTerms(api: Api, vocabulary: string): Promise<Term[]> {
  const perClient = cache.get(api) ?? new Map<string, Promise<Term[]>>();
  cache.set(api, perClient);
  const known = perClient.get(vocabulary);
  if (known) return known;
  const asked = unwrap(
    api.GET('/vocabularies/{vocabulary}/terms', {
      params: { path: { vocabulary }, query: { page: '0', pageSize: '500' } },
    }),
  )
    .then((answer) => answer.result as Term[])
    .catch((error: unknown) => {
      // A failed read is not kept: the next try asks again.
      perClient.delete(vocabulary);
      throw error;
    });
  perClient.set(vocabulary, asked);
  return asked;
}
