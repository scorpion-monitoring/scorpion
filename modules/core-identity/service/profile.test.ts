// The profile on real Postgres: reading and editing one's own, the address change that waits for
// its confirmation, and what a refusal or a rollback leaves behind.
import { ANONYMOUS, Forbidden, Invalid, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeAuthMethod } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { failOutbox, tokenFrom } from '../test/mail.ts';
import { TooManyRequests } from './errors.ts';
import { createMemoryMailer } from './mailer.ts';

const identity = useIdentity();

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
const actorOf = (
  user: { id: string; username: string },
  via: 'session' | 'token' = 'session',
): Actor => ({ kind: 'user', userId: user.id, username: user.username, roles: [], via });

async function start() {
  const mailer = createMemoryMailer();
  const started = await identity.start({ mailer });
  const alice = await makeMember(started.kernel.pool, {
    username: 'alice',
    email: 'alice@example.org',
    emailVerified: true,
  });
  await makeAuthMethod(started.kernel.pool, alice);
  return { ...started, mailer, alice, profile: started.identity.profile };
}

describe('get', () => {
  it('shows the caller’s own profile, and only that', async () => {
    const { kernel, profile, alice } = await start();
    await makeMember(kernel.pool, { username: 'bobby', email: 'bobby@example.org' });
    expect(await profile.get(actorOf(alice))).toEqual({
      username: 'alice',
      displayName: null,
      email: 'alice@example.org',
      emailVerified: true,
      pendingEmail: null,
      bio: null,
      avatarHash: null,
    });
  });

  it('refuses an anonymous caller (401) and a caller with an access token (403)', async () => {
    const { profile, alice } = await start();
    await expect(profile.get(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    await expect(profile.get(actorOf(alice, 'token'))).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('update: name and bio', () => {
  it('changes them, trims them, and emits an event with the field names and no values', async () => {
    const { kernel, profile, alice } = await start();
    const result = await profile.update(actorOf(alice), {
      displayName: '  Alice Liddell ',
      bio: 'Line one\r\nLine two\n\tindented  ',
    });
    expect(result).toMatchObject({
      displayName: 'Alice Liddell',
      bio: 'Line one\nLine two\n\tindented',
    });
    expect(
      await rows(
        kernel,
        "select payload from kernel_outbox where name = 'identity.profile.updated@1'",
      ),
    ).toEqual([
      { payload: { userId: alice.id, username: 'alice', fields: ['displayName', 'bio'] } },
    ]);
  });

  it('clears a field with null or an empty text, and leaves the others alone', async () => {
    const { profile, alice } = await start();
    await profile.update(actorOf(alice), { displayName: 'Alice', bio: 'About me' });
    expect(await profile.update(actorOf(alice), { bio: null })).toMatchObject({
      displayName: 'Alice',
      bio: null,
    });
    expect(await profile.update(actorOf(alice), { displayName: '   ' })).toMatchObject({
      displayName: null,
    });
  });

  it('is a no-op, without an event, when nothing changes', async () => {
    const { kernel, profile, alice } = await start();
    await profile.update(actorOf(alice), { displayName: 'Alice' });
    await profile.update(actorOf(alice), { displayName: 'Alice' });
    expect(
      await rows(kernel, "select 1 from kernel_outbox where name = 'identity.profile.updated@1'"),
    ).toHaveLength(1);
  });

  it('changes only the caller’s own row', async () => {
    const { kernel, profile, alice } = await start();
    const bobby = await makeMember(kernel.pool, { username: 'bobby', email: 'bobby@example.org' });
    await profile.update(actorOf(alice), { displayName: 'Alice', bio: 'Mine' });
    expect(
      await rows(kernel, 'select display_name, bio from identity_user where id = $1', [bobby.id]),
    ).toEqual([{ display_name: null, bio: null }]);
  });

  it.each([
    ['nothing at all', {}],
    ['an unknown field', { displayName: 'A', admin: true }],
    ['a username', { username: 'someone-else' }],
    ['a status', { status: 'active' }],
    ['a user id', { userId: '019a0000-0000-7000-8000-000000000000' }],
    ['a name that is too long', { displayName: 'x'.repeat(101) }],
    ['a name with a line break', { displayName: 'two\nlines' }],
    ['a name with a control character', { displayName: 'bell\u0007' }],
    ['a bio that is too long', { bio: 'x'.repeat(2001) }],
    ['a bio with a control character', { bio: 'nul\u0000' }],
    ['a name that is not text', { displayName: 7 }],
    ['an address that is not one', { email: 'nope' }],
  ])('refuses %s (422) and changes nothing', async (_name, input) => {
    const { kernel, profile, alice } = await start();
    await expect(profile.update(actorOf(alice), input)).rejects.toBeInstanceOf(Invalid);
    expect(
      await rows(kernel, 'select display_name, bio from identity_user where id = $1', [alice.id]),
    ).toEqual([{ display_name: null, bio: null }]);
    expect(await rows(kernel, 'select 1 from kernel_outbox')).toEqual([]);
  });

  it('accepts the limits exactly, and keeps markup as plain text', async () => {
    const { profile, alice } = await start();
    const markup = '<script>alert(1)</script> **not bold**';
    const result = await profile.update(actorOf(alice), {
      displayName: 'n'.repeat(100),
      bio: markup + 'x'.repeat(2000 - markup.length),
    });
    expect(result.displayName).toHaveLength(100);
    expect(result.bio).toHaveLength(2000);
    expect(result.bio).toContain('<script>'); // stored as typed; it is rendered as text
  });

  it('refuses an anonymous caller (401) and a caller with an access token (403)', async () => {
    const { profile, alice } = await start();
    await expect(profile.update(ANONYMOUS, { bio: 'x' })).rejects.toBeInstanceOf(Unauthorized);
    await expect(profile.update(actorOf(alice, 'token'), { bio: 'x' })).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('changes nothing when the event cannot be written (rollback)', async () => {
    const { kernel, profile, alice } = await start();
    await failOutbox(kernel);
    await expect(
      profile.update(actorOf(alice), { displayName: 'Alice', bio: 'About' }),
    ).rejects.toThrow();
    expect(
      await rows(kernel, 'select display_name, bio from identity_user where id = $1', [alice.id]),
    ).toEqual([{ display_name: null, bio: null }]);
  });
});

describe('update: the address', () => {
  it('keeps the old address until the new one is confirmed, then swaps it', async () => {
    const { identity: id, mailer, profile, alice } = await start();
    const asked = await profile.update(actorOf(alice), { email: 'New@Example.org' });
    expect(asked).toMatchObject({
      email: 'alice@example.org',
      emailVerified: true,
      pendingEmail: 'New@Example.org',
    });
    expect(mailer.sent.map((m) => [m.kind, m.to])).toEqual([
      ['email-verification', 'New@Example.org'],
    ]);

    await id.recovery.confirmEmail({ token: tokenFrom(mailer.sent[0]) });
    expect(await profile.get(actorOf(alice))).toMatchObject({
      email: 'New@Example.org',
      emailVerified: true,
      pendingEmail: null,
    });
  });

  it('asking again replaces the link that waits, and the old address stays meanwhile', async () => {
    const { identity: id, mailer, profile, alice } = await start();
    await profile.update(actorOf(alice), { email: 'one@example.org' });
    await profile.update(actorOf(alice), { email: 'two@example.org' });
    expect((await profile.get(actorOf(alice))).pendingEmail).toBe('two@example.org');
    await expect(id.recovery.confirmEmail({ token: tokenFrom(mailer.sent[0]) })).rejects.toThrow();
    await id.recovery.confirmEmail({ token: tokenFrom(mailer.sent[1]) });
    expect((await profile.get(actorOf(alice))).email).toBe('two@example.org');
  });

  it('is a no-op for the address the account already has, whatever the case', async () => {
    const { mailer, profile, alice } = await start();
    const result = await profile.update(actorOf(alice), { email: 'ALICE@example.org' });
    expect(result.pendingEmail).toBeNull();
    expect(mailer.sent).toEqual([]);
  });

  it('looks the same for an address another account holds: pending, but no mail, and the link is no use', async () => {
    const { kernel, identity: id, mailer, profile, alice } = await start();
    await makeMember(kernel.pool, {
      username: 'bobby',
      email: 'bobby@example.org',
      emailVerified: true,
    });
    const free = await profile.update(actorOf(alice), { email: 'free@example.org' });
    const taken = await profile.update(actorOf(alice), { email: 'Bobby@Example.org' });
    expect(taken).toEqual({ ...free, pendingEmail: 'Bobby@Example.org' });
    expect(mailer.sent.map((m) => m.to)).toEqual(['free@example.org']); // bobby is not mailed
    expect((await id.users.findByEmail('bobby@example.org'))?.username).toBe('bobby');
  });

  it('answers 429 after five address changes in an hour', async () => {
    const { profile, alice } = await start();
    for (let i = 0; i < 5; i++)
      await profile.update(actorOf(alice), { email: `a${i}@example.org` });
    await expect(
      profile.update(actorOf(alice), { email: 'a9@example.org' }),
    ).rejects.toBeInstanceOf(TooManyRequests);
    // A change of name is not an address change and still works.
    await expect(profile.update(actorOf(alice), { displayName: 'Alice' })).resolves.toBeDefined();
  });

  it('works for an account that has no address yet', async () => {
    const { kernel, identity: id, mailer, profile } = await start();
    const carol = await makeMember(kernel.pool, { username: 'carol', email: null });
    await profile.update(actorOf(carol), { email: 'carol@example.org' });
    await id.recovery.confirmEmail({ token: tokenFrom(mailer.sent[0]) });
    expect(await profile.get(actorOf(carol))).toMatchObject({
      email: 'carol@example.org',
      emailVerified: true,
    });
  });

  it('stores nothing and mails nothing when the event cannot be written (rollback)', async () => {
    const { kernel, mailer, profile, alice } = await start();
    await failOutbox(kernel);
    await expect(profile.update(actorOf(alice), { email: 'new@example.org' })).rejects.toThrow();
    expect(await rows(kernel, 'select 1 from identity_mail_token')).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });
});
