import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import { ApiError } from '@scorpion/contracts/client';

/**
 * What a loader throws for a failure: an HTTP error SvelteKit turns into the error page with that
 * status. Loaders throw, they never return a `Response` (defect 12).
 */
export function toHttpError(failure: unknown): never {
  // SvelteKit's own HttpError and Redirect are thrown as they are.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (isHttpError(failure) || isRedirect(failure)) throw failure;
  if (failure instanceof ApiError) {
    // The API being unreachable or failing is a 502 for the visitor; a 4xx keeps its meaning.
    const status = failure.status >= 500 || failure.status === 0 ? 502 : failure.status;
    error(
      status,
      status === 502 ? 'The service is not available. Try again in a moment.' : failure.message,
    );
  }
  throw failure instanceof Error ? failure : new Error('Unexpected failure in a loader');
}
