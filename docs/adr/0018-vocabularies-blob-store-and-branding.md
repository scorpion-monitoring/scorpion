# ADR-0018: Vocabularies, the blob store and branding

- Status: Accepted
- Date: 2026-10-02

## Context

M3 sprint 4 finishes the scope of `core.settings` and adds `core.blob` (sprint plan §7, decisions §10.2). Four things
need a decision the plan leaves open: how vocabularies are declared and deleted, how a stored file is kept alive and
removed, where branding lives and how another module reads it, and how an uploaded file or a Markdown text is made
safe. CLAUDE.md fixes the rules: vocabularies are data (rule 8), branding comes from settings (rule 9), uploaded
images are re-encoded or sanitised, Markdown is rendered on the server and sanitised.

## Decision

### Vocabularies (`core.settings`)

- Tables `settings_vocabulary` (id, description) and `settings_vocabulary_term` (key, `labels` as a locale → text map,
  `sort_order`, `active`, `seeded`), unique on `(vocabulary, key)`. No pg enum anywhere; a test fails on `pgEnum` and on
  `CREATE TYPE … AS ENUM` in any schema or migration of the repository.
- **A vocabulary exists because a module declares it** in the registry `vocabulary` (`{ id, description?, terms?, usage? }`).
  Entries with the same id merge: one declares the terms, another (the module that stores the keys) adds a `usage`
  check. Administrators add terms, never vocabularies. `core.settings` declares the five built-in ones (`stage`,
  `thematic-category`, `necessity`, `sender-type`, `aggregate`) with the values of the legacy app (FEATURES §3, §4.6),
  `TERM` as a proper stage (defect 9). Keys keep the legacy spelling (`PROD`, `Bibliographic`, `mandatory`, `sum`), so
  the migration tool and old clients need no mapping; keys are case sensitive and never change.
- **Seeds run at every start and only add what is missing.** A label or order an administrator changed is not put
  back. That is why a term a module declared (`seeded`) is **deactivated, never deleted**: the declaration would bring
  it back. A term an administrator added is deleted if no `usage` check says it is in use, and deactivated otherwise.
  A deactivated term stays valid for what refers to it (`validateTerm(…, { allowInactive: true })`) and cannot be
  chosen for anything new. A vocabulary without a usage check reports nothing as in use; the module that starts
  storing keys (M7 for `stage`) adds its check in the same change.
- Reading terms is self-service (`core.settings.vocabulary.read`, held by the role `user`, because forms need them);
  everything else needs `core.settings.vocabulary.write` (Admin). Order is `sort_order`, then key compared as bytes.
  `settings.vocabulary.changed@1` carries the vocabulary, the key and what happened, never a label.
- Other modules call `listTerms` and `validateTerm` on the public service of `core.settings`. Both check no permission
  (like `getSecret`, ADR-0015); the calling route or service has done that.

### The blob store (`core.blob`)

- Own module, prefix `blob_`, depends on `core.authz` and `core.settings` (its limits are its own settings). Table
  `blob_blob` (bytea, `hash` = SHA-256 of what is stored, `mime`, `size`, `unreferenced_since`) is content addressed:
  the same content is stored once. Table `blob_reference` maps an owner key to a file.
- **What is stored is never what was uploaded.** The real type is sniffed from the first bytes; the client's
  `Content-Type` is not looked at. A raster is decoded and written again by `sharp` (EXIF, GPS, ICC, text chunks and
  trailing bytes are gone, EXIF orientation is applied first, the longer side is capped at `maxDimension`, a GIF
  becomes a PNG of its first frame). Before anything is decoded the header is checked against `maxPixels`
  (decompression bombs). An SVG goes through DOMPurify with script, `foreignObject`, `style`, animation, `image`, `use`,
  links and every reference that leaves the file removed, and the prolog and doctype dropped (no entities). Anything
  else, including a data URL, is refused with 422. `maxBytes` applies before and after processing.
- **References and release.** An upload is stored _unreferenced_ (`unreferenced_since = now`). `setReference(ref, id|null)`
  makes an owner key (`core.identity:avatar:<user id>`) hold one file, clears the mark on it and sets the mark on the
  file it replaced when nothing else holds that. It runs inside the caller's transaction (savepoint), so the id the
  owner stores and the reference are written together or not at all, and it locks the file row so the cleanup cannot
  remove it under the caller. The hourly job `core.blob.cleanup` deletes files unreferenced for longer than
  `unreferencedGraceHours` (default 24), skipping locked rows. The grace period is what makes "upload, then store the
  id" safe without a transaction around the request, and also removes uploads that were never used. Uploading content
  that already exists but is unreferenced restarts its grace period. A reference to an id that does not exist is 422.
- **Serving.** `GET /files/{hash}` is public (the sign-in page shows logos). It is registered on the internal surface,
  so its path is `/api/internal/files/{hash}`: the registry has no root surface and the plan's `/files/:hash` names
  the route, not a mount point. It answers the stored type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
