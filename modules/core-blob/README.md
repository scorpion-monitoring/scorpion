# core.blob

The blob store: files that other modules keep (avatars, logos, later attachments), stored in a Postgres table, served by
the hash of their content, and rewritten on the way in so that what is stored is safe to show. It depends on
`core.authz` (permissions) and `core.settings` (its limits are settings and the logos are named in the branding settings).
Decisions are in [ADR-0018](../../docs/adr/0018-vocabularies-blob-store-and-branding.md).

Status: M3 sprint 4. The table is the only backend; an S3 backend is in `docs/backlog.md`.

## Manifest

| Part           | Value                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| id             | `core.blob`                                                                                                                    |
| table prefix   | `blob_` (set in the manifest; ADR-0004)                                                                                        |
| dependencies   | `core.authz`, `core.settings`; packages `@scorpion/sanitize` and `sharp`                                                       |
| profiles       | every profile that lists `core.identity` (`full`, `core-only`), between `core.settings` and `core.identity`                    |
| routes         | internal API: `GET /files/{hash}` (public), `POST /files`                                                                      |
| jobs           | `core.blob.cleanup`, hourly at minute 30 (UTC), 2 retries, 5 minutes                                                           |
| CLI            | none                                                                                                                           |
| events         | emits none; subscribes to `settings.changed@1` of `core.settings` and to `system.ready` (logo references)                      |
| registries     | contributes `authz.defaultRole` (`core.blob.upload` for the role `user`)                                                       |
| public service | `ctx.deps['core.blob']`: `put(actor, bytes)`, `describe(id)`, `setReference(ref, id \| null)`; the constant `MAX_UPLOAD_BYTES` |

### Permissions

| Permission         | Allows                                                              | Held by default by |
| ------------------ | ------------------------------------------------------------------- | ------------------ |
| `core.blob.upload` | `put`: upload through a route that another module owns (the avatar) | User, Admin        |
| `core.blob.manage` | The generic upload route `POST /files` (logos)                      | Admin              |

A route that stores an upload needs its own permission (`core.identity.avatar.update`) **and** the caller needs
`core.blob.upload`: a role that holds the first without the second is refused (403).

### Settings

| Key                      | Default    | Meaning                                                                                                    |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `maxBytes`               | 2 MiB      | The largest file, before and after processing. At most 8 MiB, the ceiling of the upload routes' body limit |
| `maxDimension`           | 2048       | A raster larger than this in either direction is scaled down to fit (never up)                             |
| `maxPixels`              | 40 000 000 | The most pixels a raster may declare; checked on the header, before anything is decoded                    |
| `unreferencedGraceHours` | 24         | How long a file nothing refers to stays before the cleanup job removes it                                  |

## What happens to an upload

1. Empty or larger than `maxBytes`: 422.
2. The type is **sniffed** from the first bytes (PNG, JPEG, WebP, GIF, SVG). The `Content-Type` the client sent and any file
   name are never looked at. Anything else, a data URL included, is 422.
3. **Rasters** are decoded and written again by `sharp`: EXIF, GPS, ICC profiles, text chunks and bytes after the image
   are gone (so a polyglot is not one any more), the EXIF orientation is applied first, the longer side is capped, a GIF
   becomes a PNG of its first frame. A header that declares more than `maxPixels` is refused before decoding (the
   decompression bomb), and a file that merely starts like an image is refused when the decoder disagrees.
4. **SVG** is parsed by DOMPurify: `script`, `foreignObject`, `style`, animations, `image`, `use`, links, event handlers and
   every reference that does not point inside the file are removed; the XML prolog and doctype (entities) are dropped;
   the result always has an `<svg>` root and the namespace.
5. The result is stored under the SHA-256 of **what is stored**. The same content is stored once.

Tests with hostile inputs (`service/images.test.ts`): SVG with script, `foreignObject`, handlers, external references and
an entity; PNG and JPEG with a script and a ZIP appended; EXIF with a copyright and a note; a GIF header with a script; a
decompression bomb; cut-off files; crossed signatures; HTML, PDF, ZIP, ELF and data URLs; a wrong declared type.

## Serving

`GET /files/{hash}` (`/api/internal/files/{hash}`) is public and rate limited. It answers the stored type, `nosniff`,
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `Cache-Control: public, max-age=31536000,
immutable`, `ETag: "<hash>"` (304 for a matching `If-None-Match`, without reading the bytes), `Content-Disposition: inline`
and `Cross-Origin-Resource-Policy: cross-origin`. A hash that is not 64 lower-case hex digits is 422; an unknown one 404.

`POST /files` takes the raw bytes as the body (any `Content-Type`), `core.blob.manage`, rate limited (strict), body limit 8 MiB
(the route option `maxBodyBytes`; every other route keeps 1 MiB). It answers 201 `{ id, hash, mime, size, url }`. The route has `audit: true` (who uploaded; the bytes are never stored in the trail).

## References and release

```ts
const stored = await ctx.deps['core.blob'].put(actor, bytes);        // checks core.blob.upload, 422 for a bad file
await ctx.db.tx(async (tx) => {
  await tx.update(user).set({ avatarBlobId: stored.id }).where(...);
  await ctx.deps['core.blob'].setReference(`core.identity:avatar:${userId}`, stored.id); // same transaction
});
```

An upload is stored unreferenced. A reference (`<module>:<purpose>:<id>`, one file per reference) clears that; replacing or
clearing it releases the old file. A file unreferenced for longer than `unreferencedGraceHours` is deleted by the hourly job
(rows locked by a reference being set are skipped). `describe(id)` gives `{ id, hash, mime, size }` for building the URL.
The branding logos are kept alive by this module from the branding settings (`core.settings:branding:logo-light|dark`).

## Tables

| Table            | Holds                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `blob_blob`      | `id` (UUIDv7), unique `hash`, `mime`, `size`, `data` (bytea), `created_at`, `unreferenced_since`           |
| `blob_reference` | `ref` (primary key), `blob_id` (foreign key to `blob_blob`), `updated_at`; the owner is an opaque text key |

## Image contents

`sharp` is a native library with prebuilt binaries per platform, and DOMPurify runs on jsdom. Only profiles that list this
module install them (the image check proves an image holds only its profile's modules). An image runs on the CPU
architecture it was built for.

## Testing

`test/harness.ts` starts the real `core.authz`, `core.settings` and this module over Postgres, with builders for real images
(sharp) and for a decompression bomb. Route tests (`apps/server/src/blob-routes.test.ts`) and the denied cases
(`defect-01.privilege-escalation.test.ts`) go through the whole pipeline.
