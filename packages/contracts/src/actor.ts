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
  /** Not trusted for decisions: `core.authz` resolves the roles of `userId` itself. The authenticator leaves it empty. */
  roles: readonly string[];
  /** How the caller proved who they are. */
  via: 'session' | 'token';
  /** What a token may do (permission ids such as `core.identity.me.read`); `undefined` for a session, which is not limited by scopes. */
  scopes?: readonly string[];
  /** The id of the personal access token (never the token itself) when `via` is `token`; for the audit trail. */
  tokenId?: string;
}

export type Actor = AnonymousActor | UserActor;

export const ANONYMOUS: AnonymousActor = Object.freeze({ kind: 'anonymous' });

export function isUser(actor: Actor): actor is UserActor {
  return actor.kind === 'user';
}
