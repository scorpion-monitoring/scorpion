// What happens to hostile and ordinary uploads. The service is `put` of the real module over real
// Postgres; the inputs are real files (made with sharp) and hand-built attacks. The point of each
// case is what is stored, or that nothing is.
import { createHash } from 'node:crypto';
import { Forbidden, Invalid, Unauthorized } from '@scorpion/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { bytesOf, image, pngBomb, useBlob } from '../test/harness.ts';

const harness = useBlob();
const ANONYMOUS = { kind: 'anonymous' } as const;

async function setup() {
  const started = await harness.start();
  return { ...started, member: await started.actorOf('user'), nobody: await started.actorOf() };
}
const stored = async (pool: { query: (text: string) => Promise<{ rows: unknown[] }> }) =>
  (await pool.query('select hash, mime, size, data from blob_blob')).rows as {
    hash: string;
    mime: string;
    size: number;
    data: Buffer;
  }[];
const count = async (pool: { query: (text: string) => Promise<{ rows: unknown[] }> }) =>
  (await stored(pool)).length;
const text = (data: Buffer) => data.toString('latin1');

describe('a normal upload', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('stores a %s as %s, named by the hash of what is stored', async (format, mime) => {
    const { blob, member, kernel } = await setup();
    const info = await blob.put(member, await image(format, 40, 30));
    expect(info.mime).toBe(mime);
    const [row] = await stored(kernel.pool);
    expect(row!.hash).toBe(createHash('sha256').update(row!.data).digest('hex'));
    expect(info).toMatchObject({ hash: row!.hash, size: row!.size });
    expect(await sharp(row!.data).metadata()).toMatchObject({ width: 40, height: 30 });
  });

  it('stores a GIF as a PNG: only the first frame, written again', async () => {
    const { blob, member } = await setup();
    const info = await blob.put(member, await image('gif', 12, 12));
    expect(info.mime).toBe('image/png');
  });

  it('stores identical content once, and returns the same file', async () => {
    const { blob, member, kernel } = await setup();
    const file = await image('png', 20, 20);
    const first = await blob.put(member, file);
    const second = await blob.put(member, file);
    expect(second).toEqual(first);
    expect(await count(kernel.pool)).toBe(1);
  });

  it('stores an SVG as sanitised text with the SVG type', async () => {
    const { blob, member, kernel } = await setup();
    const info = await blob.put(
      member,
      bytesOf(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
      ),
    );
    expect(info.mime).toBe('image/svg+xml');
    expect(text((await stored(kernel.pool))[0]!.data)).toContain('<rect');
  });
});

describe('metadata and size of an image', () => {
  it('strips EXIF (a copyright, a GPS-like description) from a JPEG', async () => {
    const { blob, member, kernel } = await setup();
    const marked = await image('jpeg', 30, 30, {
      exif: { IFD0: { Copyright: 'SECRET-OWNER-MARK', ImageDescription: 'SECRET-GPS-NOTE' } },
    });
    expect(text(marked)).toContain('SECRET-OWNER-MARK'); // the input has it ...
    await blob.put(member, marked);
    const data = text((await stored(kernel.pool))[0]!.data);
    expect(data).not.toContain('SECRET-OWNER-MARK'); // ... the stored file does not
    expect(data).not.toContain('SECRET-GPS-NOTE');
    expect((await sharp((await stored(kernel.pool))[0]!.data).metadata()).exif).toBeUndefined();
  });

  it('turns a picture by its EXIF orientation before the orientation is dropped', async () => {
    const { blob, member, kernel } = await setup();
    // 40 wide, 20 high, stored "rotated by 90 degrees": shown as 20 wide, 40 high.
    await blob.put(member, await image('jpeg', 40, 20, { orientation: 6 }));
    const meta = await sharp((await stored(kernel.pool))[0]!.data).metadata();
    expect([meta.width, meta.height, meta.orientation]).toEqual([20, 40, undefined]);
  });

  it('scales a large image down to the configured size, never up', async () => {
    const { blob, member, kernel, configure } = await setup();
    await configure({ maxDimension: 64 });
    await blob.put(member, await image('png', 400, 200));
    await blob.put(member, await image('png', 10, 10));
    const sizes = await Promise.all(
      (await stored(kernel.pool)).map(async (row) => {
        const meta = await sharp(row.data).metadata();
        return [meta.width, meta.height];
      }),
    );
    expect(sizes).toContainEqual([64, 32]);
    expect(sizes).toContainEqual([10, 10]);
  });
});

