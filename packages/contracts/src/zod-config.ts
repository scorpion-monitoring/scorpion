// The browser runs under a Content-Security-Policy without 'unsafe-eval'. Zod would try `new Function` to
// compile faster parsers; the policy blocks that (a violation report in the console, then a fallback), so the
// client says up front that it does not want it. Imported first by `client.ts`, before any schema exists.
import { z } from '@hono/zod-openapi';

z.config({ jitless: true });
