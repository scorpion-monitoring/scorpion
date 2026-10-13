// The pages of registry.services that are registered in `ui.routes` (so the server knows who may open them)
// but have no component in the browser half yet. The catalogue links to a page only when it is offered, and
// `ui.test.ts` fails when this list and the two halves disagree. The wizard (`/services/new`) is offered since
// sprint 5; sprint 6 takes `/services/:slug` off the list with the service page.
export const NOT_OFFERED: readonly string[] = ['/services/:slug'];

/** Whether the browser half has a page for `path`. */
export const isOffered = (path: string): boolean => !NOT_OFFERED.includes(path);
