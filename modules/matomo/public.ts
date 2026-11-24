// The only file other modules may import. matomo offers no service to other modules: its one route serves the browser's
// tracker, and the web app widens the page's CSP from the same answer (ADR-0054).
export { isMatomoUrl, MAX_URL_LENGTH } from './settings-schema.ts';
export { trackerRoute, trackerConfigSchema } from './routes.ts';
export { USER_ID_KEY_SECRET } from './service/tracker.ts';
