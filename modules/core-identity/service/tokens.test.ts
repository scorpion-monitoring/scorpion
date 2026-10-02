import {
  ANONYMOUS,
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { makeRoleAssignment, makeToken, makeUser } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { parseToken } from './token-format.ts';
import { TOKENS_PER_USER, type TokenService } from './tokens.ts';

const identity = useIdentity();

const actorOf = (user: { id: string; username: string }, via: 'session' | 'token' = 'session') =>
  ({ kind: 'user', userId: user.id, username: user.username, roles: [], via }) as Actor;
/** A user who holds the role `user`, as an approved account does. */
const holder = async (
  pool: Parameters<typeof makeUser>[0],
  overrides?: Parameters<typeof makeUser>[1],
) => {
  const made = await makeUser(pool, overrides);
  await makeRoleAssignment(pool, made, 'user');
  return made;
};
/** The scopes of ordinary tests: a permission that exists and that a plain user holds. */
const SCOPE = 'core.identity.me.read';
const OTHER_SCOPE = 'core.identity.profile.read';
type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
const page = { page: 0, pageSize: 50 };
const future = () => new Date(Date.now() + 86_400_000).toISOString();

/** `create` with a default scope: a token needs at least one, and most tests are not about scopes. */
const withScopes = (tokens: TokenService): TokenService => ({
  ...tokens,
  create: (actor, input) => tokens.create(actor, { scopes: [SCOPE], ...(input as object) }),
});

async function start() {
  const started = await identity.start({ tokenCacheTtlMs: 0 });
  const owner = await holder(started.kernel.pool);
  return { ...started, owner, actor: actorOf(owner), tokens: withScopes(started.identity.tokens) };
}

describe('create', () => {
  it('returns the token once, stores only an argon2id hash of its secret, and emits an event without it', async () => {
    const { kernel, tokens, actor, owner } = await start();
    const created = await tokens.create(actor, { name: 'ci', scopes: [SCOPE] });

    const parsed = parseToken(created.token)!;
    expect(parsed.prefix).toBe(created.prefix);
    expect(created).toMatchObject({
      name: 'ci',
      scopes: [SCOPE],
      expiresAt: null,
      lastUsedAt: null,
    });

    const [row] = await rows(kernel, 'select * from identity_token');
    expect(row).toMatchObject({ user_id: owner.id, prefix: created.prefix, name: 'ci' });
    expect(row!.secret_hash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row)).not.toContain(parsed.secret);

    const events = await rows(kernel, 'select name, payload from kernel_outbox');
    expect(events).toEqual([
      {
        name: 'identity.token.created@1',
        payload: { userId: owner.id, tokenId: created.id, name: 'ci' },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(parsed.secret);
  });

  it('keeps the name unique per user, but lets two users use the same one', async () => {
    const { kernel, tokens, actor } = await start();
    await tokens.create(actor, { name: 'ci' });
    await expect(tokens.create(actor, { name: 'ci' })).rejects.toBeInstanceOf(Conflict);
    const other = actorOf(await holder(kernel.pool));
    await expect(tokens.create(other, { name: 'ci' })).resolves.toBeTruthy();
  });

  it('lets a revoked token’s name be used again', async () => {
    const { tokens, actor } = await start();
    const first = await tokens.create(actor, { name: 'ci' });
    await tokens.revoke(actor, first.id);
    await expect(tokens.create(actor, { name: 'ci' })).resolves.toBeTruthy();
  });

  it.each([
    ['no name', {}],
    ['an unknown scope shape', { name: 'a', scopes: ['admin'] }],
    ['an expiry in the past', { name: 'a', expiresAt: '2001-01-01T00:00:00Z' }],
    ['an extra field', { name: 'a', userId: 'someone-else' }],
    ['a body that is not an object', 'name'],
  ])('refuses %s with Invalid (422) and writes nothing', async (_name, input) => {
    const { kernel, tokens, actor } = await start();
    await expect(tokens.create(actor, input)).rejects.toBeInstanceOf(Invalid);
    expect(await rows(kernel, 'select 1 from identity_token')).toEqual([]);
  });

  it('stops at the limit per user', async () => {
    const { kernel, tokens, actor, owner } = await start();
    for (let i = 0; i < TOKENS_PER_USER; i++) await makeToken(kernel.pool, owner);
    await expect(tokens.create(actor, { name: 'one-too-many' })).rejects.toBeInstanceOf(Conflict);
  });

  it('refuses an anonymous caller (401) and a caller who uses a token (403)', async () => {
    const { owner, tokens } = await start();
    await expect(tokens.create(ANONYMOUS, { name: 'a' })).rejects.toBeInstanceOf(Unauthorized);
    await expect(tokens.create(actorOf(owner, 'token'), { name: 'a' })).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('rolls back the token when its event cannot be written', async () => {
    const { kernel, tokens, actor } = await start();
    await failOutbox(kernel);
    await expect(tokens.create(actor, { name: 'ci' })).rejects.toThrow();
    expect(await rows(kernel, 'select 1 from identity_token')).toEqual([]);
  });
});

describe('list', () => {
  it('lists the caller’s live tokens, oldest first, with no secret or hash', async () => {
    const { tokens, actor } = await start();
    const a = await tokens.create(actor, { name: 'a' });
    const b = await tokens.create(actor, { name: 'b' });
    const gone = await tokens.create(actor, { name: 'gone' });
    await tokens.revoke(actor, gone.id);

    const { tokens: listed, total } = await tokens.list(actor, page);
    expect(listed.map((t) => t.name)).toEqual(['a', 'b']);
    expect(total).toBe(2);
    expect(Object.keys(listed[0]!).sort()).toEqual(
      ['createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'prefix', 'scopes'].sort(),
    );
    const text = JSON.stringify(listed);
    expect(text).not.toContain(parseToken(a.token)!.secret);
    expect(text).not.toContain(parseToken(b.token)!.secret);
    expect(text).not.toContain('argon2');
  });

  it('pages', async () => {
    const { tokens, actor } = await start();
    for (const name of ['a', 'b', 'c']) await tokens.create(actor, { name });
    const second = await tokens.list(actor, { page: 1, pageSize: 2 });
    expect(second.tokens.map((t) => t.name)).toEqual(['c']);
    expect(second.total).toBe(3);
  });

  it('never shows another user’s tokens', async () => {
    const { kernel, tokens, actor } = await start();
    await tokens.create(actor, { name: 'mine' });
    const other = await holder(kernel.pool);
    await makeToken(kernel.pool, other, { name: 'theirs' });
    expect((await tokens.list(actor, page)).tokens.map((t) => t.name)).toEqual(['mine']);
    expect((await tokens.list(actorOf(other), page)).tokens.map((t) => t.name)).toEqual(['theirs']);
  });

  it('refuses an anonymous caller and a caller who uses a token', async () => {
    const { owner, tokens } = await start();
    await expect(tokens.list(ANONYMOUS, page)).rejects.toBeInstanceOf(Unauthorized);
    await expect(tokens.list(actorOf(owner, 'token'), page)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('revoke', () => {
  it('stops the token working at once, keeps the row, and emits an event', async () => {
    const { kernel, tokens, actor } = await start();
    const created = await tokens.create(actor, { name: 'ci' });
    expect(await tokens.authenticate(created.token)).toBeDefined();

    await tokens.revoke(actor, created.id);

    expect(await tokens.authenticate(created.token)).toBeUndefined();
    const [row] = await rows(kernel, 'select revoked_at from identity_token');
    expect(row!.revoked_at).toBeInstanceOf(Date);
    expect(
      (await rows(kernel, 'select name from kernel_outbox order by id')).map((e) => e.name),
    ).toEqual(['identity.token.created@1', 'identity.token.revoked@1']);
  });

  it('is idempotent for the owner and emits no second event', async () => {
    const { kernel, tokens, actor } = await start();
    const created = await tokens.create(actor, { name: 'ci' });
    await tokens.revoke(actor, created.id);
    await expect(tokens.revoke(actor, created.id)).resolves.toBeUndefined();
    expect(
      await rows(kernel, `select 1 from kernel_outbox where name = 'identity.token.revoked@1'`),
    ).toHaveLength(1);
  });

  it('answers the same for someone else’s token as for an unknown id, and leaves the token alone', async () => {
    const { kernel, tokens, actor } = await start();
    const other = await holder(kernel.pool);
    const theirs = await tokens.create(actorOf(other), { name: 'theirs' });
    const asked = async (id: string) =>
      tokens.revoke(actor, id).then(
        () => 'ok',
        (error: unknown) => error,
      );

    const forOther = await asked(theirs.id);
    const forUnknown = await asked('019a0000-0000-7000-8000-000000000000');
    const forGarbage = await asked('not-a-uuid');
    expect(forOther).toBeInstanceOf(NotFound);
    expect(forUnknown).toBeInstanceOf(NotFound);
    expect(forGarbage).toBeInstanceOf(NotFound);
    expect((forOther as NotFound).message).toBe((forUnknown as NotFound).message);
    expect((forOther as NotFound).message).toBe((forGarbage as NotFound).message);
    expect(await tokens.authenticate(theirs.token)).toBeDefined();
  });

  it('refuses an anonymous caller and a caller who uses a token', async () => {
    const { owner, tokens } = await start();
    const id = '019a0000-0000-7000-8000-000000000000';
    await expect(tokens.revoke(ANONYMOUS, id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(tokens.revoke(actorOf(owner, 'token'), id)).rejects.toBeInstanceOf(Forbidden);
  });

  it('rolls back when the event cannot be written', async () => {
    const { kernel, tokens, actor } = await start();
    const created = await tokens.create(actor, { name: 'ci' });
    await failOutbox(kernel);
    await expect(tokens.revoke(actor, created.id)).rejects.toThrow();
    expect(await tokens.authenticate(created.token)).toBeDefined();
  });
});

describe('rotate', () => {
  it('replaces the token: same name and scopes, a new secret, the old one dead at once', async () => {
    const { kernel, tokens, actor } = await start();
    const old = await tokens.create(actor, {
      name: 'ci',
      scopes: [SCOPE],
      expiresAt: future(),
    });

    const next = await tokens.rotate(actor, old.id, {});

    expect(next).toMatchObject({ name: 'ci', scopes: [SCOPE], expiresAt: old.expiresAt });
    expect(next.id).not.toBe(old.id);
    expect(next.token).not.toBe(old.token);
    expect(await tokens.authenticate(old.token)).toBeUndefined();
    expect(await tokens.authenticate(next.token)).toMatchObject({ scopes: [SCOPE] });
    expect((await tokens.list(actor, page)).tokens.map((t) => t.id)).toEqual([next.id]);
    const [event] = await rows(
      kernel,
      `select payload from kernel_outbox where name = 'identity.token.rotated@1'`,
    );
    expect(event!.payload).toMatchObject({ tokenId: next.id, previousTokenId: old.id, name: 'ci' });
    expect(JSON.stringify(event)).not.toContain(parseToken(next.token)!.secret);
  });

  it('takes a new expiry, and needs one when the old expiry has passed', async () => {
    const { kernel, tokens, actor, owner } = await start();
    const old = await tokens.create(actor, { name: 'ci' });
    const later = future();
    expect((await tokens.rotate(actor, old.id, { expiresAt: later })).expiresAt).toEqual(
      new Date(later),
    );

    const expired = await makeToken(kernel.pool, owner, {
      name: 'old',
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(tokens.rotate(actor, expired.row.id, {})).rejects.toBeInstanceOf(Invalid);
    await expect(
      tokens.rotate(actor, expired.row.id, { expiresAt: future() }),
    ).resolves.toBeTruthy();
  });

  it('keeps the old token valid when the new one cannot be created (rollback)', async () => {
    const { kernel, tokens, actor } = await start();
    const old = await tokens.create(actor, { name: 'ci' });
    await failOutbox(kernel);

    await expect(tokens.rotate(actor, old.id, {})).rejects.toThrow();

    expect(await tokens.authenticate(old.token)).toBeDefined();
    expect((await tokens.list(actor, page)).tokens.map((t) => t.id)).toEqual([old.id]);
    expect(await rows(kernel, 'select 1 from identity_token where revoked_at is not null')).toEqual(
      [],
    );
  });

  it('answers the same for someone else’s, an unknown and a revoked token, and does not touch the other user’s', async () => {
    const { kernel, tokens, actor } = await start();
    const other = await holder(kernel.pool);
    const theirs = await tokens.create(actorOf(other), { name: 'theirs' });
    const mine = await tokens.create(actor, { name: 'mine' });
    await tokens.revoke(actor, mine.id);

    for (const id of [theirs.id, '019a0000-0000-7000-8000-000000000000', 'nope', mine.id]) {
      await expect(tokens.rotate(actor, id, {})).rejects.toBeInstanceOf(NotFound);
    }
    expect(await tokens.authenticate(theirs.token)).toBeDefined();
    expect((await tokens.list(actorOf(other), page)).tokens).toHaveLength(1);
  });

  it('refuses a bad expiry (422), an anonymous caller (401) and a caller who uses a token (403)', async () => {
    const { owner, tokens, actor } = await start();
    const made = await tokens.create(actor, { name: 'ci' });
    await expect(tokens.rotate(actor, made.id, { expiresAt: 'soon' })).rejects.toBeInstanceOf(
      Invalid,
    );
    await expect(tokens.rotate(ANONYMOUS, made.id, {})).rejects.toBeInstanceOf(Unauthorized);
    await expect(tokens.rotate(actorOf(owner, 'token'), made.id, {})).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(await tokens.authenticate(made.token)).toBeDefined();
  });
});

describe('authenticate', () => {
  it('knows a good token: who, and with which scopes', async () => {
    const { tokens, actor, owner } = await start();
    const { token } = await tokens.create(actor, { name: 'ci', scopes: [SCOPE, OTHER_SCOPE] });
    expect(await tokens.authenticate(token)).toMatchObject({
      userId: owner.id,
      username: owner.username,
      scopes: [SCOPE, OTHER_SCOPE],
    });
  });

  it('says undefined, and does not throw, for everything that is not a good token', async () => {
    const { kernel, tokens, actor, owner } = await start();
    const { token, prefix } = await tokens.create(actor, { name: 'ci' });
    const secret = parseToken(token)!.secret;
    const flipped = `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;

    const expired = await makeToken(kernel.pool, owner, {
      name: 'e',
      expiresAt: new Date(Date.now() - 1000),
    });
    const revoked = await makeToken(kernel.pool, owner, { name: 'r', revoked: true });
    const bad = [
      '',
      'garbage',
      `scp_${prefix}_${flipped}`, // right prefix, wrong secret
      `scp_ZZZZZZZZ_${secret}`, // unknown prefix
      expired.token,
      revoked.token,
    ];
    for (const value of bad) await expect(tokens.authenticate(value)).resolves.toBeUndefined();
  });

  it.each([
    ['pending', { status: 'pending' as const }],
    ['rejected', { status: 'rejected' as const }],
    ['soft-deleted', { deleted: true }],
  ])('refuses a token whose owner is %s', async (_name, state) => {
    const { kernel, tokens } = await start();
    const owner = await holder(kernel.pool);
    const created = await tokens.create(actorOf(owner), { name: 'ci' });
    expect(await tokens.authenticate(created.token)).toBeDefined();
    await kernel.pool.query('update identity_user set status = $2, deleted_at = $3 where id = $1', [
      owner.id,
      'status' in state ? state.status : 'active',
      'deleted' in state ? new Date() : null,
    ]);
    expect(await tokens.authenticate(created.token)).toBeUndefined();
  });

  it('records the last use without making the request wait, at most once a minute', async () => {
    const { kernel, tokens, actor } = await start();
    const { token, id } = await tokens.create(actor, { name: 'ci' });
    await tokens.authenticate(token);
    await tokens.idle();
    const [first] = await rows(kernel, 'select last_used_at from identity_token where id = $1', [
      id,
    ]);
    expect(first!.last_used_at).toBeInstanceOf(Date);

    await tokens.authenticate(token);
    await tokens.idle();
    const [second] = await rows(kernel, 'select last_used_at from identity_token where id = $1', [
      id,
    ]);
    expect(second!.last_used_at).toEqual(first!.last_used_at); // inside the minute: no new write
  });

  it('still accepts the token when recording its use fails', async () => {
    const { kernel, tokens, actor } = await start();
    const { token } = await tokens.create(actor, { name: 'ci' });
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'update on fire'; end $$;
      create trigger identity_test_fail before update on identity_token
        for each row execute function identity_test_fail();`);
    await expect(tokens.authenticate(token)).resolves.toBeDefined();
    await expect(tokens.idle()).resolves.toBeUndefined();
  });
});

describe('the cache of verified tokens', () => {
  async function cached() {
    const started = await identity.start({ tokenCacheTtlMs: 60_000 });
    const owner = await holder(started.kernel.pool);
    return {
      ...started,
      owner,
      actor: actorOf(owner),
      tokens: withScopes(started.identity.tokens),
    };
  }

  it('drops the entry at once when this process revokes or rotates', async () => {
    const { tokens, actor } = await cached();
    const one = await tokens.create(actor, { name: 'one' });
    const two = await tokens.create(actor, { name: 'two' });
    expect(await tokens.authenticate(one.token)).toBeDefined(); // now cached
    expect(await tokens.authenticate(two.token)).toBeDefined();

    await tokens.revoke(actor, one.id);
    const next = await tokens.rotate(actor, two.id, {});

    expect(await tokens.authenticate(one.token)).toBeUndefined();
    expect(await tokens.authenticate(two.token)).toBeUndefined();
    expect(await tokens.authenticate(next.token)).toBeDefined();
  });

  it('is the bound for another process: a revocation it did not see is accepted until the entry expires', async () => {
    const { kernel, tokens, actor } = await cached();
    const { token } = await tokens.create(actor, { name: 'ci' });
    await tokens.authenticate(token);
    await kernel.pool.query('update identity_token set revoked_at = now()'); // "another process"
    expect(await tokens.authenticate(token)).toBeDefined(); // within the TTL
  });

  it('does not outlive the token’s own expiry', async () => {
    const { kernel, tokens, actor } = await cached();
    const { token } = await tokens.create(actor, { name: 'ci', expiresAt: future() });
    await tokens.authenticate(token);
    await kernel.pool.query(`update identity_token set expires_at = now() - interval '1 second'`);
    // The cached entry still has the old expiry, so this one is the other process's bound too:
    expect(await tokens.authenticate(token)).toBeDefined();
    const { token: short } = await tokens.create(actor, {
      name: 'short',
      expiresAt: new Date(Date.now() + 50).toISOString(),
    });
    await tokens.authenticate(short);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await tokens.authenticate(short)).toBeUndefined();
  });

  it('never caches a wrong token', async () => {
    const { kernel, tokens, actor } = await cached();
    const { token, prefix } = await tokens.create(actor, { name: 'ci' });
    const wrong = `scp_${prefix}_${'A'.repeat(43)}`;
    expect(await tokens.authenticate(wrong)).toBeUndefined();
    expect(await tokens.authenticate(token)).toBeDefined();
    expect(await tokens.authenticate(wrong)).toBeUndefined();
    void kernel;
  });
});

async function failOutbox(kernel: { pool: Pool }) {
  await kernel.pool.query(`
    create function identity_test_fail() returns trigger language plpgsql as
      $$ begin raise exception 'outbox on fire'; end $$;
    create trigger identity_test_fail before insert on kernel_outbox
      for each row execute function identity_test_fail();`);
}

describe('scopes are permission ids', () => {
  it('needs at least one scope, and every scope must be a permission some loaded module declares', async () => {
    const { kernel, identity: id, actor } = await start();
    // The raw service, without the default scope.
    const raw = id.tokens;
    await expect(raw.create(actor, { name: 'a' })).rejects.toBeInstanceOf(Invalid);
    await expect(raw.create(actor, { name: 'a', scopes: [] })).rejects.toBeInstanceOf(Invalid);
    await expect(raw.create(actor, { name: 'a', scopes: ['read:kpi'] })).rejects.toBeInstanceOf(
      Invalid,
    );
    await expect(
      raw.create(actor, { name: 'a', scopes: [SCOPE, 'core.identity.nothing.here'] }),
    ).rejects.toMatchObject({
      errors: [
        {
          path: 'scopes',
          message: expect.stringContaining('core.identity.nothing.here') as unknown,
        },
      ],
    });
    expect(await rows(kernel, 'select * from identity_token')).toEqual([]);
    await expect(
      raw.create(actor, { name: 'a', scopes: [SCOPE, OTHER_SCOPE] }),
    ).resolves.toBeTruthy();
  });

  it('accepts a scope the owner does not hold: it simply grants nothing', async () => {
    const { identity: id, actor } = await start();
    await expect(
      id.tokens.create(actor, { name: 'admin-only', scopes: ['core.identity.role.assign'] }),
    ).resolves.toMatchObject({ scopes: ['core.identity.role.assign'] });
  });
});

describe('the second check, with core.authz', () => {
  it('denies a user without the role on every token method, and changes nothing', async () => {
    const { kernel, identity: id } = await identity.start({ tokenCacheTtlMs: 0 });
    const roleless = await makeUser(kernel.pool);
    const actor = actorOf(roleless);
    await expect(id.tokens.create(actor, { name: 'a', scopes: [SCOPE] })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(id.tokens.list(actor, page)).rejects.toBeInstanceOf(Forbidden);
    await expect(id.tokens.revoke(actor, randomUUID())).rejects.toBeInstanceOf(Forbidden);
    await expect(id.tokens.rotate(actor, randomUUID(), {})).rejects.toBeInstanceOf(Forbidden);
    expect(await rows(kernel, 'select * from identity_token')).toEqual([]);
    expect(await rows(kernel, 'select * from kernel_outbox')).toEqual([]);
  });

  it('lets only core.identity.token.manage-any revoke the token of somebody else, and says who did it', async () => {
    const { kernel, identity: id, owner, actor } = await start();
    const created = await id.tokens.create(actor, { name: 'mine', scopes: [SCOPE] });
    const plain = actorOf(await holder(kernel.pool));
    // A plain user: the same 404 as for an unknown id, and the token still works.
    await expect(id.tokens.revoke(plain, created.id)).rejects.toBeInstanceOf(NotFound);
    expect(await id.tokens.authenticate(created.token)).toBeDefined();

    const adminUser = await holder(kernel.pool);
    await makeRoleAssignment(kernel.pool, adminUser, 'admin');
    await id.tokens.revoke(actorOf(adminUser), created.id);
    expect(await id.tokens.authenticate(created.token)).toBeUndefined();
    const events = await rows(
      kernel,
      "select payload from kernel_outbox where name = 'identity.token.revoked@1'",
    );
    expect(events).toEqual([
      {
        payload: { userId: owner.id, tokenId: created.id, name: 'mine', revokedBy: adminUser.id },
      },
    ]);
    // Still not for listing or rotating somebody else's: the secret would go to the administrator.
    const again = await id.tokens.create(actor, { name: 'again', scopes: [SCOPE] });
    await expect(id.tokens.rotate(actorOf(adminUser), again.id, {})).rejects.toBeInstanceOf(
      NotFound,
    );
  });
});
