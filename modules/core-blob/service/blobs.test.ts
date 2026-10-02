// References and cleanup (ADR-0018): a stored file lives as long as something refers to it, plus a
// grace period, and the logos of the branding settings are kept in step through an event.
import { randomUUID } from 'node:crypto';
import { Invalid } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { image, useBlob } from '../test/harness.ts';
import { matchesEtag } from '../routes.ts';
import { REFERENCE } from './blobs.ts';

const harness = useBlob();
const HOUR = 3_600_000;

async function setup() {
  const started = await harness.start();
  const member = await started.actorOf('user');
  let n = 20;
  const upload = async () => started.blob.put(member, await image('png', n++, 20));
  const row = async (id: string) =>
    (
      await started.kernel.pool.query<{ unreferenced_since: Date | null }>(
        'select unreferenced_since from blob_blob where id = $1',
        [id],
      )
    ).rows[0];
  const exists = async (id: string) => (await row(id)) !== undefined;
  const refs = async () =>
    (
      await started.kernel.pool.query<{ ref: string; blob_id: string }>(
        'select ref, blob_id from blob_reference order by ref',
      )
    ).rows;
  return { ...started, member, upload, row, exists, refs };
}

const AVATAR = (id: string = randomUUID()) => `core.identity:avatar:${id}`;

describe('REFERENCE', () => {
  it.each([
    ['core.identity:avatar:0198f1c0-7a52-7000-8000-000000000001', true],
    ['core.settings:branding:logo-light', true],
    ['kpi.ingestion:attachment:abc_123.v2', true],
    ['no-colons', false],
    ['two:parts', false],
    ['Core.identity:avatar:1', false],
    ['core.identity:avatar:has space', false],
    ['core.identity:avatar:', false],
    ['core.identity:avatar:' + 'x'.repeat(129), false],
    ['core.identity:avatar:a\nb', false],
  ])('%s is %s', (ref, valid) => {
    expect(REFERENCE.test(ref)).toBe(valid);
  });
});

describe('matchesEtag', () => {
  const etag = '"abc"';
  it.each([
    [undefined, false],
    ['"abc"', true],
    ['W/"abc"', true],
    ['"x", "abc"', true],
    ['*', true],
    ['"abd"', false],
    ['abc', false],
    ['', false],
  ])('%s -> %s', (header, expected) => {
    expect(matchesEtag(header, etag)).toBe(expected);
  });
});

