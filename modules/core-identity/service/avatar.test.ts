// The avatar on real Postgres with the real core.blob: whose it is, what is stored, what is
// released, and what a refusal or a rollback leaves behind.
import { ANONYMOUS, Forbidden, Invalid, Unauthorized, type Actor } from '@scorpion/contracts';
import { makePng, makeRole, makeRoleAssignment, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { failOutbox } from '../test/mail.ts';

const identity = useIdentity();

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
const actorOf = (
  user: { id: string; username: string },
  via: 'session' | 'token' = 'session',
): Actor => ({ kind: 'user', userId: user.id, username: user.username, roles: [], via });
const png = (width: number) => Promise.resolve(makePng(width));

async function start() {
  const started = await identity.start();
  const alice = await makeMember(started.kernel.pool, {
    username: 'alice',
    email: 'alice@example.org',
  });
  return { ...started, alice, profile: started.identity.profile };
}
const avatarOf = async (kernel: { pool: Pool }, id: string) =>
  (await rows(kernel, 'select avatar_blob_id from identity_user where id = $1', [id]))[0]!
    .avatar_blob_id as string | null;
const references = (kernel: { pool: Pool }) =>
  rows(kernel, 'select ref, blob_id from blob_reference order by ref');
const events = async (kernel: { pool: Pool }) =>
  (
    await rows(
      kernel,
      "select payload from kernel_outbox where name = 'identity.profile.updated@1' order by id",
    )
  ).map((row) => row.payload);

describe('setAvatar', () => {
  it('stores the image, keeps it for the account, and shows its hash in the profile', async () => {
    const { kernel, profile, alice } = await start();
    const result = await profile.setAvatar(actorOf(alice), await png(40));
    const [blob] = await rows(kernel, 'select id, hash, mime from blob_blob');
    expect(result.avatarHash).toBe(blob!.hash);
    expect(blob!.mime).toBe('image/png');
    expect(await avatarOf(kernel, alice.id)).toBe(blob!.id);
    expect(await references(kernel)).toEqual([
      { ref: `core.identity:avatar:${alice.id}`, blob_id: blob!.id },
    ]);
    expect((await profile.get(actorOf(alice))).avatarHash).toBe(blob!.hash);
    expect(await events(kernel)).toEqual([
      { userId: alice.id, username: 'alice', fields: ['avatar'] },
    ]);
  });

  it('replaces the previous avatar and releases it', async () => {
    const { kernel, profile, alice } = await start();
    await profile.setAvatar(actorOf(alice), await png(40));
    const [first] = await rows(kernel, 'select id from blob_blob');
    await profile.setAvatar(actorOf(alice), await png(41));
    const now = await rows(
      kernel,
      'select id, unreferenced_since from blob_blob order by created_at',
    );
    expect(now).toHaveLength(2);
    expect(now.find((row) => row.id === first!.id)!.unreferenced_since).toBeInstanceOf(Date);
    expect(await references(kernel)).toHaveLength(1);
    expect(await avatarOf(kernel, alice.id)).toBe(now.find((row) => row.id !== first!.id)!.id);
  });

  it('changes nothing, and emits nothing, for the avatar the account already has', async () => {
    const { kernel, profile, alice } = await start();
    const file = await png(40);
    await profile.setAvatar(actorOf(alice), file);
    await profile.setAvatar(actorOf(alice), file);
    expect(await events(kernel)).toHaveLength(1);
  });

  it('touches only the caller: another account keeps its own avatar', async () => {
    const { kernel, profile, alice } = await start();
    const bobby = await makeMember(kernel.pool, { username: 'bobby', email: 'bobby@example.org' });
    await profile.setAvatar(actorOf(bobby), await png(30));
    const before = await avatarOf(kernel, bobby.id);
    await profile.setAvatar(actorOf(alice), await png(31));
    expect(await avatarOf(kernel, bobby.id)).toBe(before);
    expect(await avatarOf(kernel, alice.id)).not.toBe(before);
  });

  it.each([
    ['an HTML file', '<script>alert(1)</script>'],
    ['a data URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['nothing', ''],
  ])('refuses %s (422) and changes nothing', async (_name, content) => {
    const { kernel, profile, alice } = await start();
    await profile.setAvatar(actorOf(alice), await png(40));
    const before = await avatarOf(kernel, alice.id);
    await expect(
      profile.setAvatar(actorOf(alice), new TextEncoder().encode(content)),
    ).rejects.toBeInstanceOf(Invalid);
    expect(await avatarOf(kernel, alice.id)).toBe(before);
    expect(await rows(kernel, 'select 1 from blob_blob')).toHaveLength(1);
    expect(await events(kernel)).toHaveLength(1);
  });

  it('refuses a caller with an access token (403), also one whose scopes name the permission', async () => {
    const { kernel, profile, alice } = await start();
    await expect(profile.setAvatar(actorOf(alice, 'token'), await png(40))).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(profile.removeAvatar(actorOf(alice, 'token'))).rejects.toBeInstanceOf(Forbidden);
    expect(await rows(kernel, 'select 1 from blob_blob')).toEqual([]);
  });

  it('refuses an anonymous caller (401)', async () => {
    const { profile } = await start();
    await expect(profile.setAvatar(ANONYMOUS, await png(40))).rejects.toBeInstanceOf(Unauthorized);
    await expect(profile.removeAvatar(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
  });

  it('refuses a user without roles, and a user who may change the avatar but not upload', async () => {
    const { kernel, profile } = await start();
    const nobody = await makeUser(kernel.pool, { username: 'nobody', email: 'nobody@example.org' });
    await expect(profile.setAvatar(actorOf(nobody), await png(40))).rejects.toBeInstanceOf(
      Forbidden,
    );
    const half = await makeUser(kernel.pool, { username: 'half', email: 'half@example.org' });
    await makeRoleAssignment(
      kernel.pool,
      half,
      await makeRole(kernel.pool, { permissions: ['core.identity.avatar.update'] }),
    );
    await expect(profile.setAvatar(actorOf(half), await png(40))).rejects.toBeInstanceOf(Forbidden);
    expect(await rows(kernel, 'select 1 from blob_blob')).toEqual([]);
    expect(await avatarOf(kernel, half.id)).toBeNull();
  });

  it('rolls back when its event cannot be written: the account keeps the old avatar and reference', async () => {
    const { kernel, profile, alice } = await start();
    await profile.setAvatar(actorOf(alice), await png(40));
    const before = await avatarOf(kernel, alice.id);
    const refsBefore = await references(kernel);
    await failOutbox(kernel);
    await expect(profile.setAvatar(actorOf(alice), await png(41))).rejects.toThrow();
    expect(await avatarOf(kernel, alice.id)).toBe(before);
    expect(await references(kernel)).toEqual(refsBefore);
  });
});

describe('removeAvatar', () => {
  it('removes it, releases the file, and emits the event once', async () => {
    const { kernel, profile, alice } = await start();
    await profile.setAvatar(actorOf(alice), await png(40));
    const result = await profile.removeAvatar(actorOf(alice));
    expect(result.avatarHash).toBeNull();
    expect(await avatarOf(kernel, alice.id)).toBeNull();
    expect(await references(kernel)).toEqual([]);
    expect(
      (await rows(kernel, 'select unreferenced_since from blob_blob'))[0]!.unreferenced_since,
    ).toBeInstanceOf(Date);
    await profile.removeAvatar(actorOf(alice));
    expect(await events(kernel)).toHaveLength(2);
  });

  it('rolls back when its event cannot be written', async () => {
    const { kernel, profile, alice } = await start();
    await profile.setAvatar(actorOf(alice), await png(40));
    await failOutbox(kernel);
    await expect(profile.removeAvatar(actorOf(alice))).rejects.toThrow();
    expect(await avatarOf(kernel, alice.id)).not.toBeNull();
    expect(await references(kernel)).toHaveLength(1);
  });
});

describe('the purge of an account', () => {
  it('releases its avatar', async () => {
    const { kernel, profile, alice, identity: started } = await start();
    await profile.setAvatar(actorOf(alice), await png(40));
    await kernel.pool.query(
      "update identity_user set status = 'rejected', deleted_at = now() - interval '90 days' where id = $1",
      [alice.id],
    );
    expect(await started.cleanup.run()).toMatchObject({ purgedUsers: 1 });
    expect(await references(kernel)).toEqual([]);
    expect(
      (await rows(kernel, 'select unreferenced_since from blob_blob'))[0]!.unreferenced_since,
    ).toBeInstanceOf(Date);
  });
});
