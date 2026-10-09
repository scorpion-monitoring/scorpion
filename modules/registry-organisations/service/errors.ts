import { DomainError } from '@scorpion/contracts';

/** The problem type of {@link OrganisationInUse}. */
export const ORGANISATION_IN_USE = 'organisation-in-use';

/** 409: another module still refers to the organisation. Names the modules, never the rows. */
export class OrganisationInUse extends DomainError {
  readonly modules: readonly string[];
  constructor(modules: readonly string[]) {
    super(
      409,
      'Conflict',
      `The organisation is still in use by: ${modules.join(', ')}.`,
      undefined,
      ORGANISATION_IN_USE,
    );
    this.modules = modules;
  }
}