describe('uploads and references', () => {
  it('an upload is unreferenced until something refers to it', async () => {
    const { upload, row, blob } = await setup();
    const info = await upload();
    expect((await row(info.id))!.unreferenced_since).toBeInstanceOf(Date);
    await blob.setReference(AVATAR(), info.id);
    expect((await row(info.id))!.unreferenced_since).toBeNull();
  });

  it('describes a file by id, and says nothing of one that does not exist', async () => {
    const { upload, blob } = await setup();
    const info = await upload();
    expect(await blob.describe(info.id)).toEqual(info);
    expect(await blob.describe(randomUUID())).toBeUndefined();
  });

  it('replacing a reference releases the old file and keeps the new one', async () => {
    const { upload, row, blob, refs } = await setup();
    const [a, b] = [await upload(), await upload()];
    const ref = AVATAR();
    await blob.setReference(ref, a.id);
    await blob.setReference(ref, b.id);
    expect((await row(a.id))!.unreferenced_since).toBeInstanceOf(Date);
    expect((await row(b.id))!.unreferenced_since).toBeNull();
    expect(await refs()).toEqual([{ ref, blob_id: b.id }]);
  });

  it('clearing a reference releases the file, and clearing twice is harmless', async () => {
    const { upload, row, blob, refs } = await setup();
    const a = await upload();
    const ref = AVATAR();
    await blob.setReference(ref, a.id);
    await blob.setReference(ref, null);
    await blob.setReference(ref, null);
    expect((await row(a.id))!.unreferenced_since).toBeInstanceOf(Date);
    expect(await refs()).toEqual([]);
  });

  it('a file two owners hold stays while one of them lets go', async () => {
    const { upload, row, blob } = await setup();
    const a = await upload();
    await blob.setReference(AVATAR('one'), a.id);
    await blob.setReference(AVATAR('two'), a.id);
    await blob.setReference(AVATAR('one'), null);
    expect((await row(a.id))!.unreferenced_since).toBeNull();
    await blob.setReference(AVATAR('two'), null);
    expect((await row(a.id))!.unreferenced_since).toBeInstanceOf(Date);
  });

  it('setting the same reference again changes nothing', async () => {
    const { upload, row, blob } = await setup();
    const a = await upload();
    const ref = AVATAR();
    await blob.setReference(ref, a.id);
    await blob.setReference(ref, a.id);
    expect((await row(a.id))!.unreferenced_since).toBeNull();
  });

  it('refuses a reference to a file that does not exist, and leaves the old one', async () => {
    const { upload, row, blob, refs } = await setup();
    const a = await upload();
    const ref = AVATAR();
    await blob.setReference(ref, a.id);
    await expect(blob.setReference(ref, randomUUID())).rejects.toBeInstanceOf(Invalid);
    expect(await refs()).toEqual([{ ref, blob_id: a.id }]);
    expect((await row(a.id))!.unreferenced_since).toBeNull();
  });

  it('refuses a reference name that is not <module>:<purpose>:<id>', async () => {
    const { upload, blob, refs } = await setup();
    const a = await upload();
    await expect(blob.setReference('anything goes', a.id)).rejects.toThrow(/not a valid reference/);
    expect(await refs()).toEqual([]);
  });

  it("rolls back with the caller's transaction: the reference and the release together", async () => {
    const { upload, row, blob, refs, kernel } = await setup();
    const [a, b] = [await upload(), await upload()];
    const ref = AVATAR();
    await blob.setReference(ref, a.id);
    await expect(
      kernel.db.tx(async () => {
        await blob.setReference(ref, b.id);
        throw new Error('the caller failed after storing the reference');
      }),
    ).rejects.toThrow('the caller failed');
    expect(await refs()).toEqual([{ ref, blob_id: a.id }]);
    expect((await row(a.id))!.unreferenced_since).toBeNull();
    expect((await row(b.id))!.unreferenced_since).toBeInstanceOf(Date);
  });

  it('uploading the same content again restarts the grace period of an unreferenced file, not of a referenced one', async () => {
    const { member, blob, kernel } = await setup();
    const file = await image('png', 33, 33);
    const first = await blob.put(member, file);
    await kernel.pool.query(
      "update blob_blob set unreferenced_since = now() - interval '23 hours' where id = $1",
      [first.id],
    );
    await blob.put(member, file);
    const [fresh] = (
      await kernel.pool.query<{ age: number }>(
        'select extract(epoch from now() - unreferenced_since)::int as age from blob_blob where id = $1',
        [first.id],
      )
    ).rows;
    expect(fresh!.age).toBeLessThan(60);
    await blob.setReference(AVATAR(), first.id);
    await blob.put(member, file);
    expect(
      (
        await kernel.pool.query('select unreferenced_since from blob_blob where id = $1', [
          first.id,
        ])
      ).rows,
    ).toEqual([{ unreferenced_since: null }]);
  });
});

describe('cleanup', () => {
  const age = (
    pool: { query: (text: string, values: unknown[]) => Promise<unknown> },
    id: string,
    hours: number,
  ) =>
    pool.query(
      'update blob_blob set unreferenced_since = now() - make_interval(hours => $2) where id = $1',
      [id, hours],
    );

  it('removes a file nothing refers to once the grace period has passed, and only that', async () => {
    const { upload, exists, blob, kernel, refs } = await setup();
    const [held, young, old, orphan] = [
      await upload(),
      await upload(),
      await upload(),
      await upload(),
    ];
    await blob.setReference(AVATAR(), held.id);
    await age(kernel.pool, young.id, 23);
    await age(kernel.pool, old.id, 25);
    // `orphan` was uploaded and never referenced; it is as young as the upload
    expect(await blob.blobs.cleanup()).toEqual({ removed: 1 });
    expect(await exists(held.id)).toBe(true);
    expect(await exists(young.id)).toBe(true);
    expect(await exists(old.id)).toBe(false);
    expect(await exists(orphan.id)).toBe(true);
    expect(await refs()).toHaveLength(1);
  });

  it('removes a file whose last reference was released, after the grace period', async () => {
    const { upload, exists, blob, kernel } = await setup();
    const a = await upload();
    const ref = AVATAR();
    await blob.setReference(ref, a.id);
    await blob.setReference(ref, null);
    expect(await blob.blobs.cleanup()).toEqual({ removed: 0 }); // released just now
    await age(kernel.pool, a.id, 25);
    expect(await blob.blobs.cleanup()).toEqual({ removed: 1 });
    expect(await exists(a.id)).toBe(false);
  });

  it('never removes a file that is referenced, however old its mark says it is', async () => {
    const { upload, exists, blob, kernel } = await setup();
    const a = await upload();
    await blob.setReference(AVATAR(), a.id);
    await age(kernel.pool, a.id, 1000); // a stale mark must not matter: the reference does
    expect(await blob.blobs.cleanup()).toEqual({ removed: 0 });
    expect(await exists(a.id)).toBe(true);
  });

  it('uses the grace period of the settings', async () => {
    const { upload, exists, blob, kernel, configure } = await setup();
    await configure({ unreferencedGraceHours: 2 });
    const a = await upload();
    await age(kernel.pool, a.id, 3);
    expect(await blob.blobs.cleanup()).toEqual({ removed: 1 });
    expect(await exists(a.id)).toBe(false);
  });

  it('works through more than one batch', async () => {
    const { blob, kernel } = await setup();
    await kernel.pool.query(
      `insert into blob_blob (id, hash, mime, size, data, unreferenced_since)
       select gen_random_uuid(), md5(g::text) || md5((g + 1)::text), 'image/png', 1, '\\x00', now() - interval '48 hours'
         from generate_series(1, 450) g`,
    );
    expect(await blob.blobs.cleanup()).toEqual({ removed: 450 });
    expect((await kernel.pool.query('select count(*)::int as n from blob_blob')).rows).toEqual([
      { n: 0 },
    ]);
  });

  it('skips a file another connection has locked (a reference being set), instead of waiting or removing it', async () => {
    const { upload, exists, blob, kernel } = await setup();
    const a = await upload();
    await age(kernel.pool, a.id, 48);
    const other = await kernel.pool.connect();
    try {
      await other.query('begin');
      await other.query('select 1 from blob_blob where id = $1 for update', [a.id]);
      expect(await blob.blobs.cleanup()).toEqual({ removed: 0 });
      await other.query('rollback');
    } finally {
      other.release();
    }
    expect(await exists(a.id)).toBe(true);
    expect(await blob.blobs.cleanup()).toEqual({ removed: 1 });
  });
});

