// Who is calling. The request pipeline (step 3) resolves the credentials of a request to an Actor
// through the registry `kernel.authenticator`; handlers, the authoriser and services read it.

/** A request without credentials. Only `public: true` routes serve it; the authoriser decides the rest. */
export interface AnonymousActor {
  kind: 'anonymous';
}

/** A signed-in person, by session cookie or personal access token. */
export interface UserActor {
  kind: 'user';
  userId: string;
  username: string;
  /** Role ids. Roles are data owned by `core.authz` (M3); until then this is empty. */
  roles: readonly string[];
  /** How the caller proved who they are. */
  via: 'session' | 'token';
  /** What a token may do (`read:kpi`); `undefined` for a session, which is not limited by scopes. */
  scopes?: readonly string[];
}

export type Actor = AnonymousActor | UserActor;

export const ANONYMOUS: AnonymousActor = Object.freeze({ kind: 'anonymous' });

export function isUser(actor: Actor): actor is UserActor {
  return actor.kind === 'user';
}
