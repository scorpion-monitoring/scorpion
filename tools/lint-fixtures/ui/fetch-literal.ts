// A hand-written fetch URL: a violation. The UI calls the API through the typed client.
export const a = () => fetch('/api/internal/auth/me');
export const b = (id: string) => fetch(`/api/internal/users/${id}`);
export const c = (id: string) => fetch('/api/internal/users/' + id);
export const d = () => globalThis.fetch('/api/internal/auth/me');
