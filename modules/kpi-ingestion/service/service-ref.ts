// A service named by the public API: its id or its abbreviation (the current slug, or an old one that redirects). Both the reads and
// the write of v1 take it, so it is resolved in one place. `registry.services` is asked; nothing here reads its tables.
import type { ServicesPublic } from '@scorpion/registry-services/public';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ServiceLookup = Pick<ServicesPublic, 'findByIdsAsSystem' | 'findBySlugAsSystem'>;

/** The id and the current abbreviation of the service `reference` names, or `undefined`. A trusted read: the caller checks its own permission. */
export async function resolveServiceRef(
  services: ServiceLookup,
  reference: string,
): Promise<{ id: string; abbreviation: string } | undefined> {
  const wanted = reference.trim();
  if (wanted === '') return undefined;
  const found = UUID.test(wanted)
    ? (await services.findByIdsAsSystem([wanted.toLowerCase()]))[0]
    : await services.findBySlugAsSystem(wanted);
  return found ? { id: found.id, abbreviation: found.slug } : undefined;
}
