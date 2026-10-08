// What the web process reads from its environment when it starts (never at build time), so one build
// serves any prefix and any API address (ADR-0027). Read from `process.env` (the node adapter is the only
// target); SvelteKit 3's `$app/env` is for variables that are declared and typed in `src/env.ts`, which
// two values do not need.
import { basePrefix } from '@scorpion/contracts';
import { parseApiTimeout } from '../../front/front.ts';

/** `BASE_PATH` as the API reads it: `/` or `/a/b`. */
export const basePath = process.env.BASE_PATH ?? '/';
// Fails at start-up, not at the first request, for a value the API would refuse too.
basePrefix(basePath);

/** Where the API process listens (the front proxies `/api` there, and pages call it directly). */
export const apiOrigin = process.env.API_ORIGIN ?? 'http://127.0.0.1:3001';

/**
 * How long a call of the API may be silent before it is given up (`API_TIMEOUT_MS`, default 30 s, 0 for
 * none). The same value limits the front's proxy and the calls the page server makes itself.
 */
export const apiTimeoutMs = parseApiTimeout(process.env.API_TIMEOUT_MS);