describe('hostile uploads', () => {
  const refused = async (bytes: Uint8Array, message?: RegExp) => {
    const { blob, member, kernel } = await setup();
    const error = await blob.put(member, bytes).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    if (message) expect((error as Invalid).errors?.[0]?.message).toMatch(message);
    expect(await count(kernel.pool)).toBe(0);
    expect(JSON.stringify((error as Invalid).errors)).not.toMatch(/<script|alert\(1\)/);
  };

  it('refuses an empty file', () => refused(new Uint8Array(), /empty/));

  it('refuses a file over the size limit before it looks at it', async () => {
    const png = await image('png', 8, 8);
    const big = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]);
    await refused(big, /larger than 2 MB/);
  });

  it('honours a lower size limit from the settings', async () => {
    const { blob, member, configure } = await setup();
    await configure({ maxBytes: 1024 });
    const noisy = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: 'black',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    expect(noisy.byteLength).toBeGreaterThan(1024);
    await expect(blob.put(member, noisy)).rejects.toBeInstanceOf(Invalid);
  });

  it('refuses a decompression bomb: a small PNG that declares billions of pixels', async () => {
    const bomb = pngBomb(60_000, 60_000);
    expect(bomb.byteLength).toBeLessThan(200);
    const started = Date.now();
    await refused(bomb, /more than 40,000,000 pixels/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('refuses an image just over the pixel limit and takes one just under', async () => {
    const { blob, member, configure } = await setup();
    await configure({ maxPixels: 10_000 });
    await expect(blob.put(member, await image('png', 101, 100))).rejects.toBeInstanceOf(Invalid);
    await expect(blob.put(member, await image('png', 100, 100))).resolves.toBeDefined();
  });

  it.each([
    ['HTML', '<!doctype html><script>alert(1)</script>'],
    ['JavaScript', 'alert(1)'],
    ['a PDF', '%PDF-1.7\n1 0 obj<<>>endobj'],
    ['a ZIP', 'PK\u0003\u0004 not really'],
    ['a shell script', '#!/bin/sh\nrm -rf /'],
    ['an ELF binary', '\u007fELF\u0002\u0001\u0001'],
    [
      'a data URL',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    ],
    ['a data URL for an SVG', 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['plain text', 'hello'],
  ])('refuses %s, whatever its name or type claims', (_name, content) =>
    refused(bytesOf(content), /Only PNG, JPEG, WebP, GIF and SVG/),
  );

  it('refuses a file that starts like an image and is not one (a GIF header and a script)', () =>
    refused(bytesOf('GIF89a<script>alert(1)</script>'), /damaged|not an image/));

  it('refuses a PNG, a JPEG and a WebP that are cut off', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const whole = await image(format, 64, 64);
      await refused(whole.subarray(0, Math.floor(whole.byteLength / 2)), /damaged|not the kind/);
    }
  });

  it('refuses a file that says it is a PNG and carries a JPEG body, and the reverse', async () => {
    const jpeg = await image('jpeg', 8, 8);
    const png = await image('png', 8, 8);
    const crossed = Buffer.concat([png.subarray(0, 8), jpeg.subarray(3)]);
    await refused(crossed);
    await refused(Buffer.concat([jpeg.subarray(0, 3), png.subarray(8)]));
  });

  it('refuses an SVG that is not UTF-8, and an HTML page that holds an <svg>', async () => {
    await refused(
      Buffer.concat([Buffer.from('<svg>'), Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from('</svg>')]),
      /UTF-8/,
    );
    await refused(bytesOf('<html><body><svg onload="alert(1)"></svg></body></html>'), /Only PNG/);
  });

  it('strips what a PNG or JPEG carries after its end: a script, a ZIP archive', async () => {
    const { blob, member, kernel } = await setup();
    const trailer = Buffer.from('<script>alert(1)</script>PK\u0003\u0004EVIL-ARCHIVE', 'latin1');
    for (const format of ['png', 'jpeg'] as const) {
      const clean = await image(format, 16, 16);
      const polyglot = Buffer.concat([clean, trailer]);
      expect(text(polyglot)).toContain('EVIL-ARCHIVE');
      await blob.put(member, polyglot);
    }
    for (const row of await stored(kernel.pool)) {
      expect(text(row.data)).not.toContain('<script');
      expect(text(row.data)).not.toContain('EVIL-ARCHIVE');
      expect(text(row.data)).not.toContain('PK\u0003\u0004');
    }
  });

  it('strips a PNG text chunk and a script hidden in a comment of a JPEG', async () => {
    const { blob, member, kernel } = await setup();
    const withComment = await sharp(await image('png', 16, 16))
      .withMetadata({ exif: { IFD0: { ImageDescription: '<script>alert(1)</script>' } } })
      .jpeg()
      .toBuffer();
    expect(text(withComment)).toContain('<script>');
    await blob.put(member, withComment);
    expect(text((await stored(kernel.pool))[0]!.data)).not.toContain('<script>');
  });

  describe('SVG', () => {
    const svg = (inner: string, attributes = '') =>
      bytesOf(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"${attributes}>${inner}</svg>`,
      );
    const storedSvg = async (bytes: Uint8Array) => {
      const { blob, member, kernel } = await setup();
      const info = await blob.put(member, bytes);
      expect(info.mime).toBe('image/svg+xml');
      return text((await stored(kernel.pool))[0]!.data);
    };

    it('removes a script element', async () => {
      const out = await storedSvg(svg('<script>alert(1)</script><rect width="8" height="8"/>'));
      expect(out).not.toMatch(/script|alert/i);
      expect(out).toContain('<rect');
    });

    it('removes foreignObject with its HTML, frames and forms', async () => {
      const out = await storedSvg(
        svg(
          '<foreignObject width="8" height="8"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="p"></form><script>alert(1)</script></body></foreignObject><circle r="3"/>',
        ),
      );
      expect(out).not.toMatch(/foreignObject|iframe|form|input|script|evil\.example/i);
      expect(out).toContain('<circle');
    });

    it('removes event handlers on the root and on children', async () => {
      const out = await storedSvg(
        svg(
          '<rect width="8" height="8" onclick="alert(1)" onmouseover="alert(2)"/>',
          ' onload="alert(3)"',
        ),
      );
      expect(out).not.toMatch(/\son\w+=|alert/i);
    });

    it('removes every reference that leaves the file: links, images, uses, external fills', async () => {
      const out = await storedSvg(
        svg(
          '<a href="https://evil.example/x"><rect width="8" height="8"/></a><image href="https://evil.example/t.png" width="8" height="8"/><use href="https://evil.example/a.svg#x"/><rect width="4" height="4" fill="url(https://evil.example/f)"/><style>@import url(https://evil.example/c.css);</style>',
        ),
      );
      expect(out).not.toMatch(/evil\.example|@import|<a\b|<image|<use|<style/i);
    });

    it('removes javascript: and data: URLs and an animation that sets them', async () => {
      const out = await storedSvg(
        svg(
          '<a href="javascript:alert(1)"><rect width="8" height="8"/></a><rect id="r" width="8" height="8"/><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="onmouseover" values="alert(1)"/>',
        ),
      );
      expect(out).not.toMatch(/javascript|alert|<set|<animate/i);
    });

    it('drops an XML prolog and DOCTYPE that declare an external entity', async () => {
      const out = await storedSvg(
        bytesOf(
          '<?xml version="1.0"?>\n<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>',
        ),
      );
      expect(out).not.toMatch(/DOCTYPE|ENTITY|passwd|file:/i);
    });

    it('keeps an internal gradient reference and the namespace', async () => {
      const out = await storedSvg(
        svg(
          '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="8" height="8" fill="url(#g)"/>',
        ),
      );
      expect(out).toContain('url(#g)');
      expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('drops what follows the closing tag of an SVG: a script in an SVG/HTML polyglot', async () => {
      const out = await storedSvg(
        bytesOf(
          '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg><script>alert(1)</script><img src=x onerror=alert(2)>',
        ),
      );
      expect(out).not.toMatch(/script|alert|onerror|<img/i);
      expect(out).toContain('<rect');
    });
  });
});

describe('who may upload', () => {
  it('is denied to a user without the permission and to an anonymous caller, and stores nothing', async () => {
    const { blob, nobody, kernel } = await setup();
    const file = await image('png', 8, 8);
    await expect(blob.put(nobody, file)).rejects.toBeInstanceOf(Forbidden);
    await expect(blob.put(ANONYMOUS, file)).rejects.toBeInstanceOf(Unauthorized);
    expect(await count(kernel.pool)).toBe(0);
  });

  it('is allowed to a User and to Admin', async () => {
    const { blob, member, actorOf, kernel } = await setup();
    await expect(blob.put(member, await image('png', 8, 8))).resolves.toBeDefined();
    await expect(blob.put(await actorOf('admin'), await image('png', 9, 9))).resolves.toBeDefined();
    expect(await count(kernel.pool)).toBe(2);
  });
});
