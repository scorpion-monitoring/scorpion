// Shared by the OIDC service tests: one stub provider per test file, a kernel over Postgres that
// knows it, and a few helpers to walk a login.
import { startStubIdp, type StubIdp, type StubLogin } from '@scorpion/testing';
import { afterAll, beforeAll } from 'vitest';
import type { Actor } from '@scorpion/contracts';
import type { IdentityInternals } from '../module.ts';
import type { CompleteInput } from '../service/oidc.ts';
import { settingsSchema, type IdentitySettings } from '../service/settings.ts';
import { useIdentity } from './harness.ts';

export const identity = useIdentity();

let current: StubIdp | undefined;
beforeAll(async () => {
  current = await startStubIdp();
});
afterAll(async () => {
  await current?.stop();
});
/** The stub provider of this test file (started before the tests, stopped after them). */
export const idp: StubIdp = new Proxy({} as StubIdp, {
  get: (_target, key) => Reflect.get(current!, key) as unknown,
  set: (_target, key, value) => Reflect.set(current!, key, value),
});

export const settingsWith = (over: Record<string, unknown> = {}): IdentitySettings => ({
  get: () => Promise.resolve(settingsSchema.parse({ oidcProviders: [idp.provider()], ...over })),
});
export const start = (options: Parameters<typeof identity.start>[0] = {}) =>
  identity.start({
    settings: settingsWith(),
    clientSecret: () => idp.clientSecret,
    ...options,
  });

export type Kernel = Awaited<ReturnType<typeof start>>['kernel'];
export const rows = async (kernel: Kernel, sql: string, values: unknown[] = []) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
export const count = async (kernel: Kernel, table: string) =>
  Number((await rows(kernel, `select count(*) from ${table}`))[0]!.count);

export const sessionActor = (u: { id: string; username: string }, sessionId?: string): Actor => ({
  kind: 'user',
  userId: u.id,
  username: u.username,
  roles: [],
  via: 'session',
  sessionId,
});

/** A session actor with a real session row: it has "this session" and a recent authentication (ADR 0025). */
export async function sessionActorFor(
  id: IdentityInternals,
  u: { id: string; username: string },
  now?: Date,
): Promise<Actor> {
  return sessionActor(u, (await id.sessions.create(u.id, undefined, now)).sessionId);
}

/** Starts a login (or, with an actor, a link) and plays the browser at the provider. */
export async function flow(
  id: IdentityInternals,
  login: Partial<StubLogin> = {},
  actor?: Actor,
): Promise<CompleteInput> {
  const started = actor ? await id.oidc.startLink(actor, 'stub') : await id.oidc.start('stub');
  const back = await idp.authorize(started.authorizationUrl, login);
  return {
    providerId: 'stub',
    state: back.searchParams.get('state')!,
    code: back.searchParams.get('code')!,
    error: undefined,
    verifier: started.cookie.value,
    previousSessionId: undefined,
  };
}

let n = 0;
/** A login nobody has used before. */
export const fresh = (over: Partial<StubLogin> = {}): Partial<StubLogin> => ({
  subject: `sub-${++n}-${Date.now()}`,
  email: `person${n}@example.org`,
  emailVerified: true,
  preferredUsername: `person${n}`,
  ...over,
});
