// The service of kpi.impact (M12 sprint 1): the consortia a Reviewer can pick and the live tiles of one. Everything is read through the public
// surface of other modules; the module owns no table yet. The plain permission is checked here as well as on the route.
import { Invalid, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { CONSORTIUM_TYPE, type OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { z } from 'zod';
import { PERMISSION_READ } from './permissions.ts';
import { countTiles, STAGE_VOCABULARY, type Tiles } from './tiles.ts';

export interface ConsortiumView {
  id: string;
  name: string;
  abbreviation: string;
}

export interface SummaryQuery {
  consortium: string;
  /** Count the unpublished services too. Default `false`. */
  includeUnpublished?: boolean | undefined;
  /** The language of the stage labels. Default `en`. */
  locale?: string | undefined;
}

export interface ImpactDeps {
  authz: Pick<AuthzService, 'require'>;
  settings: Pick<SettingsService, 'listTerms'>;
  organisations: Pick<OrganisationsPublic, 'findByIdsAsSystem' | 'listConsortiaAsSystem'>;
  services: Pick<ServicesPublic, 'listImpactRowsAsSystem' | 'findLicencesAsSystem'>;
}

export interface ImpactService {
  /** Needs `kpi.impact.read`. The consortia the picker offers, by name then id. */
  consortia(actor: Actor): Promise<ConsortiumView[]>;
  /**
   * Needs `kpi.impact.read`. The tiles of one consortium, counted live. `Invalid` (422) naming `consortium` for an id that is no id, names no
   * organisation or names one that is not a consortium (and for a consortium of more than 2,000 services).
   */
  summary(actor: Actor, query: SummaryQuery): Promise<Tiles>;
}

export function createImpactService(deps: ImpactDeps): ImpactService {
  const uuid = z.uuid();
  return {
    async consortia(actor) {
      await deps.authz.require(actor, PERMISSION_READ);
      return deps.organisations.listConsortiaAsSystem();
    },

    async summary(actor, { consortium, includeUnpublished = false, locale = 'en' }) {
      await deps.authz.require(actor, PERMISSION_READ);
      const notAConsortium = new Invalid('The request is not valid.', [
        { in: 'query', path: 'consortium', message: 'This is not a known consortium.' },
      ]);
      if (!uuid.safeParse(consortium).success) throw notAConsortium;
      const [found] = await deps.organisations.findByIdsAsSystem([consortium]);
      if (found?.type !== CONSORTIUM_TYPE) throw notAConsortium;

      const rows = await deps.services.listImpactRowsAsSystem(consortium);
      const terms = await deps.settings.listTerms(STAGE_VOCABULARY, {
        includeInactive: true,
        locale,
      });
      const licences = await deps.services.findLicencesAsSystem(
        rows.flatMap((row) => (row.license === null ? [] : [row.license])),
      );
      return countTiles({
        rows,
        terms: terms.map(({ key, label, active }) => ({ key, label, active })),
        licences,
        includeUnpublished,
      });
    },
  };
}
