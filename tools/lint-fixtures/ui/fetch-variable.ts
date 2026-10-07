// A fetch of a URL that is computed elsewhere (an uploaded asset, a prepared request) is not hand-written.
export const a = (target: URL) => fetch(target);
export const b = (request: Request) => fetch(request);
