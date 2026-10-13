import { DomainError } from '@scorpion/contracts';

/** The problem type of {@link SlugTaken}. */
export const SLUG_TAKEN = 'slug-taken';

/** 409: the slug is in use now or was used by a service before (an old slug is never reused). Names the field only. */
export class SlugTaken extends DomainError {
  constructor() {
    super(
      409,
      'Conflict',
      'A service with this slug exists, or had it once.',
      [{ in: 'body', path: 'slug', message: 'This slug is already taken.' }],
      SLUG_TAKEN,
    );
  }
}
