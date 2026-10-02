---
'scorpion': minor
---

Vocabularies, a file store and branding settings complete the configuration of an instance, and a signed-in person can
upload an avatar. **`kpi-tracker` and `full` now include the new module `core.blob`, which brings `sharp` (a native library
with prebuilt binaries per platform) and DOMPurify to their images; an image runs on the CPU architecture it was built for.**
No new environment variable.

- **Vocabularies replace enums.** Stages (`DEV`, `DEMO`, `PROD`, `TERM`), thematic categories, necessity levels, sender types
  and aggregate functions are terms an administrator can relabel, reorder, deactivate and extend, and modules declare their
  own in the registry `vocabulary`. New routes (internal API): `GET /vocabularies`, `GET /vocabularies/{vocabulary}/terms`,
  `POST /vocabularies/{vocabulary}/terms`, `PATCH` and `DELETE /vocabularies/{vocabulary}/terms/{key}`. A term a module
  declared, or one that is in use, is deactivated instead of deleted. New permissions: `core.settings.vocabulary.read`
  (role `user`) and `core.settings.vocabulary.write` (Admin). New event `settings.vocabulary.changed@1` (no labels).
- **A file store, `core.blob`.** Files are stored in the database, named by the SHA-256 of their content and served at
  `GET /files/{hash}` (`/api/internal/files/{hash}`, public) with `nosniff`, a strict Content-Security-Policy, a one-year
  cache and the hash as ETag. An upload is never stored as sent: the type is determined from the content (the client's
  `Content-Type` is ignored), rasters are decoded and written again without metadata and scaled to at most 2048 pixels,
  SVG is sanitised, anything else is refused with 422. Settings of `core.blob`: `maxBytes` (2 MiB, at most 8 MiB),
  `maxDimension`, `maxPixels` (decompression bombs) and `unreferencedGraceHours`. A file nothing refers to is removed by the
  hourly job `core.blob.cleanup` after 24 hours. `POST /files` (Admin, `core.blob.manage`) uploads logos; routes may now
  raise the 1 MiB request body limit for themselves. New permissions: `core.blob.upload` (role `user`) and
  `core.blob.manage` (Admin).
- **Avatar.** `PUT /account/avatar` (the image as the request body) and `DELETE /account/avatar` for the signed-in person's own
  account; sessions only (an access token gets 403). The profile shows `avatarHash`. New permission
  `core.identity.avatar.update` (role `user`).
- **Branding settings.** Product name, instance name, sender address, contact email, imprint link, light and dark logo (by
  file hash) and the terms, privacy policy and imprint as Markdown are the `branding` settings of `core.settings`
  (`PUT /settings/core.settings`). Public routes need no login: `GET /branding` and `GET /legal/{page}` (`terms`, `privacy`,
  `imprint`, rendered on the server and sanitised; raw HTML in a text shows as text). Mails use the instance name and sender
  from here. With no setting, the product is called `Scorpion` and the sender is `no-reply@localhost`.
- **`instanceName` and `mailFrom` moved** from the settings of `core.identity` to `branding.instanceName` and
  `branding.mailFrom`. An existing database keeps them: a migration copies a stored value into the new place and removes
  it from the old one. A script that saves `core.identity` settings with those two keys now gets `422`.
- **Database.** Three new migrations: two in `core.settings` (the vocabulary tables with their seeds written at start-up,
  and the branding move) and one in the new `core.blob` (`blob_blob`, `blob_reference`). An existing 0.3.x or 0.4 development
  database loses nothing and needs no manual step.