describe('the logos of the branding settings', () => {
  const HASH_OF = async (started: Awaited<ReturnType<typeof setup>>, width: number) => {
    const info = await started.blob.put(started.member, await image('png', width, width));
    return info;
  };
  const save = async (
    started: Awaited<ReturnType<typeof setup>>,
    logos: Record<string, string>,
  ) => {
    const admin = await started.actorOf('admin');
    const current = await started.settings.settings.get(admin, 'core.settings');
    await started.settings.settings.update(admin, 'core.settings', {
      version: current.version,
      values: { ...(current.values as object), branding: { logos } },
    });
    await started.deliver();
  };

  it('keeps a logo that the settings name, and lets it go when they stop naming it', async () => {
    const started = await setup();
    const [light, dark] = [await HASH_OF(started, 31), await HASH_OF(started, 32)];
    await save(started, { light: light.hash, dark: dark.hash });
    expect(await started.refs()).toEqual([
      { ref: 'core.settings:branding:logo-dark', blob_id: dark.id },
      { ref: 'core.settings:branding:logo-light', blob_id: light.id },
    ]);
    expect((await started.row(light.id))!.unreferenced_since).toBeNull();
    await save(started, { light: dark.hash });
    expect(await started.refs()).toEqual([
      { ref: 'core.settings:branding:logo-light', blob_id: dark.id },
    ]);
    expect((await started.row(light.id))!.unreferenced_since).toBeInstanceOf(Date);
    await save(started, {});
    expect(await started.refs()).toEqual([]);
  });

  it('warns, with the slot and not the hash, about a logo that is not stored, and refers to nothing', async () => {
    const started = await setup();
    const missing = 'c'.repeat(64);
    await save(started, { light: missing });
    expect(await started.refs()).toEqual([]);
    const warning = started.logs.find((line) => line.includes('names a file that is not stored'));
    expect(warning).toBeDefined();
    expect(warning).toContain('"slot":"light"');
    expect(warning).not.toContain(missing);
  });

  it('brings the references up to date when the module starts', async () => {
    const started = await setup();
    const logo = await HASH_OF(started, 40);
    await started.kernel.pool.query(
      `insert into settings_setting (module_id, value) values ('core.settings', $1)`,
      [JSON.stringify({ branding: { logos: { dark: logo.hash } } })],
    );
    const restarted = await harness.start({ databaseUrl: started.databaseUrl });
    const rows = await restarted.kernel.pool.query('select ref from blob_reference');
    expect(rows.rows).toEqual([{ ref: 'core.settings:branding:logo-dark' }]);
  });

  it('ignores a change of other settings', async () => {
    const started = await setup();
    const logo = await HASH_OF(started, 41);
    await save(started, { light: logo.hash });
    const admin = await started.actorOf('admin');
    const current = await started.settings.settings.get(admin, 'core.settings');
    await started.settings.settings.update(admin, 'core.settings', {
      version: current.version,
      values: {
        ...(current.values as object),
        rateLimits: { default: { burst: 5, perMinute: 5 } },
      },
    });
    await started.deliver();
    expect(await started.refs()).toHaveLength(1);
  });
});
