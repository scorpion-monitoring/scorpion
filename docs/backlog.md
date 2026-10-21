# Backlog

## Kernel follow-ups

- ~~Outbox retention~~ Done in M4 sprint 4: `deleteDeliveredEvents` in the kernel, the job `core.audit.system.outbox-retention` (setting
  `outboxRetentionDays`, default 14) deletes events whose deliveries are all `delivered` and events with no subscribers; an event with a
  `pending` or `dead` delivery stays. Requeue of a `dead` mail delivery is done (M4 sprint 3), requeue of a `dead` outbox delivery too
  (`POST /system/outbox/deliveries/{id}/requeue`, ADR-0024).
- ~~Job-run retention~~ Done in M4 sprint 4: `deleteJobRuns` and the job `core.audit.system.job-run-retention` (`jobRunRetentionDays`, 90).
  `kernel_job_run` also has a `result` column now, filled from what a handler returns.
- `scorpion worker` listens on no port, so it has no liveness or metrics endpoint. Add a small
  internal listener if operators need one (job durations are observed in the worker process, so
  its `/metrics` would be the only place to scrape them when `WORKER_MODE=separate`).
- Start-up preflight for cron expressions: today an invalid `schedule` is reported when the workers
  start, not before migrations.
- Make the image build's lockfile step reproducible: it reuses every locked version, but it does
  rewrite `pnpm-lock.yaml` inside the build stage for non-`full` profiles.
- ~~Release image workflow~~ Done: `ci.yml` has a `v*` tag trigger and the `Publish (full | core-only | registry)` jobs (M7 sprint 7 checks that the tag matches the root `package.json` version). (was: CI builds only throwaway `scorpion:ci-<profile>` images and has no tag
  trigger, so the release step "build the profile images as `scorpion:<x.y.z>-<profile>`"
  (CONTRIBUTING.md, "Releases") is manual (`pnpm build --profile <name> --tag scorpion:<x.y.z>-<name>`).
  Add a workflow that runs on `v*` tags: check that the tag matches the root `package.json` version,
  build every release profile (not `fixture-ab`) with `docker/Dockerfile`, run the same smoke tests as
  CI, tag `scorpion:<x.y.z>-<profile>` and push to a registry. The registry (and its credentials as
  repository secrets) needs a decision first; record it in an ADR.)

## Audit follow-ups (M4 sprint 4)

What M4 deferred (plan §9) and what the sprint found. The viewer screens, the inbox bell and the system page are M5; the routes are ready.

- **Rich search.** The viewer filters on method, user, endpoint prefix, action, outcome, source and a date range. Full-text search over bodies and payloads (a GIN index on the `jsonb` columns or `tsvector`), saved filters and "all entries about this subject" are not built.
- **Export to an external log sink.** Syslog, OTLP logs or an S3 archive of old rows before retention deletes them. The trail is only in the database; the CSV export is the way out.
- **Tamper evidence.** The table refuses `UPDATE`, `DELETE` and `TRUNCATE` for the application (ADR-0021) but a database superuser can drop the trigger. A hash chain over the rows, or a periodically signed digest, would make a change detectable; so would shipping rows to a second system as they are written.
- **Partitioning.** `audit_event` is one table with an index on `(occurred_at, id)`. Revisit monthly range partitions (and dropping a partition instead of batched deletes) if the load test (M18) shows bloat. Batched `DELETE` under the flag leaves dead tuples until autovacuum.
- ~~**Audit volume of reads.**~~ Done in M5 sprint 4: the list view (`GET /audit`) is no longer audited; opening one entry and the CSV export still are. Recorded in the README of `core.audit`. (was: The three read routes of the viewer are audited (who looked). A busy admin screen that polls fills the table. Sample reads, or stop auditing the list and keep the export and the single entry, when the UI exists.)
- **Login, logout and failed sign-ins are not in the trail.** Auth routes are not `audit` routes: the actor of a login is anonymous when the pipeline writes the entry, and a failed-login flood would fill the table. A `identity.session.created@1` event (success) and a counted failure event would fix both; decide with the account-lockout question (identity follow-ups).
- **Redaction is by name.** A secret under an innocent key, or in a value (a token pasted into a free-text field), is not recognised. A content check for the token and key formats this system issues (`scp_`, `srt_`) would catch the likeliest case. Routes that store a body should stay few and reviewed.
- **Settings values are stored in the body of `PUT /settings/{module}`.** Settings never hold secrets by rule, but a URL with a token in its query would be stored. Add a secret-hygiene guard on the settings schemas (settings follow-ups) or `redact: ['url']` for that route.
- **The old value of a setting is not in the trail.** The event names the keys, not the values (ADR-0017). If an operator needs "from what to what", store the diff in the audit payload for keys that a schema marks as non-sensitive.
- ~~**Event payloads without `username`.**~~ Done in M5 sprint 4: `GET /audit` and `GET /audit/{id}` carry `userName` (the name the account has now, `null` for a purged one) and the Logs page shows "deleted account" with the first characters of the id. (was: The stored payload leaves the username out so a purge does not leave a name in an append-only table. The viewer shows ids; the admin UI must join the user table and show "deleted account" for a purged one.)
- ~~**A purged account's id stays in the trail**~~ Done in M5 sprint 4: the description of the legal texts in the settings of `core.settings` says the privacy text should say so; the Logs page says it too. (was: as an actor or subject, until retention. That is the point of an audit trail; say so in the privacy text (M5).)
- **The public API channel has its first writer (M8 sprint 1).** A v1 route with `audit: true` is recorded under `channels.api` (tested for 200, 401, 403, 422 and 429, and the switch). Size, measured with 1000 calls of one token on the fixture route: about 231 bytes of row data per call, about 0.5 MB per 1000 calls with the table's indexes (so 90 days at 100 000 calls a day is about 4.5 GB: `apiRetentionDays` and the call volume of the busiest token decide whether that is acceptable; a plain table, no partitioning).
- **A call the rate limit turns away is audited without the token id.** The audit hook wraps the limit, which runs before authentication on purpose. The entry has the address and the request id. If operators need the token, record its prefix (`scp_<prefix>_…`, which is not a secret and is shown in the token list) as the subject of a 429 entry; no hash is needed for that.
- **`audit_event` has no `surface` column,** so internal and v1 calls are both `source = 'api'` and share `apiRetentionDays` (see "Per-surface retention" above); the viewer cannot filter on the surface except by the path prefix.
- **Optional peers for later modules.** A module that declares events (M6 onwards) fails the decisions test until `core.audit` has a decision for it; add the module as an optional peer of `core.audit` at the same time. A registry through which a module contributes its own decisions would remove the edit to `decisions.ts`; not worth it for a few modules.
- **`ctx.audit` has no caller yet** besides the module's own export and requeue entries. The first service that changes something without an event (M6 and later) uses it inside its transaction.
- ~~**A job-run page.**~~ Done in M5 sprint 4: `GET /system/job-runs` and the System page. (was: `kernel_job_run.result` is filled, and `listJobRuns` returns it, but there is no route to list job runs. Add `GET /system/job-runs` (`core.audit.system.read`) with the system page (M5).)
- **Dead outbox deliveries are kept for ever.** Outbox retention never deletes an event with a `dead` delivery. A dead delivery that nobody will fix should be dismissed on purpose: a `DELETE /system/outbox/deliveries/{id}` (audited) is not built.
- **Requeue is one delivery at a time**, as for mail.
- **CSV extras.** No BOM (Excel users import as UTF-8), no choice of columns, no XLSX. The row cap is a setting; a larger export is a background job that writes a file to the blob store, not built.
- **Per-surface retention.** `retentionDays` and `apiRetentionDays` split by `source`. If administrators want the internal request log shorter than the events, split `api` rows by surface.

## Notifications follow-ups (M4 sprint 3)

- **Unsubscribe links, digests and quiet hours.** Non-mandatory mail still has no unsubscribe link (it needs a public route and a token); no digest or
  batching; no quiet hours. The preference switches are the only control (M4 plan §9).
- **Per-user webhooks** (a webhook for a person's own notifications) and per-event transport routing.
- ~~**The UI**~~ Done in M5 sprint 4: the inbox bell, the inbox page, the preference form (it reads `GET /notifications/preferences/categories` and writes `PUT /preferences/notifications.preferences`) and the delivery list. (was: for the inbox bell, the preference form and the delivery list is M5; the routes are ready. The preference form should read
  `GET /notifications/preferences/categories` and write `PUT /preferences/notifications.preferences` (which replaces the whole object).)
- ~~**`inApp` is not switched on in `core.identity`.**~~ Done in M5 sprint 4: three templates earn an inbox item (README of `core.identity`). (was: The flag works for any recipient with a user id, and identity passes one for the administrators'
  registration request and for the person's own mails. Turning it on (a registration request and an approval in the inbox) is a small change in
  `identity-mail.ts` that needs a decision on which mails earn an inbox item; leave it for M5 together with the bell.)
- **Inbox size per user is not capped.** Only read items are deleted (after `inboxRetentionDays`). A sender that floods one user can grow the table;
  a per-user cap (oldest read first) or a rate on `inApp` writes is the answer if it happens.
- **Delivery rows keep the address of a purged account until `retentionDays`.** `recipient_user_id` has no foreign key (ADR-0019) and the address
  stays on the row; clearing both for a purged user (a trusted call like `removeInboxOfUser`) would shorten that. Related: the personal data in
  `queued` rows older than the retention.
- **Preference definitions: done for `notifications.preferences` only.** The category list endpoint is the definition for that key; the general
  `GET /preferences/definitions` of core.settings (registered keys with descriptions, schemas and defaults) is still open (see "Settings follow-ups").
- **Requeue is one at a time.** A "requeue all dead" and a bulk filter are not built; the list filter makes a UI loop easy.
- **The test mail has no result.** The route answers 202 with the delivery id; whether the relay accepted it shows in the delivery list. A synchronous
  "sent / failed with code" answer would need the route to wait for one delivery pass.
- **Job name.** The plan calls the daily job `notify.retention`; the kernel requires the module id as a prefix, so it is `core.notifications.retention`.
- **Registry `notify.recipientAddress` has one use.** Only the test mail asks it. If the audit or a digest needs addresses too, extend the entry
  rather than adding a second lookup.

## Notifications follow-ups (M4 sprint 2)

- **The language of a request comes from the body.** `POST /auth/register` and `POST /auth/password-reset` take an optional `locale`; the server
  does not read `Accept-Language`. The UI (M5) sends the browser's language. Reading the header in the route is a small addition if a client needs it.
- **Reset and register-attempt mails use the request's language, not the owner's preference.** The owner exists but the caller does not, and
  reading their preference only on the known path would add a difference between the paths. A mail to a signed-in person or an administrator
  uses the preference `notifications.locale`.
- **A rejected applicant who registers again gets no mail.** The address of a soft-deleted account stays taken for the 30 days of the purge
  retention (ADR-0013); a new registration with it is a quiet 202 and creates nothing. M5 should tell a rejected person what to do (contact address).
- **At most 1000 administrators are mailed per registration** (`listHoldersAsSystem` caps its answer). A larger group would need a digest or a
  fan-out job; nothing near it exists.
- **Admin mails are sent one by one inside the registration transaction.** Fine for a handful; with many administrators a fan-out job reading the
  list after the commit would shorten the request.
- **Templates of modules that do not exist yet live in core.notifications** (`onboarding.application-*`). When M15 lands,
  the module takes over its own (a rename of the contributor, same key). Done for `registry.membership-*` in M6 sprint 3 (they moved to
  `registry.organisations` with the same keys, worded for organisations) and for `kpi.reporting-reminder` in M10 sprint 5 (it moved to `kpi.ingestion` with the same key; a profile without that module does not register it).
- **No unsubscribe link.** Done in M4 sprint 3: `category` and `mandatory` drive the preference switches (ADR-0023). Still open: an unsubscribe link in the mail.
- **The text and HTML of a template are not checked by a mail-client test.** The HTML is plain tables-free markup with inline styles; the
  layout is tested for escaping and structure, not rendered in real clients.
- **A start-up message for a leftover `SMTP_URL` was left out.** The M4 plan's risk table asks for one; its definition of done (the old name
  appears only in documentation) wins. The changeset and the READMEs say the variable is ignored.

## Notifications follow-ups (M4 sprint 1)

- **A module stop hook in the kernel.** `core.notifications` opens a `LISTEN` connection per process at `system.ready` and has no way to be
  told about shutdown (`kernel.stop()` calls only the dispatcher and the jobs). The service exposes `close()` for tests and the socket is
  unref'd, so the process still ends. A `system.stopping` event or a `stop()` on the service would let modules release resources; the kernel's
  own outbox listener could then also be offered to modules (a `ctx.listen(channel, fn)`), which would replace the module's connection.
- **No post-commit hook in `ctx.db.tx()`.** The wake-up goes through `pg_notify`, which Postgres delivers on commit, so the module needs its own
  listener. An `afterCommit(fn)` on the transaction would let `enqueue` call `ctx.jobs.enqueue` directly.
- **One wake-up job per process per commit burst.** Every process with a listener queues `core.notifications.deliver` when it hears a
  notification (coalesced over 100 ms). The extra runs find nothing due. A singleton key on `ctx.jobs.enqueue` would remove them.
- **Permanent SMTP failures are retried like transient ones.** A 5xx for the recipient (a mailbox that does not exist) is tried 8 times over
  about two hours before the row is dead. Mapping `responseCode >= 500` to an immediate `dead` needs a decision on greylisting and relays that
  answer 5xx for policy reasons.
- **`emailTransport` is an enum in the settings schema.** The registry `notify.transport` is open, but the admin form needs the ids at validation
  time, so a new email transport adds its id to `settingsSchema` in the same change. A schema that is told the registry's ids (a kernel hook
  on settings schemas) would remove that edit.
- **Webhook TLS pinning and per-event routing.** One signed URL for admin-addressed messages; per-user webhooks, per-event routing and
  a retry-after header are out of scope (M4 plan §9).
- **Drizzle's `execute` returns timestamps as text.** `claimDue` converts `created_at` itself; any other raw `db.execute` that selects a
  timestamp must do the same.

## Web shell follow-ups (M5 sprint 1)

- **`/metrics` moved** to the API port (default 3001) for profiles with `core.ui-shell`, because the web server does not proxy it. If an
  operator wants one port, add an authenticated `/metrics` proxy (a token in a setting) rather than proxying it open.
- **The typed client is generated for the `full` profile.** A profile that lacks a module has client functions for routes it does not serve (404).
  A per-profile client is possible (`openapi:generate` already knows the profile) if a screen ever needs to know.
- **No per-page SSR options.** Every page of a module goes through one catch-all route, so a page cannot set `ssr = false` or `csr = false`.
  Add an optional `render: { ssr?: boolean }` to `UiRoute` if a page needs it (a chart page that cannot render on the server).
- ~~**The proxy has no timeout of its own**~~ Done in M5 sprint 4: `API_TIMEOUT_MS` (default 30000, `0` for none): a limit on silence, 504 from the proxy, the page server's own calls fail the same way; event streams are exempt. (was: (an event stream must outlive any). If a slow API call should give up, add `API_TIMEOUT_MS` for
  non-stream requests. Sprint 4 (inbox stream) decides.)
- **`openapi-typescript` declares a peer of TypeScript 5**; the repository uses 6. It works; move to a release that lists 6 when there is one.
- **Dev dependencies of the web app are heavy for the image build:** `@scorpion/testing` (Testcontainers) and Playwright come in through the
  e2e tests. Moving `e2e/` to its own package would shorten step 4 of `docker/Dockerfile`.
- **The icon set is a dozen drawn paths** (`Icon.svelte`). A module that needs another name gets a dot. Add icons as screens need them, or take a set when more than about thirty are used.
- **`GET /ui/navigation` is asked on every page request** (twice with `/auth/me`). They are cheap, but a short per-session cache in the web process would halve the calls if profiling asks for it.
- **The legal page shows the API's title as its heading;** a text that starts with `#` has two. Documented in the module README; a later change could drop a leading `h1` of the text on the server.

## Sign-in and profile screen follow-ups (M5 sprint 2)

- ~~**The OIDC callback answers a failure as problem+json in the browser.**~~ Done in M5 sprint 4: ADR-0029: a browser is redirected to `/login?error=<code>` (a fixed list); other clients keep the problem answer. (was: A sign-in of an account that waits for approval (403 `account-pending`), a refused state (400) or an
  unreachable provider (502) end on a page of raw JSON, because the callback is a navigation and not a fetch. Redirect to `/login?error=<code>` (a fixed list of codes, never
  text from the provider) and show the text on the sign-in page, as `?notice=check-mail` already does. An API change, so it needs a decision; `apps/web/e2e/oidc.spec.ts` shows the JSON today.)
- **The instance's default language has no public route.** `defaultLocale` is a setting of `core.notifications` and nothing public returns it, so the order of ADR-0022 is the person,
  then the browser, then English. Expose it (for example in `GET /branding`, which would need a decision on which module owns it) and pass it to `negotiateLocale()` as `instanceDefault`.
- ~~**A token form that offers every permission the caller holds.**~~ Done in M5 sprint 4: `GET /account/permissions`; the form offers what the caller holds, with descriptions. (was: The profile page offers the permissions of the role `user` of `core.identity` (the list is `permissions.ts`),
  because no route lists the caller's own permissions (`GET /roles` is the administrator's). A `GET /account/permissions` (id and description) would let the form offer the scopes
  of every module, including those of later milestones.)
- **The theme is kept in the browser only** (the buttons in the header, `localStorage`). A user preference `ui.theme`, registered by `core.ui-shell`, would follow the person to another device.
- **A second mailed link in the same tab is not read.** A reset, verification or link page reads `#token=` once when it loads; opening another link by changing only the fragment
  (a paste into the address bar of the same tab) does not load the page again. Listen to `hashchange` if people do this.
