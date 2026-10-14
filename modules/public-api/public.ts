// The only file other modules may import. public-api has no service: it collects the v1 routes the
// other modules register and serves the document that describes them, and it holds no data.
// A module that wants a v1 route registers it with `r.public('v1', route, handler)`; it needs no import from here.
export { isOrigin, MAX_CORS_ORIGINS } from './settings-schema.ts';
// The route definition of the spec, for its contract test (`apps/server/src/public-api.contract.test.ts`).
export { specRoute } from './routes.ts';
