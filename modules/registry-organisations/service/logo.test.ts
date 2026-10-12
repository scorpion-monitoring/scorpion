// The logo through core.blob, over real Postgres: who may set it, what is stored, what is kept alive,
// and that a failure leaves the row, the reference and the file as they were.
import { Forbidden, Invalid, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import { JPEG_EXIF_MARK, makeJpegWithExif, makeOrganisation, makePng } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useOrganisations } from '../test/harness.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

async function setup() {
  const s = await h.start();
  const admin = await s.actor('admin');
  const user = await s.actor('user');
  return { ...s, admin, user };
}
type Pool = Awaited<ReturnType<typeof setup>>['pool'];

/** Makes the outbox refuse an insert, so the event of a write cannot be stored. */
async function breakOutbox(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_outbox() returns trigger as $$
    begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_outbox before insert on kernel_outbox
      for each row execute function test_break_outbox();`);
  return () => pool.query('drop trigger test_break_outbox on kernel_outbox');
}

const blobs = async (pool: Pool) =>
  (
    await pool.query<{ id: string; hash: string; data: Buffer; held: boolean }>(
      `select b.id, b.hash, b.data, b.unreferenced_since is null as held from blob_blob b order by b.created_at, b.id`,
    )
  ).rows;
const references = async (pool: Pool) =>
  (await pool.query<{ ref: string; blob_id: string }>('select ref, blob_id from blob_reference'))
    .rows;
const row = async (pool: Pool, id: string) =>
  (
    await pool.query<{ logo_blob_id: string | null; logo_hash: string | null; updated_at: Date }>(
      'select logo_blob_id, logo_hash, updated_at from org_organisation where id = $1',
      [id],
    )
  ).rows[0]!;
const ref = (id: string) => `registry.organisations:logo:${id}`;

describe('setLogo', () => {
  it('stores a PNG, keeps it alive under the organisation, and shows logoUrl', async () => {
    const { organisations, pool, admin, events } = await setup();
    const org = await makeOrganisation(pool);
    const view = await organisations.setLogo(admin, org.id, makePng(24));
    const [stored] = await blobs(pool);
    expect(stored).toMatchObject({ held: true });
    expect(view.logoUrl).toBe(`/api/internal/files/${stored!.hash}`);
    expect(await references(pool)).toEqual([{ ref: ref(org.id), blob_id: stored!.id }]);
    expect(await row(pool, org.id)).toMatchObject({
      logo_blob_id: stored!.id,
      logo_hash: stored!.hash,
    });
    expect((await organisations.get(admin, org.id)).logoUrl).toBe(view.logoUrl);
    // The event names the field, never the hash or the URL.
    expect(await events()).toEqual([
      {
        name: 'registry.organisation.updated@1',
        payload: {
          organisationId: org.id,
          fields: ['logo'],
          by: 'admin',
          actorId: admin.userId,
        },
      },
    ]);
  });

  it('strips the EXIF block of a JPEG', async () => {
    const { organisations, pool, admin } = await setup();
    const org = await makeOrganisation(pool);
    expect(makeJpegWithExif().toString('latin1')).toContain(JPEG_EXIF_MARK);
    await organisations.setLogo(admin, org.id, makeJpegWithExif());
    const [stored] = await blobs(pool);
    expect(stored!.data.toString('latin1')).not.toContain(JPEG_EXIF_MARK);
  });

  it('sanitises an SVG that carries a script', async () => {
    const { organisations, pool, admin } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(
      admin,
      org.id,
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4"/></svg>',
      ),
    );
    const data = (await blobs(pool))[0]!.data.toString();
    expect(data).toContain('<rect');
    expect(data).not.toMatch(/script|alert|onload/);
  });

  it.each([
    ['a text file that is named .png', Buffer.from('<html>not an image</html>')],
    ['an empty body', Buffer.alloc(0)],
    ['a data URL', Buffer.from('data:image/png;base64,iVBORw0KGgo=')],
  ])('refuses %s (422), stores no file and changes nothing', async (_name, bytes) => {
    const { organisations, pool, admin, events } = await setup();
    const org = await makeOrganisation(pool);
    await expect(organisations.setLogo(admin, org.id, bytes)).rejects.toBeInstanceOf(Invalid);
    expect(await blobs(pool)).toEqual([]);
    expect(await references(pool)).toEqual([]);
    expect(await row(pool, org.id)).toMatchObject({ logo_blob_id: null, logo_hash: null });
    expect(await events()).toEqual([]);
  });

  it('is denied to a plain user and to an anonymous caller, and leaves no file behind', async () => {
    const { organisations, pool, user, actor } = await setup();
    const org = await makeOrganisation(pool);
    await expect(organisations.setLogo(user, org.id, makePng())).rejects.toBeInstanceOf(Forbidden);
    await expect(organisations.setLogo(await actor(), org.id, makePng())).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(organisations.setLogo(anonymous, org.id, makePng())).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(await blobs(pool)).toEqual([]);
    expect(await references(pool)).toEqual([]);
  });

  it('answers 404 for an unknown id and 422 for a bad one, before any file is stored', async () => {
    const { organisations, pool, admin } = await setup();
    await expect(organisations.setLogo(admin, ABSENT, makePng())).rejects.toBeInstanceOf(NotFound);
    await expect(organisations.setLogo(admin, 'nope', makePng())).rejects.toBeInstanceOf(Invalid);
    expect(await blobs(pool)).toEqual([]);
  });

  it('on replacement holds the new file, releases the old one, and emits one event each', async () => {
    const { organisations, pool, admin, events } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    await organisations.setLogo(admin, org.id, makePng(32));
    const [first, second] = await blobs(pool);
    expect(first).toMatchObject({ held: false }); // removed by the cleanup after the grace period
    expect(second).toMatchObject({ held: true });
    expect(await references(pool)).toEqual([{ ref: ref(org.id), blob_id: second!.id }]);
    expect(await row(pool, org.id)).toMatchObject({ logo_hash: second!.hash });
    expect((await events()).map((e) => e.name)).toHaveLength(2);
  });

  it('changes nothing, and emits nothing, for the same image again', async () => {
    const { organisations, pool, admin, events } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    const before = await row(pool, org.id);
    await organisations.setLogo(admin, org.id, makePng(24));
    expect(await row(pool, org.id)).toEqual(before);
    expect(await events()).toHaveLength(1);
    expect(await blobs(pool)).toHaveLength(1);
  });

  it('shares one file between two organisations that have the same logo, and releases each reference alone', async () => {
    const { organisations, pool, admin } = await setup();
    const a = await makeOrganisation(pool);
    const b = await makeOrganisation(pool);
    await organisations.setLogo(admin, a.id, makePng(24));
    await organisations.setLogo(admin, b.id, makePng(24));
    expect(await blobs(pool)).toHaveLength(1);
    await organisations.clearLogo(admin, a.id);
    expect((await blobs(pool))[0]).toMatchObject({ held: true }); // b still holds it
    await organisations.clearLogo(admin, b.id);
    expect((await blobs(pool))[0]).toMatchObject({ held: false });
  });

  it('rolls the reference and the columns back together when the event cannot be stored', async () => {
    const { organisations, pool, admin, events } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    const before = await row(pool, org.id);
    const heldBefore = await references(pool);
    const restore = await breakOutbox(pool);
    await expect(organisations.setLogo(admin, org.id, makePng(32))).rejects.toThrow();
    await restore();
    expect(await row(pool, org.id)).toEqual(before);
    expect(await references(pool)).toEqual(heldBefore);
    expect(await events()).toHaveLength(1);
    // `put` ran first: the new file exists, nothing refers to it, and the cleanup removes it.
    const all = await blobs(pool);
    expect(all).toHaveLength(2);
    expect(all.filter((blob) => !blob.held)).toHaveLength(1);
    expect(all.find((blob) => blob.held)!.id).toBe(before.logo_blob_id);
  });
});

describe('clearLogo', () => {
  it('clears the columns and the reference, and releases the file', async () => {
    const { organisations, pool, admin, events } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    const view = await organisations.clearLogo(admin, org.id);
    expect(view).not.toHaveProperty('logoUrl');
    expect(await row(pool, org.id)).toMatchObject({ logo_blob_id: null, logo_hash: null });
    expect(await references(pool)).toEqual([]);
    expect((await blobs(pool))[0]).toMatchObject({ held: false });
    expect((await events()).at(-1)).toMatchObject({
      name: 'registry.organisation.updated@1',
      payload: { fields: ['logo'] },
    });
  });

  it('answers 404 when there is no logo or no organisation, and 422 for a bad id', async () => {
    const { organisations, pool, admin } = await setup();
    const org = await makeOrganisation(pool);
    await expect(organisations.clearLogo(admin, org.id)).rejects.toBeInstanceOf(NotFound);
    await expect(organisations.clearLogo(admin, ABSENT)).rejects.toBeInstanceOf(NotFound);
    await expect(organisations.clearLogo(admin, 'nope')).rejects.toBeInstanceOf(Invalid);
  });

  it('is denied to a plain user and to an anonymous caller, and keeps the logo', async () => {
    const { organisations, pool, admin, user } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    await expect(organisations.clearLogo(user, org.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(organisations.clearLogo(anonymous, org.id)).rejects.toBeInstanceOf(Unauthorized);
    expect(await references(pool)).toHaveLength(1);
  });

  it('rolls the columns and the reference back when the event cannot be stored', async () => {
    const { organisations, pool, admin } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    const before = await row(pool, org.id);
    const restore = await breakOutbox(pool);
    await expect(organisations.clearLogo(admin, org.id)).rejects.toThrow();
    await restore();
    expect(await row(pool, org.id)).toEqual(before);
    expect(await references(pool)).toHaveLength(1);
    expect((await blobs(pool))[0]).toMatchObject({ held: true });
  });
});

describe('deleting an organisation with a logo', () => {
  it('releases the reference in the delete’s transaction', async () => {
    const { organisations, pool, admin } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    await organisations.delete(admin, org.id);
    expect(await references(pool)).toEqual([]);
    expect((await blobs(pool))[0]).toMatchObject({ held: false });
  });

  it('keeps the reference when the delete rolls back', async () => {
    const { organisations, pool, admin } = await setup();
    const org = await makeOrganisation(pool);
    await organisations.setLogo(admin, org.id, makePng(24));
    const restore = await breakOutbox(pool);
    await expect(organisations.delete(admin, org.id)).rejects.toThrow();
    await restore();
    expect(await references(pool)).toEqual([
      { ref: ref(org.id), blob_id: expect.any(String) as string },
    ]);
    expect((await blobs(pool))[0]).toMatchObject({ held: true });
    expect(await row(pool, org.id)).toMatchObject({ logo_blob_id: expect.any(String) as string });
  });
});
