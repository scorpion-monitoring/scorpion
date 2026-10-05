// Starts core.blob over real Postgres with the real core.authz and core.settings it depends on, as
// the kernel guide describes ("Testing a module"). Permissions come from roles in the database.
// Also builds the inputs the tests feed it: real images made with sharp, and hostile ones.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { deflateSync } from 'node:zlib';
import type { UserActor } from '@scorpion/contracts';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import { createSettingsModule, type SettingsInternalsBundle } from '@scorpion/core-settings/module';
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import {
  makeRoleAssignment,
  makeSecretsKey,
  startPostgres,
  type StartedPostgres,
} from '@scorpion/testing';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createBlobModule, type BlobInternalsBundle } from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };

export interface Started {
  kernel: Kernel;
  blob: BlobInternalsBundle;
  settings: SettingsInternalsBundle;
  logs: string[];
  databaseUrl: string;
  /** A user holding the given roles (rows in the database, decided by the real authoriser). */
  actorOf: (...roles: string[]) => Promise<UserActor>;
  /** Saves the settings of core.blob (the whole object) as an administrator would. */
  configure: (values: Record<string, unknown>) => Promise<void>;
  /** Delivers the events that are waiting in the outbox. */
  deliver: () => Promise<void>;
}

/** One Postgres container per test file; every `start()` without a `databaseUrl` gets an empty database. */
export function useBlob() {
  let server: StartedPostgres;
  const open: Kernel[] = [];
  beforeAll(async () => {
    server = await startPostgres();
  }, 120_000);
  afterEach(async () => {
    await Promise.all(open.splice(0).map((kernel) => kernel.stop()));
  });
  afterAll(async () => {
    await server?.stop();
  });
  return {
    server: () => server,
    async start(options: { databaseUrl?: string } = {}): Promise<Started> {
      const logs: string[] = [];
      const log = createLogger({
        level: 'trace',
        destination: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            logs.push(chunk.toString());
            callback();
          },
        }),
      });
      const databaseUrl = options.databaseUrl ?? (await server.createDatabase());
      const kernel = createKernel({
        profile: {
          name: 'blob-test',
          modules: ['core.authz', 'core.settings', 'core.blob'] as never,
        },
        sources: [
          { manifest: authzModule, packageJson: authzPackage },
          {
            manifest: createSettingsModule({ env: { SECRETS_KEY: makeSecretsKey() } }),
            packageJson: settingsPackage,
          },
          { manifest: createBlobModule(), packageJson },
        ],
        modulePackages: {
          'core.authz': '@scorpion/core-authz',
          'core.settings': '@scorpion/core-settings',
          'core.blob': '@scorpion/core-blob',
        },
        config: loadConfig({ DATABASE_URL: databaseUrl, PROFILE: 'blob-test' }),
        log,
      });
      open.push(kernel);
      await kernel.start();
      const settings = kernel.services.get('core.settings') as SettingsInternalsBundle;
      const actorOf: Started['actorOf'] = async (...roles) => {
        const user = { id: randomUUID() };
        for (const role of roles) await makeRoleAssignment(kernel.pool, user, role);
        return {
          kind: 'user',
          userId: user.id,
          username: `user-${user.id.slice(0, 8)}`,
          roles: [],
          via: 'session',
        };
      };
      return {
        kernel,
        blob: kernel.services.get('core.blob') as BlobInternalsBundle,
        settings,
        logs,
        databaseUrl,
        actorOf,
        async configure(values) {
          const admin = await actorOf('admin');
          const current = await settings.settings.get(admin, 'core.blob');
          await settings.settings.update(admin, 'core.blob', { version: current.version, values });
        },
        async deliver() {
          await kernel.dispatcher.dispatchOnce();
        },
      };
    },
  };
}

// --- inputs -----------------------------------------------------------------------------------

/** A real image of one flat colour (or noise-free gradient-less), as a file of the given format. */
export async function image(
  format: 'png' | 'jpeg' | 'webp' | 'gif',
  width = 8,
  height = 8,
  options: { exif?: Record<string, Record<string, string>>; orientation?: number } = {},
): Promise<Buffer> {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  });
  if (options.exif || options.orientation) {
    pipeline = pipeline.withMetadata({
      ...(options.exif ? { exif: options.exif } : {}),
      ...(options.orientation ? { orientation: options.orientation } : {}),
    });
  }
  return pipeline.toFormat(format).toBuffer();
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes: Buffer) => {
  let c = -1;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

/**
 * A decompression bomb: a valid PNG header that declares `width` x `height` one-bit pixels, with a
 * few bytes of pixel data. It is a few dozen bytes on the wire and gigabytes in memory if decoded.
 */
export function pngBomb(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const bytesOf = (text: string) => new TextEncoder().encode(text);
