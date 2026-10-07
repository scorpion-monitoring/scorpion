// Re-authentication (ADR-0025, ASVS 7.5.1): a change that needs a recent authentication answers 401
// `reauthentication-required`. `run()` takes the action, and on that answer asks for the password (or,
// for an account with none, a sign-in at a provider) and repeats the action. The password path keeps the
// action in memory. The provider path leaves the page, and the callback returns to the application root
// with no return path, so the intended action is kept in `sessionStorage` (a path and a small intent,
// never a secret) and `takeReturn()` hands it back after the return; the path is checked as a `returnTo`
// is, and the entry is removed when it is read.
import { ApiError, unwrap, type ApiClient } from '@scorpion/contracts/client';
import { REAUTHENTICATION_REQUIRED } from '@scorpion/contracts';

export const REAUTH_KEY = 'scorpion.reauth';

/** What to do again after the person came back from the provider: an id the page knows, and its data. */
export interface Intent {
  id: string;
  payload?: unknown;
}

/** An entry older than this is stale: the person left the provider's page without coming back. */
export const REAUTH_RETURN_MAX_AGE_MS = 10 * 60 * 1000;

export interface Returned {
  path: string;
  intent: Intent | undefined;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const isReauthRequired = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 401 && error.type === REAUTHENTICATION_REQUIRED;

/** The person closed the dialog: nothing was done. A page shows nothing for it. */
export class ReauthCancelled extends Error {
  constructor() {
    super('Confirming the identity was cancelled.');
    this.name = 'ReauthCancelled';
  }
}

export interface Provider {
  id: string;
  displayName: string;
  iconHash?: string;
}

export interface ReauthState {
  open: boolean;
  step: 'password' | 'provider';
  providers: Provider[];
  busy: boolean;
  /** `wrong`: the password is wrong; `throttled`: wait; `noSignIn`: no sign-in at that provider; `failed`: anything else. */
  problem?: 'wrong' | 'throttled' | 'noSignIn' | 'failed';
  retryAfterSeconds?: number;
}

export interface ReauthDeps {
  api: ApiClient;
  /** Absent when the browser has none (a private window): the provider path then cannot resume. */
  storage: Store | undefined;
  /** The page's own path with the base, its query, and no fragment. */
  path: () => string;
  /** Sends the browser to another address (the provider). */
  navigate: (url: string) => void;
}

export interface ReauthController {
  readonly state: ReauthState;
  subscribe(listener: (state: ReauthState) => void): () => void;
  run<T>(action: () => Promise<T>, intent?: Intent): Promise<T>;
  submitPassword(password: string): Promise<void>;
  startProvider(providerId: string): Promise<void>;
  cancel(): void;
}

const CLOSED: ReauthState = { open: false, step: 'password', providers: [], busy: false };

export function createReauthController(deps: ReauthDeps): ReauthController {
  let state: ReauthState = CLOSED;
  const listeners = new Set<(state: ReauthState) => void>();
  let pending:
    | {
        action: () => Promise<unknown>;
        intent: Intent | undefined;
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
      }
    | undefined;

  const set = (next: Partial<ReauthState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };
  const finish = () => {
    state = CLOSED;
    for (const listener of listeners) listener(state);
  };

  async function repeat() {
    const waiting = pending;
    pending = undefined;
    finish();
    if (!waiting) return;
    try {
      waiting.resolve(await waiting.action());
    } catch (error) {
      waiting.reject(error);
    }
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async run(action, intent) {
      try {
        return await action();
      } catch (error) {
        if (!isReauthRequired(error)) throw error;
      }
      // One dialog at a time: a second action while it is open waits for the first to end.
      pending?.reject(new ReauthCancelled());
      return new Promise((resolve, reject) => {
        pending = { action, intent, resolve: resolve as (v: unknown) => void, reject };
        set({ ...CLOSED, open: true });
      });
    },

    async submitPassword(password) {
      set({ busy: true, problem: undefined, retryAfterSeconds: undefined });
      try {
        await unwrap(deps.api.POST('/account/reauthenticate', { body: { password } }));
      } catch (error) {
        if (!(error instanceof ApiError)) return set({ busy: false, problem: 'failed' });
        if (error.status === 409) {
          // The account has no password: the way back in is a provider.
          let providers: Provider[] = [];
          try {
            providers = (await unwrap(deps.api.GET('/auth/oidc/providers'))).result;
          } catch {
            // The buttons are missing; the dialog says so.
          }
          return set({ busy: false, step: 'provider', providers });
        }
        if (error.status === 429) {
          return set({
            busy: false,
            problem: 'throttled',
            retryAfterSeconds: error.retryAfterSeconds,
          });
        }
        return set({ busy: false, problem: error.status === 422 ? 'wrong' : 'failed' });
      }
      await repeat();
    },

    async startProvider(providerId) {
      set({ busy: true, problem: undefined });
      try {
        const { authorizationUrl } = await unwrap(
          deps.api.POST('/account/reauthenticate/oidc/{provider}', {
            params: { path: { provider: providerId } },
          }),
        );
        try {
          deps.storage?.setItem(
            REAUTH_KEY,
            JSON.stringify({ path: deps.path(), intent: pending?.intent, at: Date.now() }),
          );
        } catch {
          // Not stored: the person lands on the start page and does the change again.
        }
        deps.navigate(authorizationUrl);
      } catch (error) {
        set({
          busy: false,
          problem: error instanceof ApiError && error.status === 404 ? 'noSignIn' : 'failed',
        });
      }
    },

    cancel() {
      const waiting = pending;
      pending = undefined;
      finish();
      waiting?.reject(new ReauthCancelled());
    },
  };
}

/**
 * What the page that left for the provider asked to be done, read once and removed. `undefined` when
 * nothing is stored, the entry is malformed, or its path is not one of this instance (`localPath`).
 */
export function takeReturn(
  storage: Store | undefined,
  localPath: (candidate: unknown) => string | null,
  now: number = Date.now(),
): Returned | undefined {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(REAUTH_KEY) ?? null;
    storage?.removeItem(REAUTH_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const entry = JSON.parse(raw) as {
      path?: unknown;
      at?: unknown;
      intent?: { id?: unknown; payload?: unknown };
    };
    // A stale entry (or one from the future) is dropped: it must not send anyone anywhere hours later.
    if (
      typeof entry.at !== 'number' ||
      entry.at > now ||
      now - entry.at > REAUTH_RETURN_MAX_AGE_MS
    ) {
      return undefined;
    }
    const path = localPath(entry.path);
    if (path === null) return undefined;
    const intent =
      typeof entry.intent?.id === 'string'
        ? { id: entry.intent.id, payload: entry.intent.payload }
        : undefined;
    return { path, intent };
  } catch {
    return undefined;
  }
}