default-src 'none'; style-src 'unsafe-inline'; sandbox`, `Cache-Control: public, max-age=31536000, immutable`, the
  hash as `ETag` and 304 for a matching `If-None-Match` without reading the bytes, and `Cross-Origin-Resource-Policy:
cross-origin` (public, immutable content that a web UI on another origin or a mail may embed). A hash that is not 64
  lower-case hex digits is 422, an unknown one 404.
- **Uploading.** `POST /files` (`core.blob.manage`, Admin; logos) and `PUT /account/avatar` (identity) take the raw bytes
  as the body. The service method `put` needs `core.blob.upload`, which the role `user` holds, so a module that offers
  an upload route does not need its own check of the file and a role that may change an avatar but not upload is
  refused. The 1 MiB server-wide body limit is raised for these routes only, with the route option `maxBodyBytes`
  (8 MiB, the ceiling; the `maxBytes` setting can only lower the accepted size). The limit is looked up by method and
  path before routing, so an override can only raise the limit for exactly that route.

### Branding (`core.settings`)

- **Branding is the `branding` group of the settings of `core.settings`**, not a module and not a separate table:
  `productName` (default `Scorpion`, the one place in code that says it), `instanceName`, `mailFrom`, `contactEmail`,
  `imprintUrl`, `logos.light|dark` and `legal.terms|privacy|imprint` (Markdown, at most 100 000 characters each). It is
  saved through the generic settings routes (`PUT /settings/core.settings`, validated, versioned, evented).
- **How another module reads it.** `ctx.settings` stays a module's own (ADR-0017). `core.settings` adds `getBranding()`
  to its public service, which every module that declares the dependency can call; it returns the effective values with
  defaults applied (instance name falls back to the product name, sender to `no-reply@localhost`) and is cached like every
  setting (5 seconds across processes), with `{ fresh: true }` for a handler that reacts to a change. No new kernel port.
  Identity reads it through a small `BrandingSource` port that tests replace.
- **Logos are stored as the hash of an uploaded file, not as a blob id** (a deviation from the plan's wording). The
  file is served by hash, so the hash is what the UI needs, and `core.settings` cannot resolve an id to a hash without
  depending on `core.blob`, which depends on it. `core.blob` therefore listens to `settings.changed@1` (and runs once at
  start), reads the branding fresh and points `core.settings:branding:logo-light|dark` at the files with those hashes.
  A hash with no stored file is logged (the slot, not the hash) and holds nothing. The window between saving and the
  reference is covered by the grace period.
- **Public routes.** `GET /branding` (names, contact, imprint link, logo hashes, which legal pages exist; not the sender
  address) and `GET /legal/{page}` need no login (FEATURES 3.2: the legacy app hid them behind login) and are rate limited.
- **Legal texts** are rendered on the server and sanitised. Rendering uses a small Markdown subset written for this
  (headings, paragraphs, emphasis, code, links, lists, quotes, rules; raw HTML is escaped and shows as text; links only to
  `http`, `https`, `mailto`, absolute paths and fragments) followed by DOMPurify with a tag and attribute allow list.
  A full CommonMark parser would be a dependency beyond `sharp` and DOMPurify, which the plan fixed for this sprint
  (backlog). Output is cached by the hash of the text.
- **`instanceName` and `mailFrom` leave identity's settings.** Migration `0002_branding_from_identity` of `core.settings`
  copies them from the stored `core.identity` settings into `branding` (a value already in `branding` wins) and removes
  them from the identity row, in one migration that touches only this module's own table. The identity schema no longer
  knows the keys; a leftover one would be dropped with a log line (ADR-0017), so nothing is silently half-applied. Only
  databases of sprint-3 builds can hold them; 0.3.x never stored settings.

### Sanitising code

`packages/sanitize` holds DOMPurify over jsdom (HTML for Markdown output, SVG) and the Markdown renderer, because
`core.settings` (legal texts) and `core.blob` (SVG) both need it and a module may import another module only through
`public.ts`. It is a package, not a module, like `kernel` and `contracts`.

### Avatar

`PUT /account/avatar` and `DELETE /account/avatar` (`core.identity.avatar.update`, role `user`) are session-only and act on
the caller's account; there is no user id in the input. The file goes through `put`, the id is stored in
`identity_user.avatar_blob_id` and the reference set in one transaction, the old file is released, and a purge of the
account releases it too. `identity.profile.updated@1` gets the field name `avatar`. The profile shows `avatarHash`.

## Consequences

- Every profile that lists `core.identity` lists `core.blob` (`full`, `kpi-tracker`); the image of such a profile contains
  `sharp` (native, prebuilt per platform) and DOMPurify with jsdom, and no other image does.
- `sharp` pins the image architecture: an image built on one CPU architecture runs there.
- A new module that stores files calls `put` and `setReference` and needs `core.blob` in `package.json`; a module that
  stores a vocabulary key declares `usage` and calls `validateTerm`.
- Deleting a stored file is never immediate: it takes the grace period. Removing a leaked file at once needs a
  database statement (backlog).
