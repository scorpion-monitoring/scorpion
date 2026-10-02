import { DomainError } from '@scorpion/contracts';

/**
 * 429 from a service: a per-user limit (not the pipeline's per-client bucket) is used up. Only for
 * callers who are signed in, so it never tells an outsider anything about an account.
 */
export class TooManyRequests extends DomainError {
  constructor(detail = 'Too many requests. Try again later.') {
    super(429, 'Too Many Requests', detail);
  }
}
