// The icon through core.blob, over real Postgres: who may set it, what is stored, what is kept alive, that a
// denied caller leaves no file, and that a failure leaves the row, the reference and the file as they were
// (the template is the organisation's logo, `logo.test.ts`).
import { Forbidden, Invalid, NotFound, Unauthorized } from '@scorpion/contracts';
import { JPEG_EXIF_MARK, makeJpegWithExif, makePng, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useServices } from '../test/harness.ts';
import { anonymous, rejection, world, type World } from '../test/world.ts';

const h = useServices();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

const blobs = async (pool: World['pool']) =>
  (
    await pool.query<{ id: string; hash: string; data: Buffer; held: boolean }>(
      `select b.id, b.hash, b.data, b.unreferenced_since is null as held from blob_blob b order by b.created_at, b.id`,
    )
  ).rows;
const references = async (pool: World['pool']) =>
  (await pool.query<{ ref: string; blob_id: string }>('select ref, blob_id from blob_reference'))
    .rows;
const ref = (id: string) => `registry.services:icon:${id}`;

describe('setIcon', () => {
  it('stores a PNG for a member, keeps it alive under the service, shows iconUrl, and names only the field in the event', async () => {
    const w = await world(h);
    const view = await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    const [stored] = await blobs(w.pool);
    expect(stored).toMatchObject({ held: true });
    expect(view.iconUrl).toBe(`/api/internal/files/${stored!.hash}`);
    expect(await references(w.pool)).toEqual([{ ref: ref(w.svc.id), blob_id: stored!.id }]);
    expect(await w.row()).toMatchObject({ icon_blob_id: stored!.id, icon_hash: stored!.hash });
    expect((await w.services.get(w.people.plain, w.svc.id)).iconUrl).toBe(view.iconUrl);
    const updated = (await w.events()).filter((e) => e.name === 'registry.service.updated@1');
    expect(updated).toEqual([
      {
        name: 'registry.service.updated@1',
        payload: {
          serviceId: w.svc.id,
          fields: ['icon'],
          by: 'member',
          actorId: w.people.member.userId,
        },
      },
    ]);
    expect(JSON.stringify(updated)).not.toContain(stored!.hash);
  });

  it.each([
    ['manager', 'manager'],
    ['admin', 'admin'],
  ] as const)('stores an icon for %s and says by: %s', async (who, by) => {
    const w = await world(h);
    await w.services.setIcon(w.people[who], w.svc.id, makePng(24));
    const [event] = (await w.events()).filter((e) => e.name === 'registry.service.updated@1');
    expect(event!.payload.by).toBe(by);
  });

  it('strips the EXIF block of a JPEG', async () => {
    const w = await world(h);
    expect(makeJpegWithExif().toString('latin1')).toContain(JPEG_EXIF_MARK);
    await w.services.setIcon(w.people.member, w.svc.id, makeJpegWithExif());
    expect((await blobs(w.pool))[0]!.data.toString('latin1')).not.toContain(JPEG_EXIF_MARK);
  });

  it('sanitises an SVG that carries a script', async () => {
    const w = await world(h);
    await w.services.setIcon(
      w.people.member,
      w.svc.id,
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4"/></svg>',
      ),
    );
    const data = (await blobs(w.pool))[0]!.data.toString();
    expect(data).toContain('<rect');
    expect(data).not.toMatch(/script|alert|onload/);
  });

  it.each([
    ['a text file that is named .png', Buffer.from('<html>not an image</html>')],
    ['an empty body', Buffer.alloc(0)],
    ['a data URL', Buffer.from('data:image/png;base64,iVBORw0KGgo=')],
  ])('refuses %s (422), stores no file and changes nothing', async (_name, bytes) => {
    const w = await world(h);
    await expect(w.services.setIcon(w.people.member, w.svc.id, bytes)).rejects.toBeInstanceOf(
      Invalid,
    );
    expect(await blobs(w.pool)).toEqual([]);
    expect(await references(w.pool)).toEqual([]);
    expect(await w.row()).toMatchObject({ icon_blob_id: null, icon_hash: null });
    expect((await w.events()).filter((e) => e.name.startsWith('registry.service.u'))).toEqual([]);
  });

  it.each(['plain', 'reviewer', 'requested', 'rejected', 'left', 'managerElsewhere'] as const)(
    'is denied to %s before the file is stored: no blob, no reference, no change [ASVS-8.2.1]',
    async (who) => {
      const w = await world(h);
      await expect(w.services.setIcon(w.people[who], w.svc.id, makePng())).rejects.toBeInstanceOf(
        Forbidden,
      );
      expect(await blobs(w.pool)).toEqual([]);
      expect(await references(w.pool)).toEqual([]);
      expect(await w.row()).toMatchObject({ icon_blob_id: null });
    },
  );

  it('is denied to an anonymous caller (401) and leaves no file behind', async () => {
    const w = await world(h);
    await expect(w.services.setIcon(anonymous, w.svc.id, makePng())).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(await blobs(w.pool)).toEqual([]);
  });

  it('is denied to a manager the moment they leave the provider, and to a member of another service’s provider [ASVS-8.2.2]', async () => {
    const w = await world(h);
    const theirs = await makeService(w.pool, { provider: w.other.id });
    await expect(
      w.services.setIcon(w.people.managerElsewhere, w.svc.id, makePng()),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.setIcon(w.people.managerElsewhere, theirs.id, makePng(24)),
    ).resolves.toBeDefined();
    await w.pool.query(
      "update org_membership set state = 'left', role = 'member' where user_id = $1",
      [w.people.manager.userId],
    );
    await expect(
      w.services.setIcon(w.people.manager, w.svc.id, makePng(32)),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await blobs(w.pool)).toHaveLength(1); // only the one for their own service
  });

  it('answers 404 for an unknown id and 422 for a bad one, before any file is stored', async () => {
    const w = await world(h);
    await expect(w.services.setIcon(w.people.admin, ABSENT, makePng())).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(w.services.setIcon(w.people.plain, ABSENT, makePng())).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(w.services.setIcon(w.people.admin, 'nope', makePng())).rejects.toBeInstanceOf(
      Invalid,
    );
    expect(await blobs(w.pool)).toEqual([]);
  });

  it('on replacement holds the new file, releases the old one, and emits one event each', async () => {
    const w = await world(h);
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    await w.services.setIcon(w.people.member, w.svc.id, makePng(32));
    const [first, second] = await blobs(w.pool);
    expect(first).toMatchObject({ held: false });
    expect(second).toMatchObject({ held: true });
    expect(await references(w.pool)).toEqual([{ ref: ref(w.svc.id), blob_id: second!.id }]);
    expect((await w.events()).filter((e) => e.name === 'registry.service.updated@1')).toHaveLength(
      2,
    );
  });

  it('changes nothing, and emits nothing, for the same image again', async () => {
    const w = await world(h);
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    const before = await w.row();
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    expect(await w.row()).toEqual(before);
    expect((await w.events()).filter((e) => e.name === 'registry.service.updated@1')).toHaveLength(
      1,
    );
    expect(await blobs(w.pool)).toHaveLength(1);
  });

  it('shares one file between two services with the same icon, and releases each reference alone', async () => {
    const w = await world(h);
    const second = await makeService(w.pool, { provider: w.provider.id });
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    await w.services.setIcon(w.people.member, second.id, makePng(24));
    expect(await blobs(w.pool)).toHaveLength(1);
    await w.services.clearIcon(w.people.member, w.svc.id);
    expect((await blobs(w.pool))[0]).toMatchObject({ held: true });
    await w.services.clearIcon(w.people.member, second.id);
    expect((await blobs(w.pool))[0]).toMatchObject({ held: false });
  });

  it('rolls the reference and the columns back together when the event cannot be stored', async () => {
    const w = await world(h);
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    const before = await w.row();
    const held = await references(w.pool);
    const restore = await breakOutbox(w.pool);
    await expect(w.services.setIcon(w.people.member, w.svc.id, makePng(32))).rejects.toThrow();
    await restore();
    expect(await w.row()).toEqual(before);
    expect(await references(w.pool)).toEqual(held);
    const all = await blobs(w.pool);
    expect(all.filter((blob) => !blob.held)).toHaveLength(1); // the new file: nothing refers to it
    expect(all.find((blob) => blob.held)!.id).toBe(before.icon_blob_id);
  });

  it('lets two members set an icon at once: the last write wins and exactly one reference stays', async () => {
    const w = await world(h);
    await Promise.all([
      w.services.setIcon(w.people.member, w.svc.id, makePng(24)),
      w.services.setIcon(w.people.manager, w.svc.id, makePng(32)),
    ]);
    const refs = await references(w.pool);
    expect(refs).toHaveLength(1);
    expect((await w.row()).icon_blob_id).toBe(refs[0]!.blob_id);
  });
});

