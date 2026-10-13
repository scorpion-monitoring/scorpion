// The pages of registry.services that are registered in `ui.routes` (so the server knows who may open them)
// but have no component in the browser half yet. The catalogue links to a page only when it is offered, and
// `ui.test.ts` fails when this list and the two halves disagree. Every page is offered since sprint 6 (the service
// page); the list stays so that a page added to the server half first (a module contributing one) is not linked
// before it exists.
export const NOT_OFFERED: readonly string[] = [];

/** Whether the browser half has a page for `path`. */
export const isOffered = (path: string): boolean => !NOT_OFFERED.includes(path);