- **No second password field** on the reset, registration and change forms; a typing error is corrected with a new reset. Add a "show the password" toggle (ASVS allows it) before a confirmation field.
- **The wait of a throttled sign-in is text, not a clock.** The page says "try again in 30 seconds" and does not count down or enable the button again by itself.
- **Texts that come from the server are English.** A 422's field messages, a problem's `detail` and the `message` of the error page are the API's words. Map the common problem types to catalogue
  keys, or send the language with the request and let the API answer in it.
- **The password-manager evidence has no manager.** `password-fields.spec.ts` proves the markup a manager relies on and that nothing blocks it; a headless browser has no extension to drive.
- **The first-run token cannot be asked for again from the page.** When it has expired (one hour) the form says to restart the server or run `scorpion create-admin`; a command that issues a new one
  without a restart would help operators.
- **A private window cannot resume a re-authentication at a provider.** Without `sessionStorage` the intended action is lost and the person lands on the start page; the dialog does not warn of it.

## End-to-end test follow-ups (0.7.0 release)

- **Two e2e flakes in shard 1/3 of CI, seen on the M7 sprint 7 pull request and the 0.9.0 release pull request** (both passed on a re-run of the failed job, and in a full local run of 426 tests). `profile.spec.ts` "follows the preference of a person over the browser…" timed out on `getByLabel('Username')` of the login page after a sign-out, and `organisations.spec.ts` journey 2 saw 5 rows after "Next" where the second page has 1 (the URL had changed, the table had not within 5 s). Neither touches code of sprint 7. Both wait on a page that reloads the layout's four calls plus the page's own; if they come back, give the failing step a wait on the response, not a longer timeout, and look at the load of the runner.
- **Only `page.goto` waits for hydration.** A click that loads another page with a full reload, or a form that redirects, is not covered by the wait (`hydrated(page)` in `apps/web/e2e/support/fixtures.ts` can be called by hand). Look at the first failure of any E2E test that types or presses a key right after a navigation before looking elsewhere.
- **A retry is only as good as its fixtures.** `createUser` now accepts the account of a failed first attempt (409 on a retry), but a test that changes the account before it fails (password, email) leaves a different state for the retry. Prefer tests that create what they change.

## Operations screen follow-ups (M5 sprint 4)

- **The audit list pages by offset, so "Load more" can repeat or skip a row** when entries arrive while the page is open (the page keeps each id once, so it never repeats, but a skipped row is possible). A cursor (`before=<occurredAt>,<id>`) on `GET /audit` would make it exact; the CSV export already reads by keyset.
- **The Logs page shows the name an account has now, not the name it had.** A renamed account shows under the new name (usernames are not renamable today). Events carry ids only, on purpose (a purge cannot erase an append-only table).
- **Reading the audit list leaves no trace**, and neither does a refused read of it (403). The CSV export, one entry and every other refused read are on record. If an auditor wants "who looked at the list", sample it (one entry per person and hour) rather than one per page.
- **The "transport is none" banner has no browser test.** The e2e stacks run with a relay that does not exist (`smtp`) so that the delivery job leaves queued mail alone; switching the transport in a journey would race that job. The condition is rendered from `status.transportIsNone`, which the service tests cover.
- **Permission descriptions are English.** `GET /permissions` returns the text a module declares (`description`); a German administrator reads English under the roles page and the token form. A catalogue key per permission would fix it (like the labels of settings forms).
- **The API proxy timeout is one number** for every route. A route that is slow on purpose (a large CSV) is protected by the "silence, not total time" rule; a per-route value would need the route table in the web process.
- **Server-side page calls and the browser share `API_TIMEOUT_MS`.** The browser's own `fetch` has no timeout of its own; a hung request there waits for the proxy's 504.

## Inbox and dashboard follow-ups (M5 sprint 4, second half)

- **The live count has no content and no history.** A person who reads mail in another client gets no "new item" toast; the bell only shows a number. A stream of item ids (not content) would let the page add the new row without asking.
- **The stream is per process.** Caps are per server process (`inboxStream.global`); with several API processes the total is their sum. A cap across processes needs the database or a counter in Postgres.
- **A revoked session ends the stream within a heartbeat plus the session cache** (5 s, per process). A cross-process invalidation channel (see "Sessions follow-ups") would make it immediate.
- **The bell's menu shows five items** and has no keyboard roving between them (Tab moves through the buttons and links). A listbox pattern is a later refinement.
- **Widgets load in the browser only** (no server rendering), so the bell and the cards appear a moment after the page. A widget that needs data on first paint would need a `load` like a page has.
- **The dashboard has two cards.** KPI cards are M13; a card needs only a `ui.widget` entry and a component in a module's `ui` entry.
- **The inbox has no cap per person** (see "Notifications follow-ups (M4 sprint 3)"); now that a registration request lands there for every administrator, a flood of registrations grows every administrator's inbox. Read items are deleted after `inboxRetentionDays`.
- **The "vocabularies" journey is flaky on its first attempt in a full e2e run** (`admin-settings.spec.ts`, "an Admin adds a term, relabels it, deactivates it and removes it"); alone it passes. The cause is not found; it may be the hydration race of `accessibility-auth.spec.ts` (see below), which `page.goto` now waits out, so check whether it still happens.

## Administration screen follow-ups (M5 sprint 3)