describe('clearIcon', () => {
  it('clears the columns and the reference, and releases the file', async () => {
    const w = await world(h);
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    const view = await w.services.clearIcon(w.people.member, w.svc.id);
    expect(view).not.toHaveProperty('iconUrl');
    expect(await w.row()).toMatchObject({ icon_blob_id: null, icon_hash: null });
    expect(await references(w.pool)).toEqual([]);
    expect((await blobs(w.pool))[0]).toMatchObject({ held: false });
    expect((await w.events()).at(-1)).toMatchObject({
      name: 'registry.service.updated@1',
      payload: { fields: ['icon'] },
    });
  });

  it('answers 404 when there is no icon or no service, and 422 for a bad id', async () => {
    const w = await world(h);
    await expect(w.services.clearIcon(w.people.admin, w.svc.id)).rejects.toBeInstanceOf(NotFound);
    await expect(w.services.clearIcon(w.people.admin, ABSENT)).rejects.toBeInstanceOf(NotFound);
    await expect(w.services.clearIcon(w.people.admin, 'nope')).rejects.toBeInstanceOf(Invalid);
  });

  it('is denied to everybody who may not edit, and to an anonymous caller, and keeps the icon', async () => {
    const w = await world(h);
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    for (const who of ['plain', 'reviewer', 'requested', 'left', 'managerElsewhere'] as const) {
      const error = await rejection(w.services.clearIcon(w.people[who], w.svc.id));
      expect(error, who).toBeInstanceOf(Forbidden);
    }
    await expect(w.services.clearIcon(anonymous, w.svc.id)).rejects.toBeInstanceOf(Unauthorized);
    expect(await references(w.pool)).toHaveLength(1);
  });

  it('rolls the columns and the reference back when the event cannot be stored', async () => {
    const w = await world(h);
    await w.services.setIcon(w.people.member, w.svc.id, makePng(24));
    const before = await w.row();
    const restore = await breakOutbox(w.pool);
    await expect(w.services.clearIcon(w.people.member, w.svc.id)).rejects.toThrow();
    await restore();
    expect(await w.row()).toEqual(before);
    expect(await references(w.pool)).toHaveLength(1);
    expect((await blobs(w.pool))[0]).toMatchObject({ held: true });
  });
});

describe('the icon is not part of an update', () => {
  it('refuses the icon in a patch (422): it has its own routes', async () => {
    const w = await world(h);
    await expect(
      w.services.update(w.people.member, w.svc.id, { icon: 'data:image/png;base64,AAAA' }),
    ).rejects.toBeInstanceOf(Invalid);
    expect(await blobs(w.pool)).toEqual([]);
  });
});
