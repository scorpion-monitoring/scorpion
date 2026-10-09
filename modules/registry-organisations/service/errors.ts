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

/** The problem type of {@link MembershipStateConflict}. */
export const MEMBERSHIP_STATE = 'membership-state';

/** 409: the action does not apply to the membership as it is now (a second decider arrived late, a request that was already decided). */
export class MembershipStateConflict extends DomainError {
  constructor(state: string) {
    super(
      409,
      'Conflict',
      `The membership is "${state}"; this action does not apply to it.`,
      undefined,
      MEMBERSHIP_STATE,
    );
  }
}

/** The problem type of {@link TooManyPending}. */
export const TOO_MANY_PENDING = 'too-many-pending';

/** 409, not 429: waiting does not help, a request has to be decided or withdrawn first. */
export class TooManyPending extends DomainError {
  constructor(limit: number) {
    super(
      409,
      'Conflict',
      `You already have ${limit} open membership requests. Wait for a decision or withdraw one first.`,
      undefined,
      TOO_MANY_PENDING,
    );
  }
}

/** The problem type of {@link TooManyManagers}. */
export const TOO_MANY_MANAGERS = 'too-many-managers';

/** 409: a promotion would give the organisation more managers than `membership.maxManagersPerOrganisation`. */
export class TooManyManagers extends DomainError {
  constructor(limit: number) {
    super(
      409,
      'Conflict',
      `The organisation already has ${limit} managers, the most it may have. Demote one first.`,
      undefined,
      TOO_MANY_MANAGERS,
    );
  }
}

/** The problem type of {@link MembershipNotSupported}. */
export const MEMBERSHIP_NOT_SUPPORTED = 'membership-not-supported';

/** 422: the organisation's type does not accept members (`membership: false`), or is no longer registered. */
export class MembershipNotSupported extends DomainError {
  constructor() {
    super(
      422,
      'Unprocessable Content',
      'People cannot become members of an organisation of this type.',
      undefined,
      MEMBERSHIP_NOT_SUPPORTED,
    );
  }
}