- **Change an e-mail address and force a password reset for another person.** The user detail page has neither (decision of sprint 3); no route acts on another user's address or password. A route that changes an address should mark it unconfirmed and mail the new one, and a forced reset should mail the existing reset link and end the sessions.
- **Reactivate a deactivated account.** `POST /users/{id}/deactivate` has no inverse and the screen says so. A reactivation needs its own permission and an audit entry, and decides whether the old sessions and tokens stay gone (they should).
- ~~**A list of the declared permissions.**~~ Done in M5 sprint 4: `GET /permissions`; the roles page groups by the module the API names and shows each description. (was: The roles page groups permissions by module from the shape of their ids (`core.identity.…`, a known list of two-part namespaces) and shows no description, because `GET /roles` returns ids only. A `GET /permissions` (id, module, description) would replace the heuristic and let the page explain what each permission does.)
- **Declared secrets.** The secrets page lists the secrets that are stored and cannot show one that is missing (a provider's client secret, the mail relay's password); the name an Admin must type is in the module's README. The registry of decision 6 (`settings.secret`: name pattern, description) would let the page list the unset ones and offer a form per name.
- **The labels of a settings form are English.** `.meta({ title, description })` is a text in the schema, so a German administrator sees English field titles under German chrome. Key the titles (`.meta({ titleKey })`) and look them up in the catalogue, or let the schema route take a language.
- ~~**A saved settings form stores every value, defaults included.**~~ Done in M5 sprint 4: the form stores only what differs from the default (`omitDefaults` in `@scorpion/ui-kit`). Settings that were saved before keep their stored defaults until they are saved again. (was: `GET /settings/{module}` returns the effective values (defaults applied) and the form sends them all back, so a later change of a shipped default does not reach an instance that saved once. Send only the values that differ from the default, or let the API merge.)
- **Several administrators editing one form at the same time** get the version conflict and "load the current values", which drops their edits. A field-by-field merge or showing what changed would help.
- **The vocabulary screen edits `en` and `de` only.** A label in another language is kept as it was and not shown. Offer the locales a vocabulary already holds, and a way to add one.
- **A custom role cannot be created or deleted** from the roles page (out of M5's scope); the page edits the permissions of the seeded roles.
- **The deactivation of an account stops its access tokens after the token cache time** (5 s, `tokenCacheTtlMs`), like a revoked token in another server process; there is no cross-process invalidation (see "Sessions follow-ups").
- **`core.authz` and `core.settings` cannot contribute pages** because `core.ui-shell` depends on them. If that matters later (a module that owns its own screens), the shell would have to depend on neither, which means moving the permission check of the navigation out of the shell, and needs an ADR.
- **The icon set** has `lock` now; a `key` and a `tag` would suit secrets and vocabularies (the navigation shows Settings with one icon today).
- ~~**`SchemaForm` shows an array of objects with the first control focused after Add**~~ Done in M5 sprint 4: `SchemaForm` asks before it removes an item (an item nothing was typed in is removed at once). (was:, but does not ask before removing an item. A confirm for a removal that cannot be undone (a provider with a stored secret) is the page's to add.)

## Organisations follow-ups (M6 sprint 1)

- **Hierarchy.** `parentOrganization` and `subOrganization` (parent and child organisations), an `address` and a `foundingDate` are not modelled ([m6-sprint-plan.md](m6-sprint-plan.md) §3 and §11). The table has no parent column; add one with its own ADR when a milestone needs a tree.
- ~~**M7/M8: public read of the Schema.org profile of an organisation.**~~ M7 part done in M7 sprint 3 (Decision 8 refined it, Decision 15 of M6): `GET /public/organisations/{id}` and `…/schema-org` answer for an organisation that is the provider or a consortium of at least one **public** service, through the registry `org.publicReference` (not `org.usage`: the usage count says "has services", the public rule says "has public ones"), never the contact point, rate limited, the same 404 for everything else. M8 still adds the same representation to public API v1 (additive).
- ~~**Who may upload a logo through the blob store.**~~ Closed in M6 sprint 2: a module stores an image through its own route, its own permission and the blob service; `POST /files` and `core.blob.manage` stay for the branding logos of the settings and are not used here. `PUT /organisations/{id}/logo` needs `…organisation.manage` (sprint 4: the scoped `…organisation.edit`, checked in the service), and the service calls `blob.put` (which needs `core.blob.upload`, held by the role `user`) and then `setReference`. Nothing changed in `core.blob`.
- **Logo extras (M6 sprint 2).** Logo variants (thumbnails of a fixed size), a logo fetched from a URL (an outgoing request, so SSRF rules and a timeout), and SVG-only logos (today a raster or an SVG is accepted and the blob store rewrites it; there is no way to require vector input) are not built. The logo hash is public by `GET /files/{hash}`; a private logo is not possible.
- **`address` and `foundingDate`** (schema.org) are not stored or mapped; see the hierarchy entry above.
- ~~**One contact permission only until sprint 3.**~~ Done in M6 sprint 3: the managers of an organisation hold `…organisation.read-contact` through the policy `organisation.member`, with no change in the organisation service; the manager clause is tested (`memberships.lists.test.ts`, `policy.test.ts`).
- **Counting only active accounts** in `memberCount`, in the manager count and in `isApprovedMemberAsSystem` for a deactivated account: a deactivated person has no working session, so their approved membership grants nothing, but it still counts until the purge (documented in the README of `registry.organisations`, M6 sprint 3). Counting active accounts only needs a way to ask `core.identity` for the status of many users at once (see the batch lookup below).
- **An organisation of a type that is no longer registered** (a profile that dropped the module that contributed the type) is listed and readable with `typeKnown: false`, refuses every change, and can still be deleted when no `org.usage` entry counts a reference. A way to move such organisations to another type in one step is not built.

## Membership and delegation follow-ups (M6 sprint 3)

From [m6-sprint-plan.md](m6-sprint-plan.md) §11 and what the sprint found. ADR-0034 records the design.

- ~~**A batch lookup of users in `core.identity`.**~~ Done in M6 sprint 4 (same PR): `users.findByIds(ids)` (one query per 1000 ids; unknown and
  malformed ids left out). The member lists, the request mails (managers and administrators) and the "no manager" notice use it. Counting only
  active accounts in `memberCount` can use it now; not done (see above).
- **The `scoped` route flag** (ADR-0034, the alternative that was recorded and deferred). _Settled in M7 (Decision 12): `service.edit` uses the pattern of M6, so the flag was not built; it stays deferred._ A flag on `createRoute()` that lets the pipeline pass a
  caller who lacks the permission globally, with the service re-check as the guard, would make a delegated route visible to the pipeline instead of
  looking like an ordinary read. It touches `packages/contracts/src/route.ts` and `apps/server/src/pipeline/**` (both ASVS-scoped). Build it in M7 only
  if `service.edit` cannot use the pattern of M6 (a plain permission on the route, the scoped check in the service).
- **Closing the one-request window after a demotion** (ADR-0034): a decision that passed the permission check a moment before a demotion committed
  is allowed once. Taking the row lock before the permission check would close it at the price of letting an unauthorised caller queue behind a
  lock. Not worth it unless a case shows up.
- **Managers removing other managers**, inviting people, an expiry of a membership, a transfer between organisations, roles beyond `member`
  and `manager`, a manager of several organisations through one action, an organisation-level setting for who may decide. (Today only an Admin removes a
  manager; a manager can demote one. Decision 16 and 18.)
- **Mail to the person** when an Admin or a manager removes them, or when a person leaves (a role change is an inbox item only), a digest for the
  deciders, and the "all administrators" fan-out job for more than 1000 holders (see the entry on admin mails above).
- **Reactivation** of a purged person's memberships (there is none: the rows are deleted), and a history view of one membership beyond the audit trail
  (the row keeps only the last decision; a reopened row forgets the old one).
- **A slot in the identity profile page for module sections** (Decision 10) and a notification preference per organisation.
- ~~**Editing by managers (sprint 4, Decision 19).**~~ Built in M6 sprint 4; the follow-ups (a review queue, an inbox item, an instance switch) are in "Editing and screens follow-ups" below.

## Editing and screens follow-ups (M6 sprint 4)

- **Manager edits go live at once (Decision 19).** A review queue for manager edits of the ROR id, the website and the `sameAs` links, an
  inbox item to administrators when a manager changes the contact point or the ROR id, and an instance switch that turns manager editing
  off are not built. Today an Admin sees every manager edit on the critical audit channel (`registry.organisation.updated@1` with
  `by: manager`) and can revert it; relaxing the audit channel is one line in `core.audit`'s `decisions.ts`.
- **A `sort` parameter on `GET /organisations`.** The list sorts by abbreviation, then id on the server, and the administrator's table has no
  sortable columns. A sort by name, type or member count needs a `sort`/`dir` pair on the route (additive).
- ~~**Component tests for a module's Svelte pages.**~~ Settled in M6 sprint 5 without a Svelte plugin in the module projects: the page tests
  live in `apps/web/src` (which has the plugin), load the module's pages by path (as `json-ld.test.ts` does) and render them on the server
  through `apps/web/src/test/ShellHarness.svelte`, a stand-in for the layout with a fixed signed-in person. What is left is a test that
  clicks (see "Membership screens follow-ups").
- **Logo in the list rows and on the administrator's list.** The list shows no logo; `logoUrl` is only in the record. A small thumbnail needs
  a variant of the file (see "Logo extras").

- **An anonymous caller gets 422 before 401 on a route with a required body.** `POST /organisations`, `POST /tokens` and the membership routes
  answer 422 (a problem that names the body fields) to a caller who is not signed in and sends no body, because validation runs before the
  authorization in the pipeline. Nothing is changed by it, but the answer names the schema to somebody who may not read it. Found while writing the
  401 case for the membership routes; the matrix of defect 1 sends a valid body on every route, which hides it. A fix is in `apps/server/src/pipeline/**`
  (ASVS-scoped), so it is not done here.

## Membership screens follow-ups (M6 sprint 5)

From [m6-sprint-plan.md](m6-sprint-plan.md) §11 and what the sprint found.

- **Who decided.** The plan asks for a row that "says who decided and when". `GET /memberships` returns `decidedAt` but not `decidedBy` (the
  field table says no route returns `decidedBy`, `endedBy` or `roleChangedBy`; the audit trail holds the actor), so the screens show the
  outcome and the time only. Showing the name needs an additive field on the decider's row (a username, `null` for a gone account), the
  field table, the walker in `response-fields.test.ts` and a test per reader.
- **Long lists.** The manager section shows at most the first 100 requests and members of an organisation (and says when there are more), and
  the filter of `/admin/memberships` lists the first 100 organisations. A manager of a very large organisation needs a page per list, and
  the administrator a search-as-you-type for the organisation filter.
- **A click-level component test.** The page tests render on the server and fix every state that depends on data; what a click does (the
  confirm, the in-place update, the focus afterwards, the card's request on mount) is proved by the Playwright journeys and the keyboard
  run only. A browser-mode or jsdom harness for module components would let those be unit tests.
- **The dashboard card reads the summary once** when the dashboard opens; a request that arrives while it is open shows after a reload (the
  inbox bell is the live signal).
- **Not in M6 by decision (plan §11), kept here so they are not lost:** a funder or any other type (the `org.type` registry makes them
  possible; they arrive with the module that needs them), contact persons of an organisation, a logo from a URL, an import or export of
  organisations (M13 writes through the service) and a CSV of members.

## Maintainer observations (after 0.8.0)

Found while using the instance; not yet investigated.

- ~~**Horizontal scrollbar in the collapsed sidebar.**~~ Done in M7 sprint 7: the navigation of the sidebar has `overflow-x: hidden`, and `shell.spec.ts` checks in both themes that the collapsed navigation takes no height for a scrollbar (it fails without the class). The tooltip of a collapsed link is clipped by that box, as it already was by the vertical scroll; a tooltip drawn outside the sidebar would need a portal and is not built. (was: With the sidebar collapsed, a horizontal scrollbar appears. Probably the expanded content
  overflows the narrow width; the labels need `overflow-x: hidden` or the collapsed layout must not render them.)
- **Too many 429s when administering the instance.** Clicking through the administration screens quickly hits the rate limit within seconds.
  The limits (`default` and `strict` groups, `apps/server/src/pipeline/rate-limit.ts`, and the settings that feed them) need a review against
  what an administrator's screens call per page (several requests per page load, plus the inbox bell and the dashboard cards). Measure the
  requests per page first, then raise the `default` group or key it so that a signed-in person is not counted like an anonymous caller. The
  catalogue (M7 sprint 4) makes three API calls per load (the list, the facets and `GET /account/permissions`) and repeats them on every filter click, so it is likely to be the worst page; M7 sprint 7 measured the calls per page (below) and changed nothing in the pipeline. The
  pipeline is an ASVS-scoped path (V7, V8): the change needs the chapter files or the `asvs-no-impact` line and a test that the public
  endpoints (login, register, token use) stay limited.

  **A v1 call is a token call** and does not draw from the browsers' address bucket; the numbers (one v1 call is one API request, the documentation pages make 3 to 5 and the reference 2) are under "Public API follow-ups (M8 sprint 3)".

  **Measured in M7 sprint 7** (nothing in the pipeline or in a limit changed). Method: the e2e stack with the API's request log on, a signed-in
  person in a fresh browser, every `/api/` request counted at the API, whoever made it (the browser, or the web server's loaders, which forward
  the caller's address). The measurement script was a throwaway Playwright spec; the numbers are from 0.9.0 on the `full` profile.
  Every call below is a `GET` in the `default` group; none is `strict` (the strict group holds sign-in, registration, password, upload and
  token routes, which no page load makes). The bucket is per client address, not per person (a session cookie is not a key), so the calls of
  a browser and of the web server's loaders on its behalf, and of everybody behind one office address, draw from the same 120 and refill
  at 2 a second.

  | Page and step                                              | API calls | What they are                                                                                             |
  | ---------------------------------------------------------- | --------: | --------------------------------------------------------------------------------------------------------- |
  | Any page, the **layout** (every load and every navigation) |         4 | `ui/navigation`, `branding`, `auth/me`, `preferences` (the language), run again by the web server         |
  | The shell, once per full page load                         |         2 | `notifications/inbox/unread-count` and the `inbox/stream` (the bell); none on a navigation inside the app |
  | Dashboard, User                                            |         7 | layout 4, bell 2, `memberships/summary` (the card)                                                        |
  | Dashboard, administrator                                   |         8 | layout 4, bell 2, `users/pending`, `notifications/status` (the cards)                                     |
  | **Catalogue**, load                                        |         9 | layout 4, bell 2, `services`, `services/facets`, `account/permissions`                                    |
  | **Catalogue**, a filter click or a sort click              |     **7** | layout 4, `services`, `services/facets`, `account/permissions`                                            |
  | Catalogue, a click on "Services" in the sidebar            |         7 | the same                                                                                                  |
  | Service page, view, User                                   |        10 | layout 4, bell 2, record, `services/{id}/schema-org`, `services/schema`, `licenses`                       |
  | Service page, view, member                                 |        11 | the User's, plus `organisations`                                                                          |
  | Service page, view, manager                                |        13 | the member's, plus `account/permissions`, `account/memberships`                                           |
  | Service page, view, administrator                          |        13 | the User's, plus `account/permissions` and `organisations` twice                                          |
  | Service page, a click on Edit (member, manager, admin)     |         1 | `licenses`                                                                                                |
  | Administration, users, load                                |         7 | layout 4, bell 2, `users`                                                                                 |
  | Administration, users, a sort click                        |         5 | layout 4, `users`                                                                                         |
  | Administration, settings, load                             |         7 | layout 4, bell 2, `settings`                                                                              |

  Reading it:

  - **The layout is the cost of every click.** Four calls that answer the same thing each time (who is signed in, what the menu is, the
    branding, the language) run again on every navigation, a filter or sort click included (the load of the catch-all route depends on the
    address). That is more than half of what a click costs (4 of 7 in the catalogue, 4 of 5 on an administration table). At 2 a second
    sustained, 5 to 7 calls a click is **about 17 to 24 clicks a minute** and a burst of 17 to 24 clicks from rest; a person clicking through
    administration pages reads the rate limit within the minute, which is what the maintainer saw. This, not any one page, is where to look first.
  - **The catalogue is the worst page per click** (7) and a manager's or an administrator's service page the worst per load (13), so the
    catalogue's three calls are not the worst case by themselves: its own three are the smaller part.
  - **`GET /account/permissions` can be replaced by what the navigation holds.** The catalogue asks it only to learn whether the caller may
    create a service (`registry.services.service.create`), and `/services/new` is a page that the same permission gates, so
    `navigation.routes.includes('/services/new')` gives the same answer with no call. The navigation is not in `UiLoadContext` today, so
    this adds a field to the load context (not to the navigation contract) and is left for the pull request that deals with the limits.
    The service page's form reads the same list for a manager and an administrator (the wizard's provider list does as well) and could
    use the same shortcut or a single `GET /services/{id}` field (`allowedActions` already says what the caller may do).
  - **Cheapest changes, in the order of what they save** (all outside this sprint): (1) the layout loads only what changed (`preferences`
    only when the session changes, `branding` once per full load, the navigation once per session and again when roles change); the web
    server can keep them for the length of the person's navigation or the browser can keep them in the page data, `invalidate` when a
    save changes them. (2) The service page loads `licenses`, `services/schema` and `schema-org` only when a reader needs them (the
    licence's name could come in the record, the stage label with the record as the sprint 6 entry says, the profile only for the
    JSON-LD block). (3) The catalogue's `account/permissions`, as above. (4) Only then a change of limits: a higher `default` group, or a
    bucket per signed-in person next to the address, with its own V7 and V8 entries and a test that login, register and token use
    stay limited.

- **Account pictures are not used anywhere.** A person can upload an avatar (`PUT /account/avatar`, shown on the profile page), but it appears
  in no other place. Expected: the header's account menu and the member lists (the organisation page's member list and the manager's
  member table). The member list route returns usernames and join dates only, so showing a picture needs an additive field (the avatar's
  file hash, never an address) in the member list and the decider's row, an update of the membership field table in
  `docs/security/authorization.md` and the walker in `response-fields.test.ts`, and a fallback (initials) for a person without one. The
  header needs the avatar in `GET /auth/me` or `GET /account/profile` (check what the shell already loads).
- **Use an icon library instead of hand-drawn SVGs.** The shell draws its icons from a small table of paths in
  `apps/web/src/lib/components/Icon.svelte` (about 20 names; `Bell.svelte` of `core.notifications` has its own SVG). The maintainer recommends
  [Tabler Icons](https://tabler.io/icons) (MIT, outline style on a 24 x 24 grid like the current ones). Decide how to ship it (the Svelte
  package `@tabler/icons-svelte` imports per icon and tree-shakes, or the SVG set copied into the repository, which avoids a runtime
  dependency and fits the CLAUDE.md rule to justify new dependencies), keep the `name` string of `ui.nav` entries working through a mapping (an
  unknown name still falls back to a dot), and check that the icons stay out of the accessible name (`aria-hidden`). A side finding: nav
  entries use names the table does not have (`inbox`, `mail`, `settings` in the notifications and registry modules), so those entries
  already show the fallback dot; a library mapping would fix them, and until then a test could fail on a `ui.nav` icon that is not in the table. _Done in M7 sprint 7 for the side finding: `inbox`, `mail` and `settings` are drawn (the table moved to `packages/contracts/src/icons.ts`), and `apps/server/src/ui-routes.test.ts` fails when a `ui.nav` entry of the full profile names an icon the table lacks. The library itself stays open._

## Services follow-ups (M7 sprint 1)

- ~~**Facet semantics are sprint 4's.**~~ Done in M7 sprint 4: the entry shape changed (ADR-0035 addendum) and `fieldValueFacet()` serves a value in `svc_field_value`. (was: The `service.facet` entry carries `where(selected)` (the condition for a selection) and `values(scope, db)` (counts over the services a scope matches); the four seeded facets implement both and are tested, but the catalogue (sprint 4) decides which filters it passes as `scope` (Decision 13: all the other facets and the search). If sprint 4 finds the shape too narrow for the M9 category facet (a value held in `svc_field_value`), change the entry before M9 contributes one.)
- **The OpenAPI body of `POST /services` documents the shipped fields only.** A deployment's own configured fields are accepted at their paths (the body is a loose object) and validated by the service, but they are not typed in the generated client. `GET /services/schema` (sprint 5) gives the browser the full schema; a generated per-profile OpenAPI body is not planned.
- **The slug history holds the current slug too** (ADR-0035), so one unique index decides whether a slug is free; the plan wrote "the old slug is written to `svc_slug_history` on a rename". A rename (sprint 2) adds a row and keeps the old ones. A view of the history per service is not built.
- ~~**Message keys of the config have no catalogue yet.**~~ Done in M7 sprint 5: the texts (en and de) of the config's keys are in `ui/messages.ts` and a missing key fails `ui.test.ts`. A contributed step uses the same convention. (was: the texts arrive with the wizard.)
- ~~**`./ui` is not exported yet.**~~ Done in M7 sprint 4: the `ui` entry, `ui.routes` and `ui.nav`. (was: The module had no screen in sprint 1.)
- **`core.audit` is the observer, as in M6.** Plan §2 lists `core.audit` as an optional peer of `registry.services`; the module follows `registry.organisations` instead: `core-audit` lists `registry.services` as an optional peer and holds the decisions, so the dependency graph has no cycle.
- **The SPDX list is refreshed by hand in the repository.** The bundled fallback is regenerated with `node packages/integrations/scripts/generate-spdx.ts` after the pin in `spdx-pin.ts` moves; nothing reminds the maintainer when a new SPDX release appears. A scheduled workflow that opens a pull request, or a Dependabot-style check, is not built. The live list is fetched at most once a day and cached in `svc_license_cache`.
- **A custom licence** (`LicenseRef-…`) and an expression such as `MIT OR Apache-2.0` are refused: only one SPDX id is accepted (plan §12).
- **The field type `check` cannot ask for more than a vocabulary term and an SPDX id.** `FieldEnv` is closed on purpose; a contributed type that needs another lookup (an ORCID, a ROR id, an EDAM term) extends the interface with an ADR, or does its work inside its own module's route.
- **`create` is Admin-only until sprint 2** (plan §5 item 8); the event carries `by: 'admin' | 'member'` already so the payload does not change. _Done in sprint 2: an Admin or an approved member of the chosen provider._

## Services follow-ups (M7 sprint 2)

- **Nobody owns a service by having created it.** A creator who later leaves the provider loses the right to edit, as the policy reads the provider's membership at every call (ADR-0036). A "created by" owner, or an explicit list of editors per service, is not planned; the provider's managers and Admin can always step in.
- **The policy costs two reads per scoped check, and a record asks up to three.** `policy.ts` loads the provider and asks `registry.organisations` on every call (no cache, so a demotion is seen at the next call). A record view asks `edit`, `edit-identity` and `read-contact` once each. That is fine for one record; a list of rows with `editableFields` would need a batched policy read or a per-request memo, and the catalogue (sprint 4) deliberately has no such column.
- **A `PATCH` replaces a list as a whole.** `sameAs` and `consortia` are replaced by the list in the body (`null` empties them); there is no add or remove of one item, and two editors who change the same list at once get the last write. Per-item operations are not planned.
- **The contact point is cleared as a pair, with both parts `null`.** `contact: null` as a whole is not accepted (the nested object is addressed by the pointers of its two fields); the form of sprint 6 sends both. Revisit if an API client finds it awkward.
- **The body of `PATCH /services/{id}` documents the shipped fields only,** like the create body: a deployment's own configured fields are accepted at their paths and validated by the service, but are not typed in the generated client.
- **`by` in `registry.service.updated@1` is the highest group the request needed, not the person's role.** A manager who edits only descriptive fields is recorded as `member`; the actor id says who. Someone who wants "all edits by managers" in the critical channel changes the decision in `core.audit` and adds `by` to the payload rule; the plan keeps every update ordinary.
- **A change of case in a slug rewrites the spelling in the history.** `Foo` to `foo` updates the history row instead of adding one (the index is case-insensitive), so `redirectedFrom` shows the new spelling. Nothing links to the old spelling in a way that matters; a second row per spelling is not worth a second index.
- **The identity fields are a table in code (`IDENTITY_FIELDS`).** A deployment that wants another field to need a manager (a `license` that only managers set, say) changes `field-rules.ts`; making it configuration would let a bad config weaken the rule, so it stays code.
- **An inbox item to the provider's managers when an Admin or another manager changes the identity, or when a Reviewer publishes,** is sprint 3's notice for the publication only; for the identity it is in the plan's list of things left out (§12). _Done in sprint 3 for the publication notice (`registry.service-publication`)._

## Services follow-ups (M7 sprint 3)

- **`license` is not a property of schema.org `Service`.** The plan maps the SPDX licence to `license` (§3); schema.org defines it on `CreativeWork` and `Product`, so an external validator reports a warning for a `Service` (`builder` test pins it as the one documented exception). Alternatives if it matters to a consumer: `termsOfService` with the licence page, or a `subjectOf` node of type `CreativeWork` with the `license`. Decide with the first consumer (M8 or a crawler report); the property is additive either way.
- **The cache lifetime of a public answer is 60 seconds** (`Cache-Control: public, max-age=60`, a constant in each module's `routes.ts`). The server keeps no copy, so an unpublish is a 404 at the next request; a shared cache in front of the instance can still serve the old 200 for up to a minute. It is not a setting. If an operator needs `no-store` for a deployment, make it a setting of `registry.services` rather than a number in code. No `ETag`/conditional request is built for the public routes.
- **The public routes are unauthenticated reads that hit Postgres.** They are rate limited by the `default` group (120 a minute per address) and one public read is one statement for the record plus one for the organisation names (and, for the profile, one per organisation node and the contributors). A CDN or a short in-process cache would absorb a crawler; not built. The prototype showed the pipeline needs no change.
- **The public record has no `redirectedFrom`.** An old slug resolves, and the record carries the current slug, so the page of sprint 6 redirects by comparing the two. A caller that wants to know the old slug was used does not get told.
- **A public record needs a provider.** `getPublicAsSystem` treats a service without a provider link as not public (it cannot exist through the service layer: the role has `min: 1`); a row written by hand without one is a 404.
- **`public` on an organisation reference is always true.** The record names provider and consortia as `{ id, name, public }` (the pinned shape of the plan), and by Decision 8 an organisation of a public service is public, so the flag carries no information today. Keep it if a later rule can make an organisation of a public service private; drop it (a v2 of an internal route is cheap) if not.
- **The record has an `id`.** The plan's list of pinned fields omits it; the page, the profile `@id` and the organisation's service list all need it, so it is in both public records and in the pinned lists of `public-records.test.ts`.
- **`JsonLd` takes the serialised string, not the profile.** ui-kit cannot import `registry.organisations`, so the component's one input is the output of `serializeJsonLd` and it refuses (throws) a string that holds `<`, `>`, `&`, a line separator or is not JSON. The pages call `serializeJsonLd` themselves; the service page of sprint 6 does the same.
- **The publication notice has no digest and no per-service opt-out.** It goes to the managers of the provider and the creator at the moment of publishing, once per change; a person switches the mail off through the category `registry-service`, the inbox item is always written. A person who is both a manager and the creator gets one item. No notice goes to the members of the provider (plan §7 item 6: managers and creator only) and none for a change of identity (§12).
- **The notice reads the provider at send time.** A service moved between providers in the same moment as a publication notifies the managers of the provider it had when the publication committed.
- **A contributor that throws is skipped and logged**, not an error: the profile (and the public page) must not depend on another module being healthy. A test fixture proves it; a metric for skipped contributors is not built.

## Services follow-ups (M7 sprint 4)

- **The facet entry shape changed in sprint 4** (ADR-0035 addendum): `where(selection, serviceId)` and `values(matching, db)` replace `where(selected)` and `values(scope, db)`, and `unknownOf` and `labelsOf` are new. No contributor existed yet, so nothing broke. M9's category should use `fieldValueFacet()`; if its values need a label from `kpi.framework` it brings a `labelsOf`. (Done in M9 sprint 3: the facet `kpi-set` has its own `where` over `kpif_service_set`, `labelsOf` and `unknownOf`; `fieldValueFacet` was not usable because the link is not in `svc_field_value`.)
- **The facet lists are not capped.** A facet draws every value with a service in the set: a few hundred providers would make a long list. Not a problem at today's numbers; when it is, a "show more" and a search inside a facet belong to `Facets` in `packages/ui-kit` (the API already returns the values by count).
- ~~**A stored licence that SPDX no longer lists**~~ Done in M7 sprint 7: `unknownOf` takes the database as a third argument and the licence facet accepts a value a service has (`catalogue.test.ts`: counted, chosen, returned; a value nobody has and SPDX does not list is still a 422). (was: it shows in the licence facet (it is counted) and is a 422 when chosen as a filter (`unknownOf` asks the SPDX list; a deprecated id is accepted, a removed one is not). Make `unknownOf` for the licence accept what a service has, if it ever happens.)
- **The sort by stage is by the term key** (`DEV`, `DEMO`, `PROD`, `TERM`), not by the vocabulary's order or label. Sorting by the vocabulary's `sortOrder` needs the terms in the query (as the provider sort does with the names); not built.
- **The sort by provider asks the organisation module for every provider's name** (one call, then the order is given to the query as a position list). Fine for hundreds of providers; with thousands, an `org`-side ordering or a denormalised name in a read model is the fix.
- **Performance, as measured.** `service/catalogue.test.ts` pages 300 generated services and counts four facets under two active filters (rows, total, the organisation links and one count per facet) in about 45 ms on a local Testcontainers database (the test allows 2 s); the indexes on `stage`, `license`, `lower(name)` and the organisation links cover the filters. No index on `svc_field_value (field_key)` alone is added: the unique index `(service_id, field_key)` serves the `exists`. A profile of 10k services has not been measured; if it is slow, the next step is a materialised read model refreshed on the service events, as the plan says.
- **The count of a facet is a count of services, not of rows.** A service with two consortia counts once in each; the sum of the consortium counts can exceed the total. That is the standard behaviour of a multi-valued facet and is documented in the README.
- **The catalogue's `slug` sort is in the API and not in the table** (no column shows the slug). The screen offers name, provider and stage.
- **Unknown query parameters of `GET /services` are filters**, so a misspelt `page_size` is a 422 naming it ("There is no filter") rather than being ignored. The OpenAPI document names the four seeded filters and the sort; a contributed facet's id is documented by the registry, not by the schema.
- **`UiLoadContext` has a `locale`** (added in this sprint) for a page whose API call returns labels in one language. The other pages still take their labels from the registry entries' `labels` in the browser; they could use it too.
- **The icon is 32 px in the table and loads the stored file as it is.** A thumbnail size (a query on the file route) would save bytes for large icons; the blob store re-encodes at upload but keeps one size.

## Services follow-ups (M7 sprint 5)

- ~~**How a contributing module's `ui` entry reaches the wizard.**~~ Done in M9 sprint 3 (ADR-0040 addendum): a fourth export `wizardExtensions: { widgets, applies, sections }` that the shell forwards once to a registry in `@scorpion/ui-kit`; the fixture of the page test goes through the same forwarding.
- ~~**A step that `applies` hides cannot have a required field.**~~ Done in M9 sprint 3: the serialisable `showIf` on a field and a step; the server drops a hidden field and does not require it.
- **The browser's schema is looser than the server's where the server needs data or normalises.** A reserved or id-shaped slug, a licence SPDX does not
  list, a stage nobody declared, a URL with credentials and a name that is long only before its white space is collapsed pass the browser's check and
  are a 422 on the field. The other way round (a value the browser refuses and the server accepts) is a bug and the agreement table fails on it.
- **The lists of organisations are the first 100.** A provider list for an administrator, or a consortium list, with more than 100 organisations is cut
  and the field says so; a searchable organisation picker (the `GET /organisations?q=` call exists) belongs to the widget when a profile has that many.
- **The licence widget has no keyboard model of a combobox.** The results are a list of buttons below the search (Tab and Enter reach and choose them),
  announced with a status line; an arrow-key listbox would be quicker to use and is more to maintain. Revisit with the first accessibility report.
- **The wizard does not create the icon in the same request.** The blob refers to the service by id, so the icon is a second request on the screen after the
  creation (the same as the organisation's logo). A creation that fails leaves no icon to clean up; a person who closes the page before uploading adds it
  from the service page (sprint 6).
- **The wizard has no draft.** What is typed lives in the page: a reload asks first and then loses it. A draft in `localStorage` would keep a secret-free
  form across a reload; not built.
- **The JSON console edits the nested object as it is,** not what the server stores: a key it adds that no field owns is reported and the server would
  answer 422. It is a development tool and has no history or schema hints.
- **The messages of the config are English and German only,** like the rest of the catalogue; a contributed step brings its own keys (`t(key)` shows the key
  when a language lacks it, and the contributing module's own catalogue test is where that is caught).

## Services follow-ups (M7 sprint 6)

- **A bare layout for the public pages.** The pages draw nothing from a session, but the shell's layout around them still draws the sidebar and the header
  from the visitor's own session (an anonymous visitor sees the public navigation, a signed-in one theirs). A public page that must look the same for
  everybody, or be embedded, needs a layout without the sidebar; a change to the shell, with its own test.
- **A public label for the stage.** The public service page shows the stage as its vocabulary term (`PROD`), because the labels are behind
  `GET /services/schema` (a permission) and the public record carries the term only. A public route for the labels of one vocabulary (or the label in the
  public record, which is an additive change of v1 and of the pinned list) would let the page say "In production". Needs an ADR note: it makes the
  vocabulary's label public.
- **No Make public button while `service.allowPublic` is off.** The API offers `publish` only while the flag is on, so a page that is reloaded shows no
  button and no reason; the explanation appears only for a page that was open when the flag changed (the 409). A Reviewer who wonders why nothing can
  be made public has to read the settings. If it matters, `allowedActions` cannot carry it (it lists what may be done); a separate field on the record
  (`publishBlockedBy: 'allowPublic'`) would, as an additive change.
- **The service page makes four calls for every reader** (the record, the profile, the schema for the stage label, the licence name), and a manager's form
  adds `GET /account/memberships` or `/organisations` and `GET /account/permissions`. Measured in M7 sprint 7: 10 for a User, 11 for a member, 13 for a manager
  or an administrator (the table under "Too many 429s"). The stage label could come with the record, and the licence name from the SPDX cache.
- **The edit form has no draft and no conflict check.** Two people editing one service: the last save wins, field by field (a patch names only what
  changed), and nothing says that the record changed under the form. An `updatedAt` precondition (`If-Unmodified-Since`-style) is not built.
- **The public organisation page lists services by name only,** as the public record does (`{ id, slug, name }`): no stage, no licence, no icon.
- **A public service has no link back to a list.** There is no public catalogue (plan §12); the public pages link to each other through the provider and the
  groups only.

## Public API follow-ups (M8 sprint 1)

- **v1 token calls and the browser's address bucket (measured).** Before M8 a token call drew from the same `ip:default` bucket as the browsers on its
  address; now it has its own `ip-token:default` bucket (ten times the group's size) and the token's own bucket. Measured in
  `public-api-routes.test.ts` with a bucket of 3: after four browser calls from one address a token on that address still gets its three, and the browser
  is still refused afterwards; two tokens on one address each get their three; eleven tokens on one address get 30 together. The calls per page of the web
  app (the table under "Too many 429s") are unchanged: they are session calls and still count against the browser bucket.
- **The server URL of the document is the request's origin.** Behind a proxy that does not pass `Host` it names the internal address; `config.ORIGIN`
  (the public origin that mail links use) is the alternative if that happens.
- **CORS and anti-automation are outside the four ASVS chapters.** ASVS 5.0 has CORS in V3 and rate limits in V2; the entries of V7 and V8 cite only the
  requirements those tests prove (7.2.1, 7.4.1, 8.1.1, 8.2.1, 8.3.1). If V2 or V3 are ever claimed, the CORS and limit tests of `public-api-routes.test.ts`
  and `pipeline/cors.test.ts` are the evidence to tag.
- **The contract-test walker matches a route's `'GET /path'` string in a file that calls `v1ContractTests(`.** A comment with the string satisfies it; a
  review catches that. A stricter walker would register the route object, which separate test files cannot share.
- **A session cookie is accepted on `/api/v1`** like on any route. If v1 should be token-only, the pipeline needs a per-route "tokens only" flag in
  `packages/contracts/src/route.ts` (an ASVS V8 scoped file); not planned.
- ~~**The preflight answer lists the methods v1 has overall,** not those of the path asked. Harmless while v1 is read-only; revisit with M10's `POST`.~~ Done in M10 sprint 2: `apps/server/src/preflight.ts` builds one `cors()` per list of methods and picks by the path of the request (`GET, POST, OPTIONS` for `/api/v1/measurements`, `GET, OPTIONS` for the rest); `pipeline/cors.ts` is unchanged. A path that no route has still gets the methods of the whole surface.

## Public API follow-ups (M8 sprint 2)

- ~~**`category` in the service row.**~~ Done in M9 sprint 3: the v1 row has `category` (the name of the KPI set, `null` without one) and `GET /api/v1/services?category=` filters by it.
- **A by-slug read of a service.** `GET /api/v1/providers/{id}` was added in sprint 2, so a client can follow `providerId`; there is no
  `GET /services/by-slug/{slug}` (the internal route follows old slugs with `redirectedFrom`) and no read of a consortium.
- **Names and ids beside the abbreviations.** `provider` and `consortia` are abbreviations as in the legacy API, with `providerId` and `consortiaIds` beside
  them; the organisation names are not in a service row. A client that needs them reads `GET /providers` (consortia are not providers: there is no
  consortium read in v1).
- **Logos and icons in v1.** `logoUrl` and `iconUrl` are paths below the internal API and are not in v1 rows; the Schema.org profile has the `logo` it always had.
  A v1 file route (or an absolute public URL) would add them.
- **`values` (configured fields) in the service record.** Left out: its shape is open. M9 did not need it (the category has its own field and the KPIs their own routes); it stays out until a consumer asks.
- **A comma in an organisation abbreviation.** `provider=A,B` splits on commas, so an abbreviation that contains one cannot be asked for by `provider` (the
  schema allows it; slugs cannot contain one). Repeated parameters would remove the limit; the legacy document does not say which one legacy used.
- **A consortium filter and a `q` search in v1.** The internal catalogue has them; v1 has only the legacy filters and the cheap catalogue ones (`stage`, `license`).
- **`service=` matches current slugs only.** An old slug is a redirect of the screens, not a name of v1.
- **Legacy clients that send `pageSize` above 100** (the legacy default was 1000) get 422, as decided in ADR-0037 decision 11. If that turns out to hurt, a higher
  cap for v1 lists is a decision for the next sprint (the harness checks 100000 only).
- **The contract harness fetches at most 20 pages** in its page-walk case; with more rows it checks the order of those 20 only (fixed in sprint 2 so that it no
  longer compares an incomplete walk with the whole list). A table-driven test of that rule is not written.
- **The services list on 5,000 services (measured, M8 sprint 2).** 5,000 generated services (40 providers, 12 consortia, 0 to 3 consortia each; a throwaway
  test, not committed), one token, calls made in-process through the whole pipeline on a local Postgres 16 (no network, so the times are the server's own), 30
  calls per case after 3 warm-up calls. Median and p95 per request, and the statements sent to Postgres per request, BEGIN and COMMIT included and the
  token check, the authorisation and the audit entry of the call included (`GET /providers?pageSize=100` on 40 rows is the floor at 4.1):

  | Request                                      | Median  | p95     | Statements | Body    |
  | -------------------------------------------- | ------- | ------- | ---------- | ------- |
  | `/services?pageSize=100` (page 0)            | 16.8 ms | 24.3 ms | 6.2        | 30.9 kB |
  | `/services?pageSize=100&page=49` (last page) | 23.7 ms | 29.1 ms | 6.2        | 31.1 kB |
  | `…&provider=MP7` (125 services)              | 23.6 ms | 28.2 ms | 10.3       | 37.7 kB |
  | `…&provider=MP7,MP8,MP9` (375 services)      | 27.5 ms | 30.6 ms | 14.5       | 30.3 kB |
  | `…&service=msvc-00042`                       | 8.8 ms  | 9.7 ms  | 7.2        | 0.4 kB  |
  | `…&stage=DEV&license=MIT` (833 services)     | 20.2 ms | 22.4 ms | 8.3        | 33.1 kB |
  | `/services/{id}`                             | 7.4 ms  | 9.1 ms  | 5.2        | 0.4 kB  |
  | `/providers?pageSize=100` (40 providers)     | 5.8 ms  | 7.5 ms  | 4.1        | 6.8 kB  |

  What it shows: the statements of a page of 100 services do not depend on the number of consortia of the services (6.2 for page 0 and for the last page, from
  the catalogue's page, count and organisation-link reads on top of the 4 or so of the call itself). Each `provider=` abbreviation adds about **4
  statements** (measured: 6.2 to 10.3 to 14.5 for none, one and three); from reading the code these are the lookup of the provider, its member count, and the
  catalogue's check that the id is known, so 50 abbreviations would be about 200 statements, and a batch lookup of abbreviations in `registry.organisations`
  would make it constant (not built). The last page costs about 7 ms more than page 0 (the offset). Not measured: concurrent calls, a network, a cold cache, or more than 5,000 services.

## Public API follow-ups (M8 sprint 3)

- **A v1 call does not count against the browser's address bucket (measured).** Method: the e2e stack on the `full` profile, the API's own
  `scorpion_http_request_duration_seconds_count` (`/metrics`, by route, method and status) read before and after, one fresh Chromium context per page, the
  numbers from the working tree of sprint 3. One `GET /api/v1/providers` with a token is **one** API request, counted in the `ip-token:default` bucket and
  the token's own bucket, and in none of the `ip:default` bucket the browsers on that address draw from (ADR-0037, decision 1; the bucket separation itself is
  proved in `public-api-routes.test.ts`). The pages of the documentation, for comparison with the table under "Too many 429s":

  | Page                                | API calls | What they are                                                        |
  | ----------------------------------- | --------: | -------------------------------------------------------------------- |
  | `/docs`, signed out                 |         3 | `ui/navigation`, `branding`, `bootstrap/status` (the layout's calls) |
  | `/docs`, signed in                  |         5 | the same plus `auth/me`, `preferences` and `inbox/stream` (the bell) |
  | `/docs/reference`, signed out or in |         2 | `branding` (the route's, for the page title) and `v1/openapi.json`   |
  | `/` for comparison, signed out      |         2 | `ui/navigation`, `branding`                                          |

  The reference makes no call of the layout (it is not a page of the shell) and, on purpose, no session call: the language of its one link back is the
  browser's, because the saved preference would cost two more calls signed in (measured: 4 against 2). Each Test Request a person sends from it is one v1
  call (above).

- **What the reference costs (measured, local).** The script is the single-file build of `@scalar/api-reference` 1.74.0: **4,571,171 bytes** as shipped (the
  package's file without its source-map comment; the 17 MB map is not shipped), **1,328,455 bytes** gzip and **991,457 bytes** brotli (adapter-node
  precompresses both and serves them by `Accept-Encoding`). Headless Chromium on the same machine as the stack (loopback, so no network time), 12 runs each,
  the time from the start of the navigation to the first route link of the sidebar being visible: **cold cache** 3 requests, 1,018,195 bytes on the wire,
  median **1,016 ms** (p95 1,050 ms, fastest 964 ms); **warm cache** (the script cached for its year) 3 requests, 26,406 bytes, median **967 ms** (p95 1,022 ms).
  The landing page `/docs` is drawn at a median of **220 ms** (p95 288 ms). So the cache saves the transfer and about 50 ms; most of the second is the
  browser parsing and running the bundle and Scalar drawing the document. Not measured: a real network, a phone, a cold server, the image size per profile
  (below).
- **The images carry it (measured).** The `registry` image built from `dev` is 613,598,713 bytes; built with sprint 3 it is 624,454,105: **+10.9 MB**. That is
  the script (4,571,171 bytes, with its 1,328,455-byte gzip and 991,457-byte brotli copies next to it) and the wrapper's code bundled into the server build;
  `node_modules` is unchanged at 216 MB. With the wrapper as a `dependency` the same image was 740 MB: its production install pulled `@sveltejs/kit` through the
  wrapper's peer dependency, and with it Vite, esbuild, rolldown, lightningcss and TypeScript (+87 MB of `node_modules`), so it is a development dependency
  that Vite bundles (ADR-0038, decision 2). Method: `docker image inspect` on `docker build --build-arg PROFILE=registry` of each tree on the same machine.
- **The reference is English.** `@scalar/api-reference` 1.74.0 has no `locale` option (its bundle holds German and other texts, but `<html lang>` does not
  select them; tried with `de`). When it gets one, the route can pass the browser's language; the landing page and the link back are en and de already.
- **One policy report on load.** The bundle's Zod tests `Function('')` inside a `try`; the reference's policy has no `'unsafe-eval'`, so the browser reports a
  `script-src` violation of `eval`, and Zod falls back. No console message. `e2e/support/reference.ts` (`KNOWN_REPORTS`) names it and fails on any other; if a
  Scalar upgrade removes it the test says so (the list is then emptied), if it adds one the upgrade is read first (ADR-0038).
- **"Powered by Scalar" is a link to the vendor** in the sidebar of the reference. It is followed only by a click and nothing is fetched. Hiding it would be a
  custom CSS rule; not done, as the licence (MIT) does not ask for it and the maintainer did not ask to.
- **`/docs/reference` is reachable on a fresh install** (before the first administrator exists), unlike the shell's pages, which show the first-administrator form.
  It is a document with no record, and its data is the public spec. Revisit only if the shell's rule becomes "nothing but the form".
- **The landing page names "Access tokens" and "Zugriffstoken" in words** (the section of the profile page). A rename of that section's title in
  `core.identity` needs the two texts in `core.ui-shell` changed; the journey (`reference.spec.ts`) finds the section by its title and would fail first.
- **`pnpm openapi:diff` is a small script of our own** (plan Decision 6). What it reads: paths, methods, parameters, request bodies, responses and their media
  types, fields, `required`, types, enums, the bounds, `pattern` and `format` of what a client sends, the security schemes, the scope (`x-permission`) and
  whether a route is public. Its gaps: `additionalProperties`, `oneOf` with a discriminator, response headers, `default` values, the bounds of a response, a
  `$ref` outside the document, `callbacks` and `webhooks`, and a changed description or example (never a breaking change). A renamed field is read as a removed
  one plus an added one. Revisit when v1 grows in M9 to M11; a general differ (`oasdiff`) is the alternative and needs a binary in CI.
- **The release tag is the contract.** `pnpm openapi:diff` compares with the last release tag reachable from `HEAD`; a hotfix branch from `main` and a release
  branch both find it. A pull request that adds a route and a later one that removes it before a release is not seen as a break (nothing was promised).
- **Scalar upgrades:** Dependabot groups `@scalar/*` into one pull request (`dependabot.yml`); the gate is in ADR-0038, "What an upgrade of Scalar has to pass".
  The CSP of the reference and the strict one are two policies to keep; if Scalar ever stops needing `style-src 'unsafe-inline'`, the reference's test is the
  place to tighten it.

## Services follow-ups (M7 sprint 7)

What the plan of M7 (§12) leaves out on purpose, so that nobody has to look in the plan for it:

- **Deleting a service.** `TERM` is the end of a service's life and no route deletes one. A delete needs a `service.usage` check that the KPI modules contribute (like `org.usage`). M9 sprint 3 did the half that exists today: a KPI set or an indicator that a service uses cannot be deleted (409). The registry `service.usage` itself, and what `kpi.framework` does with its rows when a service goes (`kpif_service_set` and `kpif_service_extra_indicator` hold the id without a foreign key, so they would stay), arrive with the delete.
- **Other schema.org properties and types.** A `service.type` registry (the builder takes the type as an argument), `offers`, `availableChannel`, `hoursAvailable`, `areaServed` and `audience` as stored fields (a configured field can map to a few of them), and a contact point in the JSON-LD (the property does not exist on `Service`) are not built.
- **More than one provider per service,** and a custom licence reference (`LicenseRef-…`; see sprint 1).
- **A review queue for member edits,** a request-and-approve flow for publication (a Reviewer or Admin sets the flag today) and a preview of the public page before publishing.
- **A public catalogue,** public facets, anonymous search and a sitemap of public services. The public pages link to each other through the provider and the groups only.
- **Transfer of a service between providers by someone who is not a manager** of both, and a per-service history view beyond the audit trail (and the slug history).
- **A public read of `services` in v1** with the Schema.org representation (additive); M8. _Done in M8 sprint 2: `GET /api/v1/services`, `/services/{id}` and `/services/{id}/schema-org`._
- **Logos and icons in list rows.** The catalogue shows the service icon; the organisation lists, the member tables and the public organisation page's service list show none.
- **The layout's four calls on every navigation** and what to do about them are in "Too many 429s" above, with the numbers.

## Service wizard follow-ups (M7 plan)

- **Field-level conditions and a base path per step.** The wizard config of M7 has `applies` per step only. A `showIf` on a field (show it when another field has a value) and a base path per step (the same field list bound below a nested path, so M9's category step or M15's onboarding fields can reuse a step) are not planned. Source: the maintainer's ISA Wizard questionnaire, which has the base-path idea (`isaLvl + path`) and no conditions; see Decision 21 of [m7-sprint-plan.md](m7-sprint-plan.md).

## KPI framework follow-ups (M9 sprint 1)

- **`rimo:requestedBy`.** An indicator requested by an organisation or a consortium (range `foaf:Agent`) is not in the model: it needs `registry.organisations` as a dependency of `kpi.framework`, a reference column that the service checks, and a usage check so that an organisation with requests cannot be deleted. Decision 2 of [m9-sprint-plan.md](m9-sprint-plan.md); [ADR-0040](adr/0040-indicators-follow-rimo.md) lists it as not used.
- **Metadata on vocabulary terms.** A term has a key, labels, an order and a flag. The UO IRI and symbol of a unit live in `modules/kpi-framework/config/units.ts` and the RIMO IRI and comment of a service category in `config/rimo-seed.json`, so an administrator's own unit has no IRI and no symbol and an administrator cannot see a category's comment. A free `metadata` object on a term (IRI, symbol, description, validated per vocabulary) would move both into the data.
- **Instances of `rimo:MeasurementMeans` and `rimo:AutomationTool`.** RIMO 0.2.0 names the classes and ships no instances, so `kpi.measured-by` and `kpi.automation-tool` start empty and an administrator has to fill them before an indicator can name one. A seed of the common ones (log analysis, Matomo, a citation database) needs the maintainers' list.
- **Importing a RIMO or any Turtle file at run time.** The seed comes from a committed copy by our own extractor, which reads only the shape of the 0.2.0 file. Reading an arbitrary RDF file needs a parser as a runtime dependency (a new-dependency decision, with the licence and size in the pull request).
- **German labels for the 16 RIMO categories.** The seed has the English labels and comments of the ontology; an administrator may add `de` labels, and the module ships none. A translation list needs the maintainers' review of the wording.
- **A service-category term that disappears from a newer RIMO.** A key that is in use is deactivated, never deleted; the sets that name it keep the value. How an administrator is told, and how a set is remapped, is not built: it needs a decision when a RIMO version drops a category (ADR-0040, "adopting a new version").
- **The `rimo:hasUnit` of an own unit.** The RDF read (sprint 4) mints an IRI for a unit that has no UO IRI; a consumer that follows `rimo:hasUnit` to the Units Ontology finds nothing there. Linking an own unit to the nearest UO term is a data question that the metadata item above would answer.

## KPI framework follow-ups (M9 sprint 2)

- **Clearing an evaluation.** `evaluation.set` replaces the headline; there is no call that removes it without removing the headline's row from the set. A `DELETE /kpi/sets/{id}/evaluation` is small and has no caller yet.
- **Reading indicators and sets without the administration.** The six pages need `manage`; a plain `user` holds `indicator.read` and `set.read` for the service pages of sprint 3 and has no page of their own for browsing the catalogue of indicators. A read-only list for them needs a decision on where it is linked.
- **`escapeLike` is copied again.** `service/text.ts` has its own three-line copy (as `core.audit`, `core.identity` and `registry.services` do), because importing it from `registry.organisations/public` would make that module a dependency of `kpi.framework` (Decision 2 of [m9-sprint-plan.md](m9-sprint-plan.md) keeps it out). One shared helper would remove four copies.
- **A rename that frees a name for another indicator.** Names are unique without case and a delete frees the name; the slug of a deleted indicator is free too, so a new indicator of the same name gets the same IRI. IRIs of deleted rows are not reserved (services have a slug history; indicators do not). Decide before the RDF reads of sprint 4 are public.
- **The picker of a set loads from the API on the client.** It is the one place that calls `GET /kpi/indicators` from the browser instead of a page loader; the server-rendered page shows an empty picker until the first answer. A loader with the search in the address would make it linkable.
- **The `kept` rule for means and tools is per term.** A deactivated means a row has stays valid for that row; a second indicator that names it is refused. The form offers a deactivated term only where the row has it.

## KPI framework follow-ups (M9 sprint 3)

- **`service.usage` is not a registry yet.** The plan asked for a "`service.usage`-style" contribution. The services delete does not exist, so there is nothing to call it: what is built is the other direction (a set or an indicator that a service uses is a 409 naming `kpi.framework` and the count). When a service can be deleted, `registry.services` declares `service.usage` (like `org.usage`), `kpi.framework` contributes its two tables to it, and the delete removes `kpif_service_set` and `kpif_service_extra_indicator` rows (they hold the service id as a plain column, so nothing cascades).
- **The service section loads on the client.** It draws "Loading the KPIs ..." on the server and fills in after hydration with one call; a no-JavaScript reader sees the heading and the state. The page loader of `registry.services` could carry the call if a contributed section could name data for the loader (a `load` on the section); not built because it adds a hook to the page for one section.
- **Calls added.** The service page makes one call more (`GET /kpi/services/{id}/kpis`) and, once per browser session and only when the service has rows, two reads of vocabularies for the necessity and unit labels (kept in memory); editing adds `GET /kpi/sets?pageSize=100`. The wizard step makes none on arrival (the sets are in the schema's `choices`); a chosen set costs one `GET /kpi/sets/{id}` (and the two vocabulary reads the first time) and each search one `GET /kpi/indicators`. `kpi-framework.spec.ts` counts them. Folding the labels into the answers (`necessityLabel`, `unitLabel` by locale) would remove the two vocabulary reads.
- **The set select lists at most 100 sets** (the service section) and all sets in the wizard (the schema carries them all). With hundreds of sets a searchable picker and a `choices` cap are needed; the page shows every set today.
- **The optional filter of the wizard step by RIMO category is a config of the field** (`config: { rimoCategory }`), not a control on the page. A deployment that wants one wizard per category lists the field with that config; a filter the person sets themselves needs a second select and the sets with their category in the choices.
- **`showIf` governs the create wizard only.** A patch of a stored service ignores conditions (a field is required to stay set whatever another field says), and the browser leaves a field with a condition out of `required` (the server decides). A condition on more than one field (and/or) is not expressible; `oneOf` and `equals` on one pointer were all the module needed.
- **The `category` of the v1 row is the set's name.** Names are unique without case, so the filter is exact, but a rename of a set changes the `category` of every service that uses it; the stable identifier is the set's `id` (`GET /api/v1/categories`). The legacy `type` of an indicator is `number` for an integer (a one-entry map in `service/v1.ts`); `duration` and `percentage` are new and keep their keys.
- **`GET /api/v1/indicators?service=` marks and does not filter.** The legacy documentation said "a `selected` flag"; filtering the list to the service's effective set would make `selected` always true. If a client wants only the effective set, `selected=true` as a filter is the additive way.
- **The wizard step is order 40.** A deployment that adds a step of its own picks another order (the loader names the clash); the KPI step is last in the `full` profile and its end-to-end tests (`services.spec.ts`, `accessibility-wizard.spec.ts`) were changed from three steps to four.
- ~~**No history of a service's KPIs.**~~ Done in M10 sprint 1 ([ADR-0041](adr/0041-measurement-model.md) decision 3): `kpif_service_kpi_history` (append-only, backfilled at the migration, written in the transaction of every change) and `kpisInPeriod(serviceId, period)`. The event still names no indicator. What the history does not cover is in "Measurement follow-ups (M10 sprint 1)".
- **The extras of a service are not checked against the set's necessity.** An extra is `optional` by definition; promoting one to `recommended` for one service is not possible, and not asked for.

## KPI framework follow-ups (M9 sprint 4)

Measurements (a development machine, Postgres in a container; the method is in the README of `kpi.framework`):

| What                                                   | Result                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RDF of the **seeded** indicators                       | none are seeded: a fresh instance writes the catalogue node, 405 bytes of Turtle, 442 of JSON-LD                                                                  |
| RDF of 200 indicators and 10 sets                      | Turtle 179,567 bytes (7,398 gzip); JSON-LD 254,124 bytes (8,162 gzip)                                                                                             |
| `GET /api/v1/kpi/rimo.ttl` / `.jsonld`, 200 indicators | median 15.7 ms / 13.3 ms (first call 22.8 / 18.7 ms); the model alone 5.5 ms                                                                                      |
| `GET /api/v1/indicators?pageSize=100`, 200 indicators  | median 7.9 ms (page 0), 9.8 ms (page 1); `?category=` 6.1 ms; `/categories` 4.2 ms                                                                                |
| Calls added to the service page (browser)              | first visit 3 (`/kpi/services/{id}/kpis` and two vocabulary reads); later visits 1                                                                                |
| Calls added to the wizard                              | on arrival 0; a set chosen 1 (+2 vocabulary reads the first time); each extras search 1                                                                           |
| Image `full`, against `0.10.0-full`                    | 622,953,493 → 624,442,464 bytes, +1.49 MB (+0.24 %), the whole of M9 (sprints 1 to 4) with no new runtime dependency; core-only 619,971,511, registry 623,088,125 |

- **The service page misses the target of "no call added".** One call on every visit and two vocabulary reads the first time. The page loader of `registry.services` could carry the read if a contributed section could name data for the loader; a vocabulary read could be one call for both. Decide when a second module contributes a section.
- **The RDF is written on every request.** At 200 indicators the model is 5 ms and the writer 2 to 5 ms, so nothing caches it; the public pair relies on the ETag and `max-age` for a client and a shared cache. A cache in the process (keyed by the settings version and the latest `updated_at`) is worth adding at a few thousand indicators, or if the public pair gets traffic from crawlers.
- **The public pair cannot be switched off.** `service.allowPublic` switches the public service reads off; the KPI definitions have no such setting (ADR-0040 addendum, decision 6). Add `kpi.framework` setting `publicRdf` if an instance asks.
- **The public pair is not in the v1 document and not on `/docs`.** It is on the internal surface (`/api/internal/public/kpi/rimo.ttl` behind a proxy that mounts it) like `/public/services/{ref}`; the landing page draws the v1 document only. A "public reads" list on the landing page needs the shell to know the public routes (a registry or a second document).
- **The IRI of a deleted indicator is reused** by a later indicator of the same name (ADR-0040 addendum, decision 7). A tombstone of every published slug is the fix, if a consumer stores the IRIs.
- **Means, tools and units have no label in the RDF.** They carry `skos:notation` (the vocabulary key) only; the labels of the vocabulary (`en`, `de`) would need the settings service and a choice of language. The metadata of a vocabulary term (IRI, symbol, description) is the open item above; with it an own unit could name its nearest UO term (`skos:closeMatch`) and the sprint 1 item "The `rimo:hasUnit` of an own unit" closes.
- **A mapped set loses its name in the RDF** (it is the RIMO category), and two sets that map to one category merge. A consumer that wants the sets uses `GET /api/v1/categories`. If the sets must appear in the RDF, mint a `rimo:ServiceCategory` per set and link it to the RIMO one with `skos:broadMatch`.
- **`rimo:requestedBy` is not written** (ADR-0040 section 3).
- **Scalar does not draw a Turtle answer.** The reference page shows the status of the call but not its body, so the e2e journey checks the text with a plain request.
- **No negotiation.** `Accept: text/turtle` on the indicator routes and a page per IRI are out of scope (plan §11).
- **For M10:** the measurements per period (M10 sprint 1), and the KPIs a service had in a period (done, see above). The `rimo:KPIValue` node `<indicator IRI>#value` is the one real values attach to; keep them out of `buildRdfModel`, so the public pair stays definitions only.

## Measurement follow-ups (M10 sprint 1)

- ~~**A token needs three scopes besides the route's to submit (sprint 2 decides first).** `upsertBatch` reads the service's KPIs with `serviceKpis.get` and each indicator's bounds with `indicators.get`, and both check the actor's plain read permission; a token must then name `kpi.ingestion.measurement.submit`, `kpi.framework.set.read` and `kpi.framework.indicator.read` (probed: submit alone 403, submit and set 403, all three 200). Proposed fix: `kpi.framework` offers one trusted `…AsSystem` read of the effective rows with their unit, type and bounds, and `upsertBatch` uses it after its own scoped check; an additive change of `kpi.framework/public`. The alternative (a token with four scopes) is worse for the person who creates it.~~ Done in M10 sprint 2 ([ADR-0041](adr/0041-measurement-model.md), "Amended in sprint 2", item 1): `kpi.framework.effectiveIndicatorsAsSystem` is a trusted read that `upsertBatch` uses after its scoped check; a token needs `kpi.ingestion.v1.write` and `kpi.ingestion.measurement.submit` and nothing of `kpi.framework`.
- **The rows of a KPI set are not versioned.** The history says which set a service had, and `kpisInPeriod` reads the set's rows as they are now, so a set edited later shows its new rows in every month that used it. Version the rows (a `kpif_kpi_set_indicator_history`) if M11's month view must be exact for a changed set.
- **History starts at the migration.** A service whose KPIs changed before `0002` has one backfilled row from the `updated_at` of its set row; a service with extras only starts at the migration, so `kpisInPeriod` answers `null` for the months before. An extra whose indicator was deleted later stays named in the history and is dropped from `rows`.
- **The history trigger blocks the deletion of a service's rows.** Services cannot be deleted today; the deletion needs a migration that drops `kpif_service_kpi_history_guard` and an ADR.
- ~~**XLSX needs its guard first, and brings more packages than planned** (ADR-0041 decision 2): `worker-f`, `unzipper-esm`, `graceful-fs` and `node-int64` besides `saxen` and `fflate`; the `node` entry parses in a worker thread. Decide the entry (`node` or `universal`), write `service/xlsx-guard.ts` with the bomb, the lying bomb, a truncated, an encrypted and a wrong-extension file, and measure the image size, in sprint 3.~~ Done in M10 sprint 3 ([ADR-0041](adr/0041-measurement-model.md), "Amended in sprint 3"): the guard, the `node` entry, the nine packages named, the image size (+9.0 MB, +1.4%).
- **A batch covers at most 120 months.** The migration tool of M13 chunks its history by ten years; if a smaller or larger limit is wanted, change `MAX_BATCH_MONTHS` and the event schema together.
- **A year before 1900 is refused** by `normalisePeriod`: a floor of the module, not of the table. Lower it if an instance has older series.
- ~~**The legacy `kpi` name is not resolved by `upsertBatch`** (it takes ids). One shared function (by id, by name without case, by a header that matches exactly one) is written once for the route of sprint 2 and the adapters of sprint 3.~~ Done in M10 sprint 2: `resolveIndicatorRef` (`service/names.ts`), used by `POST /api/v1/measurements` and `GET /api/v1/measurements`; the adapters of sprint 3 use it per column header.
- **`kpisInPeriod` has no `AsSystem` suffix**, as the plan names it, though it is a trusted read with no actor (ADR-0015's naming). Rename it to `kpisInPeriodAsSystem` with M11's first use if the maintainer agrees.
- **A foreign key to another module's table is written by hand.** Drizzle names a foreign table only through its schema object, which is not part of a module's `public.ts`; `kpii_measurement_indicator_id_fk` is hand-written in the migration. If a second module needs the same, consider exporting the table definitions for foreign keys only, with a lint exception, or a small helper in `packages/kernel`.
- ~~**The history's property tests use a seeded generator** instead of a library; move them to `fast-check` when it is installed (sprint 3) and keep the oracle.~~ Done in M10 sprint 3 (`kpi.framework/service/history.test.ts`, 40 generated histories, the same oracle).
- ~~**`implementation.md` does not yet carry the M10 additions** of the plan's §13 (the history, the usage registry, two additive reads, the XLSX libraries, the scopes), as M9's did in a commit of its own; add them with sprint 5's documents.~~ Done in M10 sprint 5: `implementation.md` lists them under M10, with the two reads of sprint 5.
- ~~**Not measured yet:** the time of `upsertBatch` for 1, 500 and 5 000 rows, and the table size per 1 000 measurements (sprint 5, plan §9 item 6). The two statements per 1 000 rows are the expectation, not a result.~~ Done in M10 sprint 5 ([ADR-0041](adr/0041-measurement-model.md), "Amended in sprint 5", and "Measured in sprint 5" below): 14.7 ms for 1 row, 74 ms for 500, 0.66 s for 5 000, 3.3 s for 24 000; 288 KiB per 1 000 rows with indexes.

## Measurement follow-ups (M10 sprint 2)

- **The legacy `date` and `value` formats were not in the documentation.** FEATURES §3.16 gives the row as `{kpi,value,date}` and says nothing about whether `date` was an ISO date or a time stamp, or whether `value` was text or a number, and the repository holds no legacy source. `date` is `YYYY-MM-DD` (the month end) and `value` the canonical text, with `valueNumber` added ([ADR-0041](adr/0041-measurement-model.md), "Amended in sprint 2", item 9). Check one real answer of the old application against a client of an NFDI or de.NBI user before the release; a `date` that was a time stamp would be a breaking change for such a client.
- **Two trusted reads, not one, were added to `kpi.framework`** (`effectiveIndicatorsAsSystem` and `indicatorsByIdAsSystem`). The second exists because a measurement of a dropped indicator stays and is read by name. If the maintainer wants a single read, the alternative is to give `kpi.framework` a `describeIndicators` for any list of ids and drop the first.
- **The bounds of an effective row come from a second query** in `effectiveIndicatorsAsSystem`. If `serviceKpis.get` should show `min` and `max` too, add them to `effectiveOf`'s columns once and drop the second query.
- **A problem is named two ways.** The routes name semantic problems `[3].kpi` and Zod names the shape errors `3.kpi`; an unknown key of a strict object (a query parameter, an item field) is named in the message with an empty path. One form would need a hook in the pipeline's error mapper (an ASVS scoped path), so it was left.
- **Indicator names are unique by `lower(name)`, not by their normalised form.** Two names that differ only in a composed or decomposed letter can both exist, and `resolveIndicatorRef` then answers "matches more than one KPI" and asks for the id. A unique index on the normalised, lower-cased name would remove the case (`kpi.framework`, a migration).
- **The order of a month's rows ranks the service's indicators in memory** (the name is in `kpii`'s foreign table, which this module does not read) and sorts by `array_position`. ~~It is the expectation, not a result, that this holds for a service with hundreds of indicators and tens of thousands of values; sprint 5 measures `GET /api/v1/measurements` at 50 000 rows (plan §9 item 6).~~ Done in M10 sprint 5: at 49 980 rows of one service (42 indicators over 1 190 months) the first page is 56 ms, a middle page 86 ms and the last page 111 ms, a filtered series 40 ms (see "Measured in sprint 5"); the in-memory ranking of indicators is not the cost at this size.
- **`mandatory` is a key the module names** (`MANDATORY_NECESSITY`: the legacy term and RIMO's `mandatoryFor`). The vocabulary `necessity` has no flag that says "a month needs a value"; if an instance renames or adds a term that should count, give the term that flag in `core.settings` and read it. The reporting reminder of sprint 5 uses the same constant, so one change of rule would change the coverage, the template's mandatory marker and the reminder together.
- **The coverage and the grid use the KPI set as it is now,** not as it was in the month (`kpisInPeriod` could say); M11's month view will want the history. The reminder of sprint 5 uses the set now by design (a dropped KPI is not asked for; its values stay).
- **A non-admin member cannot make a working write token on the profile page.** The write needs the scope `kpi.ingestion.measurement.submit`, and the token form offers only what `GET /account/permissions` lists, which is the role's permissions: a member holds `submit` through the provider policy, so it is not listed (checked by a probe in sprint 2; an Admin sees it). `POST /tokens` with both scopes works, because it accepts any declared permission. Fix before the page of sprint 4 ships a "make a token" hint: either list the scoped permissions a person may hold on some resource in the token form, or let the service check `submit` for the owner of a token that names `kpi.ingestion.v1.write` (the owner still has to be allowed, ADR-0015). The maintainer chose two scopes for sprint 2; this is the cost. The `/docs` landing page lists only `kpi.ingestion.v1.write` for the route, and the reference text of the write names both.
- **A cookie write is refused by the CSRF check in the authenticator, and the test is tagged `[ASVS-7.2.1]`** as the plan asked. ASVS V3 (web frontend security, which carries the CSRF requirements) is not assessed; if it is added, the tag moves.
- **The preflight for a path that no route has** lists the methods of the whole v1 surface, as before; answering with `GET` only (or refusing) is a one-line change in `preflight.ts` if wanted.
- **No delete or correction of a measurement other than an upsert, and no `DELETE /api/v1/measurements`.** Out of scope for M10 (plan §12); a wrong value is replaced, never removed.

## Measurement follow-ups (M10 sprint 3)

- **Image size and dependencies (measured; measured again in sprint 5: +9.68 MB, +1.55%, see below).** `0.11.0-full` is 624 448 911 bytes and this branch 633 461 699 (**+9.0 MB, +1.4%**; the compressed content about 129 MB to 130 MB). New runtime packages, exact versions: `read-excel-file` 9.3.12 (3.5 MB), `write-excel-file` 4.1.1 (2.9 MB), `fflate` 0.8.3 (0.9 MB), `worker-f` 0.1.20, `unzipper-esm` 0.13.3, `saxen` 11.2.0, `node-int64` 0.4.0. Development: `fast-check` 4.10.2 and `pure-rand` 8.4.2. If the size matters, the reader's `universal` entry would drop `worker-f` and `unzipper-esm` (about 1.3 MB) at the price of a slower parse on the calling thread; `fflate` is shared.
- **Parse times (measured, this machine).** CSV, 5 000 rows of 21 columns (591 kB): about 30 ms to parse and map (100 000 values). XLSX, the same data (672 kB): the guard 84 ms and the reader and mapping about 350 ms. A normal workbook is under 100 ms. ~~The time of `upsertBatch` for 1, 500 and 5 000 rows and of the preview of a file on the page are sprint 5's measurements.~~ Done in M10 sprint 5: see "Measured in sprint 5" below (a 5 000-row CSV previews in 22 ms, the XLSX in 222 ms).
- **A 5 000-row file cannot be committed as one batch** (sprint 5 measured it and decided, see "Measured in sprint 5", item "The file limit and the batch limits"; the finding stands and the fix is still open). A batch covers at most 120 distinct months and 25 000 values (`MAX_BATCH_MONTHS`, `MAX_BATCH_ROWS`), and a file of 5 000 rows of one service is more than 120 months or more than 25 000 values. The preview reads it, the commit is a 422 that says to split it. The 5 000-row limit of a file is therefore a parsing limit; the real ceiling is the batch. Lower the file limit to 1 440 rows (120 months of 12 rows) if the two should agree, or chunk by ten years in the migration tool (M13) only.
- **The mapping has no IRI slug.** The plan said a column may be matched by the slug of the indicator's IRI; the trusted read (`effectiveIndicatorsAsSystem`) does not carry it. Add `slug` to `EffectiveIndicatorRow` (kpi.framework, additive) if exports that name columns by slug appear.
- **The template shows the unit's term key**, not its label (`count`, not "Count"): the labels are a vocabulary of `core.settings`, which this module does not depend on. Add the dependency and the localised label with the page of sprint 4 if the key is too terse.
- **Period formats other than ISO** (`DD.MM.YYYY`, `Jan-26`, an Excel date typed as text) are a `period-invalid` problem; an XLSX date cell works. A CSV re-saved by Excel turns `2026-05` into another format; the template's XLSX writes text cells (`@`) against that. Plan §12 keeps other formats out of M10.
- ~~**A problem has a code but no sentence in the answer.** The list of codes is closed (`PROBLEM_MESSAGES`, English); a 422 uses the English sentence, and the page of sprint 4 needs its own words in en and de.~~ Done in M10 sprint 4: the page has a sentence in en and de for every code (`submit.problem.<code>`), and `ui/ui.test.ts` fails for a missing one. The 422 itself stays in English, as an API answer. The form's problems use the position of the indicator as the column.
- **The run history shows the id of the person who ran it** (`actorId`), not a name; the page needs a read of the name (a public read of `core.identity`, or the profile) if "who" should be a name. It is shown only to people who may submit for the service.
- **`GET /kpi/ingestion/adapters` names `measurement.read`** and lists every adapter whatever the service; an instance that wants to hide an adapter does it by not contributing it.
- **A multipart body that is cut or has the wrong content type** is a 4xx from `@hono/zod-openapi` (415 or 422), never a 500 (tested); the body is declared `required: false` because the library otherwise runs the JSON validator on a multipart request (ADR-0041, "Amended in sprint 3", item 14). Revisit when the library separates the content types.
- **The XLSX worker thread cannot be cancelled.** `read-excel-file/node` parses in a worker; a request that times out does not stop it. The guard bounds the work (20 MiB inflated, about 350 ms for 3 MB), so this is a note, not a risk.
- **An upload is rate-limited like any route** (the default bucket). A person who previews many times in a minute (changing the mapping) shares it with every other call; if sprint 4's call counts show 429s, give preview its own bucket. Sprint 4 saw none (a file is 2 calls and a mapping change none); the bucket that does run out is the page loads' (see sprint 4's first item, measured in sprint 5).
- **Scorecard's Fuzzing check** counts `fast-check` by a `from 'fast-check'` line in a `.ts` file when TypeScript is a prominent language of the repository; nothing in a workflow was needed. Check the next Scorecard run shows the score move.

## Measurement follow-ups (M10 sprint 4)

- **The loader makes nine reads for a page with a service**, five of them reference data that does not change within a visit (the adapters, the terms of `necessity` and `kpi.unit`, the value types, and the service's name). They share the caller's default bucket (a burst of 120, then 120 a minute) with the shell's reads. **Measured in sprint 5, in a real browser as a member with the default limits** (the e2e stacks raise them, so the spec lowered them again and waited out the settings cache): changing the month (a page load, about 13 requests of the bucket with the shell's own) **seven times in a row exhausted the burst and the page failed on the eighth** (the month select was gone); a person who keeps going gets about nine loads a minute. The measurement was throwaway and is not committed. **Not fixed in sprint 5, because no small additive change does it:** a bucket of its own needs a third route group, which is `apps/server/src/pipeline/rate-limit.ts`, `packages/contracts/src/route.ts` (both ASVS-scoped paths) and the `rateLimits` setting of `core.settings`, and fewer reads or a cache is a change of the page's loader (`ui/loaders.ts`) or of two other modules, all outside this sprint's scope (the sprint leaves the page as it is). Cheapest first: the loader asks for the reference data once per visit (the adapters, the two vocabularies and the value types do not change when the month does: 5 of the 9 reads); then one read that answers the page's reference data together; then a group `page` beside `default` and `strict`.
- **Preview and the dry run share the default bucket** (sprint 3's note): a file is 2 calls and each "Check the file" 1. No 429 was seen in sprint 4 and none in sprint 5's measurement of them (the page loads are what run out, above); give the two upload routes their own bucket if one is.
- **The bounds of a duration are not shown.** They are stored in seconds and the page has no formatter for `HH-MM-SS`; the value type's `format` is a function of the registry that a page cannot call. Add a `format`-like descriptor (or the bound as text) to `input` if the bounds matter on the form. Looked at in sprint 5 and left: the fix is an optional `boundText` in the descriptor of the value type (`kpi.framework`, additive, one test per seed type) and a line in `ui/ReportForm.svelte`, and the sprint changes no page; the server judges every value whatever the page shows, so the cost is a rejected value that the page did not warn about.
- **The history says "You" and "A colleague", not a name** (sprint 3's item stays open): a public read of `core.identity` for display names, shown only to people who may submit for the service. Looked at in sprint 5 and left: `kpi.ingestion` now depends on `core.identity` (for the reminder), so `identity.users.findByIds` is at hand, and the missing parts are a read of the runs that carries the names (a field in `GET /kpi/ingestion/runs`, the first answer that would hold another person's username: `response-fields.test.ts` and `authorization.md` would name it, and it should show only to people who may submit for the service) and the page's column; a decision about privacy within a provider first.
- **The month list is 36 months.** A correction of an older month is possible by the address (`?period=2019-03`) but not from the select. Raise `MAX_COVERAGE_MONTHS`, or add a month input, if people need to browse further back. Looked at in sprint 5 and left: raising the constant to 120 (the most months a batch covers) is one number and a test (the coverage read itself was not timed at 120 months), but the select would carry up to 120 options and the page's loader would read them on every load; a month input with the address is the better fix and a change of the page.
- **A file's preview shows the first 20 rows**; a problem in a later row is in the list below the table and not marked in a cell. A "show this row" view would need a read of one row of the file (it is never stored), so the page would send the file again.
- **The picker lists at most 50 services** and says so; a member of a provider with more finds the rest by the search.
- **The page has no "download what I reported" export.** The history and the coverage are the only reads of what was recorded; an export is a later feature (FEATURES §3.7 does not ask for one).
- **`label-content-name-mismatch` (axe 4.14) is checked by the e2e spec on every button of the page** in both themes; the drop zone's button, the tabs, "Open", "Show month" and the template buttons have their visible text as their name. Keep it so when a text changes.
- **The nav entry shows for every signed-in person** (the page says so when there is nobody to report for), as the plan's `ui.nav` permission `kpi.ingestion.measurement.read` implies. If a person with no service should see no entry at all, the navigation needs a condition on data (a count of services), which `ui.nav` does not have.

## Measurement follow-ups (M10 sprint 5)

### Measured in sprint 5

Taken on one machine: a virtual AMD EPYC with 14 vCPUs and 31 GB of memory, Linux 7.0, Node 24.21, PostgreSQL 16 (`postgres:16-alpine` through Testcontainers with its default settings, on the same machine, with nothing else running), the service layer over real
Postgres unless a row says "through the pipeline". Medians of 5 runs (3 for 24 000 rows, 7 for the reads). One service with 200 indicators (20 mandatory), integer values. The scripts were throwaway and are not committed; the full table and the reading are in
[ADR-0041](adr/0041-measurement-model.md), "Amended in sprint 5".

| What                                                                                                 | Data                                      | Result                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `upsertBatch` insert / unchanged / update                                                            | 1 row                                     | 14.7 / 12.5 / 14.3 ms                                                                                                                                  |
|                                                                                                      | 500 rows (the API's cap)                  | 73.8 / 75.2 / 83.8 ms                                                                                                                                  |
|                                                                                                      | 5 000 rows                                | 659 / 578 / 660 ms (dry run 78 ms)                                                                                                                     |
|                                                                                                      | 24 000 rows (the ceiling of a batch)      | 3.29 s / 2.71 s / 3.30 s (dry run 372 ms)                                                                                                              |
| CSV and XLSX of 5 000 data rows, 21 columns                                                          | the file                                  | 523 543 bytes and 388 873 bytes                                                                                                                        |
| preview of that file (parse, map, first 20 rows; the service call, no HTTP)                          | 5 000 rows                                | CSV 21.7 ms, XLSX 221.9 ms                                                                                                                             |
| dry run of that file (what the page does next)                                                       | 5 000 rows x 20 columns = 100 000 values  | refused 422 on `rows`, "must hold at most 25000 measurements": CSV 40 ms, XLSX 253 ms                                                                  |
| a file the batch accepts, CSV dry run                                                                | 72 rows x 20 columns (1 440 values)       | 30.9 ms (5 131 bytes); 120 rows x 20 columns (2 400 values): 51.0 ms                                                                                   |
| `GET /api/v1/measurements`, through the pipeline with a token (no cache, audit on)                   | 49 980 rows of one service                | first page 56 ms, middle 86 ms, last 111 ms; 10 rows 53 ms; one indicator's 1 190 rows 40 ms; a 12-month window 42 ms; 5 indicators over 2 years 39 ms |
| table `kpii_measurement`                                                                             | 49 980 rows                               | 288 KiB per 1 000 rows (heap 123 KiB, indexes 165 KiB); 14.1 MiB in all                                                                                |
| image `full` against `0.11.0-full`                                                                   | rebuilt from the tag `v0.11.0`            | 624 440 719 to 634 120 939 bytes: **+9 680 220 bytes (+1.55%)**; sprint 3 measured +9.0 MB, so the page, the reminder and the template cost 0.7 MB     |
| the reminder, one run                                                                                | 1 provider, 50 services, 5 members        | 0.59 s                                                                                                                                                 |
|                                                                                                      | 1 provider, 200 services, 20 members      | 5.1 s (4 000 policy checks, about 1.2 ms each)                                                                                                         |
|                                                                                                      | 20 providers, 10 services, 5 members each | 2.2 s                                                                                                                                                  |
| a member changing the month, default rate limits (real browser, `[kpi-calls]` of the e2e: see below) | a page load of about 13 requests          | 7 in a row, then the page fails; about 9 loads a minute sustained                                                                                      |
| `core-only` image                                                                                    | built and started                         | ready after 4 s; holds exactly the modules of its profile                                                                                              |

**The Data Submission page's calls (the `[kpi-calls]` lines of the full e2e run, both base paths).** Unchanged from sprint 4: the browser sends nothing for the page on arrival (a full load makes only the shell's `GET /inbox/stream`) and nothing when a month is shown (a client navigation, 1 page load); a form save is 1 call (`POST /kpi/ingestion/runs`); a file chosen is 2 (`POST /kpi/ingestion/preview`, then the dry run `POST /kpi/ingestion/runs`); a mapping changed and then checked is 1; a commit is 1; a template download is 1. The loader's 9 server-side reads per page load are not visible to the browser and are what the rate-limit measurement above counts. No 429 appeared in the e2e run (its stacks raise the limits; the default-limit measurement is the row above).

### Decisions and entries

- **The file limit and the batch limits.** A file of one service has one row per month and one column per indicator (the mapping takes each target once, and a month twice in a file is a 422), so the most a file can hold that a batch accepts is **120 data rows**
  (120 distinct months; and 120 rows of the 200 columns are 24 000 values, under the 25 000), not 5 000 and not the 1 440 the sprint 3 entry suggested (120 months of 12 indicators is a layout, not a limit). The 5 000-row limit is therefore a parse limit only: a file of 121 to
  5 000 rows previews and then fails as a whole. **What the page does with it** (checked in `ui/ReportFile.svelte` and `ui/problems.ts` and measured in the service): choosing the file previews it, and with a complete mapping the page runs the dry run at once; that dry run is a 422 whose
  path is `rows`, which `requestProblemOf` does not know, so the page shows "The request was not accepted. Check the file and try again." and nothing says why. **Decision: they should agree, at 120 rows, and the page should say so; neither was changed in this sprint** (the sprint changes the page only for the
  template's link, and the parse limit is a decision of the plan's §2 that a trailing run of blank rows, which a spreadsheet can export, would make hit a file that is fine). The fix is two small changes with tests: `requestProblemOf` reads a `rows` message that names months or measurements
  into `tooManyMonths` and `tooManyValues`, with a sentence in en and de that names 120 and 25 000 (a shared constant, checked against the server's in `ui.test.ts`); and, once blank trailing rows are shown not to count, `MAX_DATA_ROWS` becomes 120 and its sentence follows. The time to a clear message is the preview, 22 ms (CSV).
- **The reminder cannot be run on demand.** The plan and the sprint's brief rely on a "run now" button on the M4 job page; the page lists job runs only (`GET /system/job-runs`) and requeues dead event deliveries. A platform feature, `POST /system/jobs/{name}/run` with the permission of the job page and a button, would give every
  job a manual trigger, and the sent table already makes the reminder safe to run twice. Until then an operator cannot send the reminder for a month the job missed (see the next entry).
- **A day the job did not run sends no reminder that month.** The day check is exact (the 6th by default), so a node that was down at 06:00 UTC that day sends nothing until the next month. Running the check as "on or after the day, until a row exists" would repair that and the sent table makes it safe, but it
  would also remind a provider on the 20th for a value that became missing later, and it would mail a member who joined late; it is a behaviour for the maintainer to choose, not a silent change.
- **`listProviderIdsAsSystem` is a third additive read** beyond the two of the plan's §13 (nothing enumerated the providers), and `kpi.ingestion` now depends on `core.identity`, `core.settings`, `core.notifications` and `registry.organisations`. If the maintainer prefers one read that answers the reminder's whole question (`{ provider, service,
name }` triples), it replaces `listProviderIdsAsSystem` and the per-provider `listByOrganisationAsSystem` calls.
- **The reminder's policy check costs one query per person and service** (5.1 s for 200 services and 20 members) and cannot refuse anybody today, because for the seed role the policy and the membership list are the same rule. It is kept so that the mail follows the rule if the rule changes. One check per person and provider would
  make it 20 times cheaper; do that if a provider appears with many hundreds of services.
- **The mail goes to every approved member with an address, verified or not**, as the membership mails do (`core.identity` records `emailVerified` and the module does not ask for it). If a reminder should wait for a verified address, add the check in `recipientsOf`.
- **The reminder's mail names the first of several services by link and the others in the list**; a mail per service, or a button per service, is a template change if people ask for it.
- **`upsertBatch` costs about 0.13 ms a row and an unchanged batch costs nearly as much as an insert**, so the time is not in the writes. It was not profiled; the likely place is building a statement with 9 000 parameters per 1 000 rows. A 500-row call is 74 ms and a 5 000-row file 0.66 s, so nothing needs to change; `unnest` over arrays would be the
  next step if the 24 000-row ceiling (3.3 s) ever matters.
- **`implementation.md` carries the M10 additions** (closed from sprint 1's list). The release (`0.12.0`) is the maintainer's: see the pull request.

## Dashboard follow-ups (M11 sprint 1)

What the dashboard document and its routes left for later ([ADR-0042](adr/0042-dashboard-document-and-grid.md), [m11-sprint-plan.md](m11-sprint-plan.md)).

- **The `react` and `react-dom` peer warning** that `react-grid-layout` (a dependency of `@snapgridjs/core`) causes under `autoInstallPeers: false`: decide in sprint 2 between accepting it and `peerDependencyRules.ignoreMissing` in `pnpm-workspace.yaml` (recommended). No React is in the client build.
- **`MAX_CONFIG_BYTES` (400) against the 8 KiB document.** 20 tiles at the maximum do not fit (a 325-byte configuration × 20 is already over); 20 tiles of the plan's example sizes are 4.3 KiB. If "20 tiles, any configuration" must hold, lower the constant to about 300 before a widget stores a configuration of its own.
- **A stored dashboard that no longer passes the structural schema** (after a change of the schema) is read as "nothing stored" (`isDefault: true`, not `reset: true`): `getUserPreference` answers `undefined` for both. Tell them apart if a schema change ever needs it.
- **A configuration form for a widget needs a JSON Schema,** not only the Zod `configSchema` the server holds, which `GET /ui/navigation` does not (and cannot) list. Decide in sprint 4 whether the module ships the form description in the browser half or the registry gains a serialisable one.
- **dnd-kit's live-region announcements are English** ("Draggable item b was dropped."). The move and resize buttons of sprint 2 announce through the message catalogue; the keyboard drag that Snapgrid offers speaks dnd-kit's own words until its announcements are configured.
- **Saving needs `core.settings.preference.write` as well as `core.ui-shell.dashboard.write`** (the save stores through the preference service as the caller). If an operator should be able to take the preference permission away without stopping the dashboard, `setUserPreference` would need a variant that skips it; kept strict for now.
- **A keyboard resize** does not exist in Snapgrid 0.12.0; the buttons are the only way. Revisit if a later release adds one (the package documents arrow steps for a keyboard move only).
- **A "run" of the repair on write.** A read repairs and never writes; a person whose stored document has dropped tiles keeps them stored until the next save. A job or a "clean up" action that rewrites such documents is not planned.

## Dashboard follow-ups (M11 sprint 2)

What the grid, edit mode and the FAB menu left for later ([ADR-0042](adr/0042-dashboard-document-and-grid.md), "Amended in sprint 2"; [m11-sprint-plan.md](m11-sprint-plan.md)).

Closed from sprint 1's list: the `react` and `react-dom` peer warning (`peerDependencyRules.ignoreMissing`, no React in the client build); `MAX_CONFIG_BYTES` (stays 400); dnd-kit's English announcements (the accessibility plugin is configured with the page's words; en and de are tested).

### Measured in sprint 2

| What                                                                                             | Before (`dev`, `0.12.0`)          | After                               | Change                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Client build, JavaScript and CSS (75 → 78 files)                                                 | 5,911,288 B raw, 1,715,206 B gzip | 6,085,479 B raw, 1,772,223 B gzip   | +174,191 B raw (+2.9 %), +57,017 B gzip (+3.3 %)                                                                               |
| The grid chunk (loaded on `/` only; asserted in the harness and in e2e)                          | none                              | 145,587 B raw, 47,907 B gzip        | the prototype's grid chunk was 133.7 kB and 43.9 kB; the extra is `DashboardGrid` itself, the tile chrome and the layout rules |
| The rest of the client build (the page, its words in two languages, fourteen icons, shared code) |                                   |                                     | +28,604 B raw, +9,110 B gzip                                                                                                   |
| Image `full`, uncompressed (`docker image inspect`)                                              | 634,197,977 B                     | 652,752,394 B                       | +18,554,417 B (+2.9 %)                                                                                                         |
| Image `core-only` and `registry`, uncompressed                                                   |                                   | 637 MB and 640 MB (`docker images`) | the module-set check passes for `full`, `core-only` and `registry`                                                             |

The image grew by more than the build: its package store grew by 14.3 MB, of which **`svelte` and its compiler's dependencies are about 9.5 MB**, which `@snapgridjs/svelte` and `@dnd-kit/svelte` list as a peer.

`[dashboard-calls]` (what the browser sends, from `e2e/dashboard.spec.ts`, both base paths; the document and the widget list come with the page):

| Moment                                                                                                  | Requests                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arrival on `/` as an administrator (full page load)                                                     | `GET /inbox/stream` (the shell's bell), `GET /memberships/summary`, `GET /notifications/status`, `GET /users/pending?pageSize=1` (the three cards' own reads). No request for the dashboard, no `PUT` |
| Edit mode turned on (the grid is rebuilt)                                                               | none                                                                                                                                                                                                  |
| A tile dragged, then a tile resized (pointer)                                                           | none while moving; one `PUT /ui/dashboard` about a second after the last change                                                                                                                       |
| A widget added from the menu, then two widenings, a move and a heightening with the buttons (one burst) | the widget's own read (`GET /notifications/status`), then one `PUT /ui/dashboard`                                                                                                                     |
| A save that is refused (403)                                                                            | one `PUT`; nothing again until the person presses "Try again" or changes something                                                                                                                    |

### Entries

- **The image carries the client-only packages of `ui-kit`** (it already had `echarts`; now Snapgrid, dnd-kit, the layout functions of react-grid-layout and `svelte` with its compiler, +14.3 MB of packages, +18.6 MB of image). The web app is bundled by the node adapter, so none of it is needed at run time. Step 5 of `docker/Dockerfile` could install the server's closure without them (`--filter` on what the front imports at run time only). A change of the Dockerfile, so not done here.
- **"Reset to default" stores nothing** (plan §3), so a person who resets and leaves without another change finds their old layout again. Saving at once is a one-line change (`reset()` in `Dashboard.svelte` would call `changeItems`); the plan's wording was followed and the question is the maintainer's.
- **Two tabs: the last save wins and an edit made in another tab is not detected** (as planned). A revision number on the document and a "this dashboard changed elsewhere" message are the way out if it matters.
- **A `Widget` that fails to load** shows "N widgets could not be shown on this page" and draws nothing; it does not offer a retry. A retry (and a log line of which component) is small if it is ever seen.
- **A keyboard drag on the grip** is dnd-kit's: Space picks up, arrows move one cell, Space drops, Escape cancels. A tile in a column that is full cannot be moved sideways by it either (the buttons say so; the drag just does not move). A keyboard resize still does not exist in Snapgrid 0.12.0; the buttons are the only way.
- **The settings gear and dialog of a tile are built and tested in the harness but no widget uses them yet** (sprint 4: a JSON Schema or a form description per widget, see sprint 1's entry on `configSchema`).
- **`Icon` exists twice** (`apps/web/src/lib/components/Icon.svelte` and `packages/ui-kit/src/Icon.svelte`, both over the same closed table). The web app's could re-export the shared one.
- **A screen-reader pass of the announcements is a manual step** (plan §6, item 10); the texts and the live regions are tested, what NVDA, JAWS and VoiceOver make of them is not.
- **Fourteen icons joined the closed table** (`plus`, `check`, `edit`, `refresh`, `trash`, `move`, the four arrows, `wider`, `narrower`, `taller`, `shorter`; the table is `@scorpion/contracts/icons`).

## Observed by the maintainer (after M9 sprint 4)

- **A `pg` deprecation warning from a node process.** `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.` Seen once by chance in a local run (pid 58754; which process and command is not known). It means some code issues a second query on one `pg` client before the first has finished (a `Promise.all` over a single client or transaction, a query in an event handler, or a missing `await`). Nothing fails today, but `pg@9` will stop queueing them. To find it: run with `node --trace-deprecation` (`NODE_OPTIONS=--trace-deprecation pnpm test`, or the same for `pnpm dev`) and fix the call site; then make the test setup fail on a deprecation warning (`--throw-deprecation` in the vitest and e2e processes) so it cannot return. Candidates to look at first: code that runs several reads through one `ctx.db.tx()` transaction in parallel (a drizzle transaction is one client), and the test helpers that share one client.

## Later

- Move to TypeScript 7 once typescript-eslint and svelte-check support it.

## Identity follow-ups

- Approval policies `auto-by-email-domain` and `invite-only` (architecture lists them; M2 ships `manual` only).
  Invite-only needs an invitation table and email delivery (M4) and admin permissions (M3).
- Test harness for a module: every module test file builds a kernel over Postgres by hand (`modules/core-identity/test/harness.ts`). Move it to a shared helper once a second module needs it; `packages/testing` cannot import the kernel without a package cycle, so it probably belongs with the kernel's test exports.
- Rate limits: the numbers are the `rateLimits` setting of `core.settings` since M3 sprint 3. Still open: a per-credential bucket for session cookies (they count against the address) and finer keys (for example per username on login). M8 sprint 1 gave the token calls their own, larger address bucket (`TOKEN_ADDRESS_FACTOR`, ADR-0037); the browsers' bucket is unchanged.
- Sprint 2 follow-ups: (1) Done in M3 sprint 2: `approve` and `reject` check the permission and "not your own account" with `ctx.authz.require` in the service. (2) An `Origin` check as a third CSRF layer (ADR-0007) needs the public origin to be reliable behind every proxy; revisit with the settings in M3. (3) `POST /auth/register` answers 409 for a taken username or address, which tells a caller that it exists. Decided in sprint 5 to keep it for M2; see "Sprint 5 follow-ups". (4) Done in sprint 5: the purge of soft-deleted accounts after 30 days frees the username and the address (ADR-0013).
- Sprint 4 follow-ups (OIDC): (1) A public `GET /auth/oidc/providers` (id and display name) for the login page, with the UI in M5. (2) Done in sprint 5: the hourly cleanup job removes expired `identity_login_state` rows. (3) `email_verified` sent as the string `"true"` by some providers is treated as not verified; add a per-provider option if a real provider needs it. (4) Provider icons (FEATURES asks for a display icon): the blob store exists since M3 sprint 4; add an icon hash to the provider setting with the login page (M5). (5) The code exchange cannot be aborted (arctic has no signal); revisit if arctic gains one. (6) Several identities of one provider per user are refused (409); lift that only with a product reason.
- Sprint 5 follow-ups (recovery, profile, cleanup):
  - **Settings and secrets wiring (M3).** Done in sprint 3: `IdentitySettings` reads `ctx.settings`, the retention numbers, the mail budgets and the pipeline's rate limits are settings, and `OIDC_<ID>_CLIENT_SECRET` is replaced by the secrets store. Done in sprint 4: `instanceName` and `mailFrom` are branding settings of core.settings (ADR-0018). Done in M4 sprint 2: `SMTP_URL` is gone; the relay is a core.notifications setting and its password a secret.
  - **Real mailer through core.notifications (M4).** Done in M4 sprint 2: the `Mailer` port is deleted, every mail is a template of core.notifications queued in the transaction of the work, with retries and a visible status. Still open: the delivery status in an admin list (sprint 3).
  - **Register without revealing.** Done in M4 sprint 2: `POST /auth/register` answers 202 for every well-formed request and the owner of a taken address gets a notice mail; the username stays a 409. Still open: the "check your mail" page (M5).
  - **Bio as Markdown.** FEATURES asks for a bio, not for Markdown, so it is plain text (max 2000). If wanted: render on the server and sanitise with DOMPurify. Also consider stripping Unicode format characters (bidi overrides) from display names; only control characters are refused today.
  - **Guessing one username from many addresses.** No lockout and no per-username counter (README, "Account locking"): both are a denial of service against a known username. Options that avoid it: alerting on failed logins per username, a proof-of-work or CAPTCHA step-up after repeated failures, 2FA.
  - **Revoke access tokens on a reset (optional).** A reset or a change ends sessions only (ADR-0012). A "revoke my tokens too" switch on the reset page, or a security-event setting, would cover the case of a token minted from a hijacked session.
  - **Reset marks the address confirmed?** Opening a reset link proves control of the mailbox, but the reset does not mark the address verified (kept separate on purpose). Revisit if the UI wants a one-step recovery for unverified accounts.
  - **Self-service account deletion and data export (GDPR).** FEATURES lists account deletion as missing; the purge job already deletes soft-deleted accounts, so deletion needs the route, the confirmation (password or mail link) and the event.
  - **Admin user management (M3/M5).** Done in M5 sprint 3: list, one account, roles, tokens, ending sessions (the screens for the M4b routes) and deactivate. Still open: change an email address and force a reset for another person, and reactivate (see "Administration screen follow-ups").
  - **2FA (TOTP, WebAuthn).** Not in M2.
  - **Public `GET /auth/oidc/providers`** for the login page (id and display name), with the UI in M5 (sprint 4 follow-up 1, still open).
  - ~~**Outbox retention** now also matters for the purge: events keep the usernames of purged accounts.~~ Done in M4 sprint 4: delivered events are deleted after `outboxRetentionDays`; a test proves the username of a purged account leaves the outbox. A `dead` delivery keeps its event (and the name) until somebody requeues it, see "Audit follow-ups".

## Authz follow-ups (M3 sprint 1)

- **Create and delete roles.** M3 sprint 1 seeds Admin, Reviewer and User and lets `core.authz.role.manage` edit the permissions of the non-Admin roles. Creating and deleting custom roles (with the rule that a role in use cannot be deleted) is not built; the schema allows it (`system = false`).
- **Scoped permissions at the route.** The authoriser checks a scoped permission (for example `service.edit` with scope `service`) globally, so a provider member who lacks it globally is denied at the route even though a resource policy would allow them. M7 needs a route-level pass-through for scoped permissions, with the service re-check as the guard; decide it with the first resource policy.
- **"Last Admin" counts assignments, not accounts.** `core.authz` cannot see whether an Admin's account is deactivated. If M5's user management needs "the last _active_ Admin", the check moves to a call from identity that passes the active holders.
- **Grant escalation.** `core.authz.role.assign` lets the holder give any role, Admin included. Treat it as an admin permission; revisit if a delegated "assign only roles up to X" is wanted.
- **Cache invalidation after the outer commit.** The permission cache is emptied when a role change commits its own transaction. When a caller wraps the call in a larger transaction, a request that races with the outer commit can refill a stale entry for up to the 5 s TTL (the documented bound).

## Identity on authz follow-ups (M3 sprint 2)

- **List a user's roles.** `GET /users/{id}/roles` (identity, `core.identity.role.read`, `AuthzService.rolesOf`) for the admin UI; `GET /roles` lists the roles only. Add it with M5's user management.
- **Tokens of another user.** `core.identity.token.manage-any` revokes a token by id; there is no route to list another user's tokens, so an administrator needs the id. Add a list with the admin user management (M5).
- **Delegated approval.** Approving needs `core.authz.role.assign` as well as `core.identity.user.approve`, so a role that may only approve cannot approve. A "may assign only roles up to X" rule (see "Grant escalation") would let a reviewer approve accounts for the role `user`.
- **Old token scopes.** Tokens made in 0.3.0 keep their `read:kpi`-shaped scopes, which grant nothing. A cleanup that lists them for their owners, or a one-time migration that revokes them, is not built.
- **Wildcard scopes.** A scope names one permission. `core.identity.*` or a "read-only" preset would help scripts with many scopes; decide with the first real script.
- **Actor of kind `system`.** Trusted code with no human caller uses three methods of the authz service (ADR-0015). If jobs need to call methods that check permissions (`assignRole`), they need an actor for that; add it with the first such job and keep it out of the authenticator.
- ~~**Role events are not audited yet.**~~ Done in M4 sprint 4: `core.audit` records `authz.role.assigned@1`, `.removed@1` and the new `authz.role.permissions.changed@1`, which `setRolePermissions` emits when the set changes. Done in M5 sprint 3: `PUT /roles/{key}/permissions` calls `setRolePermissions`, with the roles page.

## Settings follow-ups (M3 sprint 3)

- **Admin form and history.** `GET /settings/{module}/schema` and the effective values are ready for the settings form (M5). The form needs per-field labels and grouping (Zod `.describe()` and `.meta()` flow into the JSON Schema); decide the convention with the first form. The history of changes is the audit trail (M4 sprint 4: `settings.changed@1` with the actor and the names of the keys that changed, never the values; `GET /audit?action=settings.changed@1`); the table keeps only the current version, so the trail cannot show the old value.
- **Partial updates.** `PUT` replaces the whole stored object, so the form sends every field. A `PATCH` that merges keys (and removes one with `null` to return to the default) would help scripts that change one setting; add it with the first such script.
- **Declared secrets.** The API lists stored secrets only, so the admin UI cannot show "OIDC secret for provider X: not set". A registry where modules declare the secret names they use (with a description, and a pattern for per-provider names) would let the UI list the unset ones. Secret names are not namespaced by module today: an Admin can set any name, and nothing checks that a module uses it.
- **Faster propagation.** A changed setting reaches another process within 5 seconds (cache TTL). If that is too slow for some setting, a `LISTEN/NOTIFY` message on write that empties the cache of the other processes would make it near-immediate; the kernel already has the listener machinery for the outbox.
- **Secret hygiene checks.** A guard that refuses a `settings` schema with a key that looks like a secret (`password`, `secret`, `token`) at start-up, and a `verify-secrets` command that decrypts every row with the current keys and reports names that fail (useful before and after a rotation), are not built.
- **Key escrow and backup.** The key lives in the environment only. A documented way to back it up with the deployment secrets of the operator's choice (and a `backup`/`restore` command that knows the key is not in the dump) belongs to the backup module.
- **Preference definitions for the UI.** Done for `notifications.preferences` in M4 sprint 3 (its category list). `GET /preferences` lists stored values only. The interface will want the registered keys with their descriptions, schemas and defaults (`GET /preferences/definitions`); add it with the first preference (M5). Preferences have no default in the registry entry yet.
- **The pipeline reads a module's setting.** The server's rate limit depends on the module id `core.settings` and the shape of its `rateLimits` setting (ADR-0017). A second pipeline setting would justify a kernel-level declaration of server settings.
- **`getSecret` is not cached.** It decrypts on every call; the only caller is the OIDC code exchange. Cache it (short TTL, emptied on write) if a hot path needs a secret.
- **Settings read before core.settings is built.** `ctx.settings.get()` called while services are being built, from a module that does not depend on `core.settings`, throws "not ready". Make the port fall back to the defaults in that window if a module needs it.

## Vocabularies, blob store and branding follow-ups (M3 sprint 4)

- **Usage checks for the built-in vocabularies.** `sender-type` still has no `usage` check (`core.notifications` is the module that stores it). ~~`thematic-category`, `necessity` and `aggregate`~~ Done in M9 sprint 1: `kpi.framework` contributes their `usage` entries (a term an indicator, a set row or an evaluation has is deactivated, not deleted) and `service/terms.ts` calls `validateTerm` for every term a save names; the services of sprint 2 call it. ~~`stage`~~ Done in M7 sprint 1: `registry.services` contributes the `usage` of `stage` (a term a service has is deactivated, not deleted) and `create` validates the stage through `validateTerm`.
- **Vocabulary administration.** No import or export of terms, no list of locales to offer in the UI, no way to reorder many terms in one call, and no history beyond `settings.vocabulary.changed@1` (recorded by the audit trail since M4 sprint 4, without the labels). Administrators cannot declare a vocabulary; that stays with modules.
- **A full Markdown parser.** Legal texts use a small in-house subset (`packages/sanitize`) because the sprint allowed no dependency beyond `sharp` and DOMPurify. Tables, nested lists, images and reference links need a CommonMark parser (for example `marked` or `markdown-it`) in front of the same DOMPurify step; it needs approval as a new runtime dependency. The bio (plain text today) could use it too.
- **Legal texts per locale, and versions.** One text per page; no translations, no "accepted on" record, no history.
- **Branding extras.** Favicon, login background and theme colours (FEATURES 3.19: they swap with the theme) are not settings yet; add them with the UI shell (M5). Saving a logo is two steps (upload with `POST /files`, paste the hash into the settings); M5's form can do both. The sender address check is length only, not an address syntax check, because `Name <a@b>` is allowed.
- **Blob store limits.** No per-user quota or upload rate beyond the strict rate limit, no virus scan, no animated GIF or WebP (a GIF keeps its first frame as a PNG), no AVIF or HEIC, no image variants (thumbnails) and no listing or deletion of stored files in the admin UI. A leaked file is removed at once with a database statement; otherwise after the grace period.
- **S3 backend.** The architecture mentions it; the table is the only backend (plan §9). The service interface (`put`, `describe`, `setReference`) is what an S3 backend would sit behind; large files would move out of `bytea` first.
- **`GET /files/{hash}` below `/api/internal`.** The route registry has no root surface, so the public file URL is `/api/internal/files/{hash}`. If a shorter public path is wanted (for emails), add a root surface to the registry with an ADR.
- **Content hash in the URL is the only access control** of a stored file, which is right for avatars and logos and wrong for private attachments. A module that stores private files needs a permission-checked route and a flag on the file; decide it with the first such module.
- **Cross-process branding reads.** `getBranding()` is cached for 5 seconds like every setting; mail sent in the window after a change can still use the old name.

## Repository hardening follow-ups (M4a sprint 1)

- **The `57P01` teardown error (#48, #50).** Resolved 2026-10-06. The CI error's object carried `err.client` with `release` and `_poolUseCount`, which only pg-pool's idle listener sets: the pool re-emitted a pooled client's error as its own `error` event, and nothing listened. Two pg-pool behaviours met: `pool.end()` resolves once it has let go of its clients, before they have closed, and a client closing in that gap still has the idle listener. The harness stopped the container in the gap. Now `createPool` listens for `error` (the kernel logs a warning with the SQLSTATE), and `closePool` waits until every connection has closed; the kernel's `stop()` and `openDatabase().close()` use it. `db.test.ts` reproduces the uncaught error without the listener and the early return without the wait. The same fix keeps a running server alive when Postgres ends an idle connection. The earlier `jobs.stop()` fix stays. Not looked at further: the listener clients of the outbox and `wake.ts` (suspect 2), and harnesses without `afterEach` cleanup (suspect 3); neither matches the CI error.
- **Base images outside the Dockerfile.** `postgres:16.15-alpine` (CI service, `docker-compose.dev.yml`) and `axllent/mailpit` are pinned by tag only, and Dependabot's `docker` ecosystem reads Dockerfiles, not these files. Scorecard does not count them. Pin by digest and add a `docker-compose` entry to `.github/dependabot.yml` if the score asks for it.
- **Dependabot runtime bumps without a changeset.** A Dependabot pull request that changes only dependency files needs no changeset (`scripts/changeset-check.ts`), so a security bump of a production dependency does not reach `CHANGELOG.md` by itself. Write a changeset by hand at release time for those, or revisit the exemption.
- **`cli.test.ts` picks a random port.** `freePort()` in `apps/server/src/cli.test.ts` returns a random number from 20000 to 40000 without checking it. It collided once with a port in use (`EADDRINUSE`, `exits 1 and says why when the database cannot be reached`) in a full local run and passed on the re-run. Bind port 0 and read the port back, or retry.

## Security assurance follow-ups (M4a sprint 2)

What the ASVS assessment and the tool left for later. The open requirements themselves are `fail` entries in `docs/security/asvs/v*.yaml` with an issue each; this list is what no entry covers.

- **Other ASVS chapters, Best Practices silver and gold.** Only V6, V7, V8 and V10 are claimed. Further chapters, and silver and gold (they need a second maintainer and two-person review), go here until there is one. Scorecard targets above 6.5 likewise.
- **Signed images, SLSA provenance and an SBOM** for the Signed-Releases check: M18 and Gate 4 (cosign on the profile images, provenance attached to the GitHub release).
- **Fuzzing** (`fast-check`) for the pure calculation library and the parsers: M10 and M11. Check the current Scorecard detection rules first.
- **Dependency review action** on pull requests and licence checks of dependencies.
- **Peer or external review** of the assessments: a second maintainer or an outside reviewer sets `assessment_type` to `peer` or `external` and fills `reviewer`.
- **Tests that would turn code pointers into tagged tests.** V6.2.8 (a password is verified exactly as received: surrounding spaces, case) and V6.3.2 (a fresh install has no user) pass on a code pointer only. The test OIDC providers (`apps/server/src/testing/oidc-flow.ts`, `modules/core-identity/test/oidc.ts`) do not check `code_verifier` against the S256 challenge, so V10.2.1 rests on the challenge being sent and the state being checked; make the stub verify it and add a test that a wrong verifier is refused. Nothing asserts that a configured `offline_access` scope leaves no refresh token stored.
- **RFC 9207 `iss` authorization-response parameter.** Not validated; mix-up protection (V10.2.2) rests on the per-provider callback, the state tied to the provider and the id_token `iss`. Validating `iss` when the provider sends it would be extra hardening.
- **Dedicated tests for table-driven evidence.** V10.5.3 and V10.5.4 (issuer and audience) and V6.2.1, V6.2.5 and V6.2.9 (password rules) are tagged on `it.each` titles, so the tag covers every case of the table. A test per requirement would make the evidence sharper.
- **`pnpm test --filter` overwrites `reports/vitest-junit.xml`.** The report holds only the projects that ran, so `pnpm security:asvs` after a filtered run can report a tag as having no passed test. Run the full `pnpm test` first.
- **`ASVS impact` as a required check.** It becomes one after it is on `main` (CONTRIBUTING.md, "Releases"): add it to the ruleset once the release that carries it is out.

## Authorization follow-ups (M4b sprint 3)

What the response-side audit and the walker (`apps/server/src/response-fields.test.ts`) left. The audit found no secret in any response schema, and nothing had to be fixed.

- **The walker reads declared schemas, not payloads.** No pipeline step validates a response against its schema, so a service that returned an extra field would not be seen. Services build named fields and the route tests for tokens, secrets, settings and the audit trail read real responses, but nothing checks every route. The contract tests of M8 (`pnpm test:contract`, every public route against its OpenAPI schema) should also fail on a forbidden name in a real response body.
- **Free-form values cannot be walked.** `values` of a setting and `value` of a preference are `z.unknown()` records, so a secret-named key inside them is not seen by the walker. The guard in "Secret hygiene checks" above (a settings schema with a secret-looking key is refused at start-up) would close that; do it with that item.
- **The route matrix is regenerated by hand.** `authorization-doc.test.ts` fails when `docs/security/authorization.md` differs from the live registry, but regenerating needs Docker and an environment variable (the header of the test says how). A `pnpm` command that boots the kernel without a database would make that quicker.
- **Rows for the registry modules.** Done for organisations (M6) and services (M7); the KPIs' field tables are still to come with M9 to M11. `docs/security/authorization.md` gets them when those modules add them; the generated route table needs no change, and the walker covers their responses from the first route.
- **The assessment's accepted weaknesses, in one place.** Each is written in the note of its ASVS entry; this list keeps them from being forgotten. None has a milestone.
  - **No second factor of our own (6.3.3).** See "Credentials follow-ups": TOTP, WebAuthn and recovery codes.
  - **The breach check fails open and can be switched off** (6.2.4, 6.2.12): a breached password is accepted when the service does not answer or `passwordBreachCheck` is `off`. The offline floor above narrows it.
  - **Access tokens survive a reset** (6.4.3): see the optional switch under "Revoke access tokens on a reset".
  - **The recent-authentication window is 5 minutes for every action** (7.5.1): a reviewer may find it weaker than a prompt on every change; see "a stricter window per action" under the session follow-ups.
  - **Federated sessions (7.6.1):** no maximum time between provider logins for an ordinary session and no back-channel logout; see the session follow-ups.
  - **Evidence that is a document or a code pointer, not a test** (6.1.3, 6.3.4, 8.1.2; 6.2.8 and 6.3.2 above). The second pass should read the route tables and the field tables against the code.
  - **The 10.2.1 test shows the PKCE challenge, not that the verifier reaches the token endpoint.** The test provider does not check it; make it check, and assert it.
  - **Scorecard checks below 10** (Maintained, Code-Review, Fuzzing, Branch-Protection, CII-Best-Practices, Vulnerabilities): see the table in `docs/security/README.md`. Code-Review and Branch-Protection need a second maintainer.

## Sessions follow-ups (M4b sprint 1)

What the session work left for later ([ADR-0025](adr/0025-absolute-session-lifetime-and-recent-authentication.md), [docs/security/sessions.md](security/sessions.md)).

- **Lifetimes in hours.** `sessions.inactivityDays` and `absoluteDays` are whole days, at least 1. A high-risk deployment that wants 12 hours or 1 hour of inactivity needs `inactivityMinutes` and `absoluteMinutes` (or ISO durations) and a validation range.
- **Back-channel and RP-initiated logout.** Ending a session at the provider does not end the Scorpion session, and the reverse (sessions.md, 7.1.3). Needs a public back-channel endpoint, a table from the provider's `sid` to our sessions, a signature check of the logout token, and a provider setting for the end-session endpoint.
- **A session list with device names.** Times and the current marker only today (Decision 6). A label or a coarse location needs a privacy text (M5), a retention rule, and a way to keep it out of logs.
- **A limit on concurrent sessions,** if misuse shows up (Decision 6): a setting, the oldest session ended at the limit, and a message in the UI.
- **Cross-process session invalidation.** Another process accepts an ended session for at most 5 seconds. A `LISTEN/NOTIFY` message from `revoke*` that empties the other caches would make it immediate.
- **Re-authentication on admin termination, and a stricter window per action.** `sessions.recentAuthSeconds` is one window for every action; the administrators' routes do not ask for a recent authentication. A per-action `maxAgeSeconds` is already an argument of `requireRecentAuth`.
- **AAL2 behaviour.** A deployment whose provider enforces MFA may want its local session to follow the provider's `acr` and the NIST periods for AAL2; `acr` and `amr` are not read (sessions.md).
- **A notice mail when sessions are ended by an administrator, and when a new session starts** from an unfamiliar browser. The audit trail has the first; neither mails.
- ~~**A disable-account feature** must call `revokeAll` in the same transaction and get a test (ASVS 7.4.2).~~ Done in M5 sprint 3: `POST /users/{id}/deactivate`, tested for the ended sessions and for the rollback.
- **The re-authentication screen** (M5): the page that shows `reauthentication-required`, asks for the password or sends the person to the provider, and returns to the change. The OIDC callback redirects to the application root today, with no return path.

## Credentials follow-ups (M4b sprint 2)

What the credential work left for later ([ADR-0026](adr/0026-credential-rules-throttling-and-mail-confirmed-linking.md), [docs/security/authentication.md](security/authentication.md)).

- **TOTP, WebAuthn and recovery codes** (6.3.3 passes on a documented rationale today). Needs a dependency, a secret per person in the encrypted store, recovery codes (6.5.x applies), screens, and a rule for what an OIDC-only account does. An operator who needs a second factor requires it at the OIDC provider.
- **A notice mail on repeated failed logins** (6.3.5 and 6.3.7 are Level 3), and on a new link or a changed password. The throttle blocks; it does not tell the owner.
- **An offline floor of the 3000 most common passwords** (a file in the repository with its licence and SHA-256 recorded), checked when the breach service does not answer, so the fail-open window is not empty (6.2.4). Together with a self-hosted mirror of the range API for an installation that may not call the public one.
- **Alternatives to a hard lockout.** The throttle has no lockout on purpose. If a deployment sees distributed guessing that the ceiling does not stop: a CAPTCHA or proof-of-work after the free attempts (a dependency and a third party), a longer ceiling per account, or a requirement of a second factor for a blocked account. An administrator action to clear the counters of one account is also missing.
- **An admin view of the throttle:** which accounts are blocked and for how long, and settings screens for `loginThrottle` and `passwordBreachCheck` (the schema validates them; no screen exists until M5 and later).
- **Check the password at login.** The password is in hand at a successful login: checking it against the breach set then (and asking for a change) would catch a password that was breached after it was set. Today the rules apply when a password is set.
- **The page that confirms a provider link (M5)** should name the provider before the person confirms, which needs a read route for the token (`POST /account/oidc-link/confirm` names it only in its answer). The callback redirects to `/login?notice=check-mail` and the mail links to `/link-sign-in#token=…`; both pages are M5's.
- **A notice to the account holder when a provider is linked,** and a list of the linked providers with a way to unlink one, are not there.
- **The breach counter is per process,** not per server: `scorpion_password_breach_check_failures_total` reads a counter in `packages/integrations`. A kernel metrics API for modules would let each server own its counters.
- **Verification link of 10 minutes** if the maintainer rejects the reading of ADR-0026 section 3: change `VERIFICATION_TTL_MS`, the mail text and the README.
