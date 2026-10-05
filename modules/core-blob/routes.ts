// The HTTP routes of core.blob. `GET /files/{hash}` is public and serves stored files; `POST /files`
// is the administrator's upload (logos). Both are internal routes (`/api/internal/files...`). The
// avatar upload belongs to core.identity, which calls `put` itself.
import { createRoute, NotFound, z, type AppEnv, type Context } from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import { Invalid } from '@scorpion/contracts';
import { MAX_UPLOAD_BYTES } from './settings-schema.ts';
import { PERMISSION_MANAGE } from './service/permissions.ts';
import { SHA256_HEX, type BlobInternals } from './service/blobs.ts';
import type { BlobInfo } from './public.ts';

const hashParam = z.object({
  hash: z.string().regex(SHA256_HEX, 'must be 64 lower-case hex digits'),
});

const binary = z.string().openapi({ type: 'string', format: 'binary' });
const blobSchema = z.object({
  id: z.string(),
  hash: z.string(),
  mime: z.string(),
  size: z.number().int(),
  url: z.string().describe('Path of the file below the internal API: `/files/{hash}`.'),
});

/**
 * What a file is served under. The type is the one stored (determined from the content at upload);
 * the policy lets an image render and nothing else: no script, no frames, no requests, no navigation,
 * so a file opened directly cannot do anything even if processing had missed something.
 */
export const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/** A file never changes under its hash. */
export const FILE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export const getFileRoute = createRoute({
  method: 'get',
  path: '/files/{hash}',
  public: true,
  publicReason:
    'Logos and avatars are shown to people who are not signed in (the sign-in page). The name of a file is the SHA-256 of its content, which only someone who has the file can know; what is stored passed the upload checks.',
  request: { params: hashParam },
  responses: {
    200: {
      description:
        'The file, with its stored content type, `X-Content-Type-Options: nosniff`, a strict Content-Security-Policy, a one-year cache and the hash as ETag.',
      content: { 'application/octet-stream': { schema: binary } },
    },
    304: { description: 'The caller has this file (`If-None-Match` matches the hash).' },
    404: { description: 'No file with this hash.' },
  },
});

export const uploadFileRoute = createRoute({
  method: 'post',
  path: '/files',
  permission: PERMISSION_MANAGE,
  audit: true,
  rateLimit: 'strict',
  maxBodyBytes: MAX_UPLOAD_BYTES,
  request: {
    body: {
      required: true,
      description:
        'The file as the request body. Its `Content-Type` is ignored: the type is determined from the content.',
      content: { 'application/octet-stream': { schema: binary } },
    },
  },
  responses: {
    201: {
      description:
        'The file was stored (or already was). Reference it from branding settings by `hash`.',
      content: { 'application/json': { schema: blobSchema } },
    },
    413: { description: 'The body is larger than the upload ceiling.' },
  },
});

const blobView = (stored: BlobInfo) => ({ ...stored, url: `/files/${stored.hash}` });

/** `If-None-Match` as a client sends it: a list of (weak) entity tags, or `*`. */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
}

export function registerBlobRoutes(r: RouteRegistrar, blobs: BlobInternals) {
  r.internal(getFileRoute, (async (c: Context<AppEnv>) => {
    const { hash } = (c.req as unknown as { valid(target: 'param'): { hash: string } }).valid(
      'param',
    );
    const etag = `"${hash}"`;
    const stat = await blobs.stat(hash);
    if (!stat) throw new NotFound('There is no such file.');
    const headers = {
      etag,
      'cache-control': FILE_CACHE_CONTROL,
      'content-security-policy': FILE_CSP,
      'x-content-type-options': 'nosniff',
      // Public and immutable; an <img> on another origin (a dev server, a mail client) may show it.
      'cross-origin-resource-policy': 'cross-origin',
    };
    if (matchesEtag(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers);
    const file = await blobs.read(hash);
    if (!file) throw new NotFound('There is no such file.');
    return c.body(new Uint8Array(file.data), 200, {
      ...headers,
      'content-type': file.mime,
      'content-length': String(file.size),
      'content-disposition': 'inline',
    });
  }) as never);

  r.internal(uploadFileRoute, (async (c: Context<AppEnv>) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Invalid('The request is not valid.', [
        { in: 'body', path: 'file', message: 'The file is empty.' },
      ]);
    }
    const stored = await blobs.put(c.get('actor'), bytes);
    c.header('cache-control', 'no-store');
    return c.json(blobView(stored), 201);
  }) as never);
}
