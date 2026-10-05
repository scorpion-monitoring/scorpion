# ADR-0022: Templates, locales and registering without revealing

- Status: Accepted
- Date: 2026-10-05

## Context

M4 sprint 2 moves every mail of `core.identity` onto `core.notifications` (ADR-0019, ADR-0020). That needs answers the plan left open or
only sketched: what a template is and who owns it, how a language is chosen, how identity enqueues, how "all administrators" is reached,
what `POST /auth/register` answers when the address is taken, and what the dev setup does. ADR-0012 (mail tokens) stays in force; the
parts that describe the `Mailer` port and "mail after the commit" are replaced by this ADR (a note in ADR-0012 points here). The number
0021 is kept free for the audit sink of sprint 4.

## Decision

### Templates

- **A template is a registry entry**, `notify.template`: `{ key, schema, sensitive, category, mandatory, catalogue: { en, de }, render }`, built with
  `defineTemplate` from `core.notifications/public`. The module that owns the event contributes it. `render(data, locale, branding)` returns
  `{ subject, text, html }`; `defineTemplate` builds it from a `content(data, { t, branding })` function that returns blocks
  (`text`, `list`, `action`, `note`), and the shared layout turns the same blocks into the plain-text and the HTML part. No template engine and no
  new dependency (M4 decision 3).
- **Start-up checks.** The registry's Zod schema refuses an entry without an `en` and a `de` catalogue (or with an empty one), a bad key or a
  render that is not a function; two modules contributing one key fail the start. Keys that exist in one catalogue and not in the other are
  not a start error (English is the run-time fallback) but fail the template's test (`templateProblems` in `@scorpion/testing`, used by
  every module that contributes templates).
- **Escaping by construction.** A template never escapes anything. Every value put in with `t('key', { name })` is cut to one line and stripped of
  line breaks, controls and bidirectional marks; the layout escapes the HTML and shows a link only if it is `https:`, `http:` or `mailto:`; the
  subject is cleaned to one line whatever a name holds, so a hostile name cannot add a mail header (checked through a real relay).
- **Ownership of templates of modules that do not exist yet.** `registry.membership-requested`, `registry.membership-decided`,
  `onboarding.application-submitted`, `onboarding.application-decided` and `kpi.reporting-reminder` ship inside `core.notifications`, registered and
  tested, so M6, M10 and M15 only enqueue. Each moves to its module when it lands (same key). The plan names "the onboarding and KPI reminder
  mails"; the three keys are this ADR's choice, from FEATURES §3.15 ("submitted or decided", "a KPI reporting deadline passes").
- **`sensitive` and `mandatory` belong to the template.** A caller cannot pass `sensitive`: the reset and verification templates always are.

### Enqueueing by template

- **`enqueueTemplate(tx, { template, data, recipient: { address, userId? }, locale? })`** next to `enqueue`, with the same rule: inside `ctx.db.tx()`,
  no permission check (ADR-0019). It validates the data with the template's schema (`Invalid`, field names only), renders, runs the result through the
  same message validation as `enqueue` (size limits, one-line subject) and inserts one row. The raw `enqueue` stays for a message that is already
  rendered. **Identity uses `enqueueTemplate` for every mail.** An unknown key is a `NotificationError` (a bug of the caller), not a 422.
- **The data is not stored.** Only the rendered mail is, so a sensitive body is the only place a token lives, and the scrub of ADR-0019 deletes it.
- **Identity queues the mail before it emits the event** in each flow, so a failing outbox rolls the mail back (a test per flow proves a rollback sends nothing).

### Locale

- **Shipped languages:** `en`, `de` (`SUPPORTED_LOCALES`). A tag is matched on its primary subtag (`de-AT` gives `de`); anything else falls through.
- **Order:** the language the caller names, then the instance's `defaultLocale`, then English. A bad value never fails a mail.
- **Who names it.** For a signed-in person or an administrator: the preference `notifications.locale`, registered by `core.notifications` in
  `settings.userPreference` and read by identity through a new trusted method `getUserPreference(userId, key)` of `core.settings`. For a mail sent
  before the caller is known (register, reset request, register notice) it is the optional `locale` of the request body (a well-formed tag, 422
  otherwise). **The reset and the register notice do not read the owner's preference**, so the known and the unknown path do the same lookups;
  the plan's wording for Decision 5 lists them among the mails without an account.

### Trusted methods added to existing modules (ADR-0015 rule)

- `core.authz.listHoldersAsSystem(tx, roleKey, { limit? })`: the ids of the holders of a role, at most 1000, in the caller's transaction, no permission
  check. Identity uses it for "all administrators", then loads the active ones with an address. A test proves that `core.authz` has no route and that no
  `routes*.ts` file of any module names it or the other system methods.
- `core.settings.getUserPreference(userId, key)` as above, and `core.settings.seedSettings(moduleId, values)`: stores settings only when none are
  stored, never overwrites (used by the development seed). Neither is reachable from a route.

### Register without revealing (M4 decision 4)

- **`POST /auth/register` answers 202 `{ accepted: true }`** for every well-formed request. The route used to answer 201 with the new account; it no
  longer returns anything of it. A client that needs the id signs in after approval. No UI exists, so nothing else changes.
- **Order of checks:** `localAccounts` (403), input (422), the mail budget of the address is spent, a taken **username** (409, usernames are public),
  then a taken **address**. A taken address creates nothing, emits nothing and queues `identity.register-attempt` to the holder (`mandatory`, no token;
  links to the sign-in and forgot-password pages). The holder of a rejected (soft-deleted) account is not mailed.
- **Equal work, as far as practical (ADR-0012's timing rule).** Both paths spend the budget and hash the password; the taken path then inserts one row,
  the new path a few more. A race that the unique index decides is routed to the taken path. The budget being spent suppresses the mail to the address
  on both paths and changes no answer.
- **Mails of a new account** (same transaction): `identity.welcome` and `identity.email-verification` to the person; when the account waits for review,
  `identity.registration-request` to every active administrator with an address. A policy that activates at once sends no administrator mail.
- **The verification mail no longer swallows its failure.** `startVerification` used to log and go on, because the mail was sent after the commit. The
  mail is now a row in the caller's transaction, so a failure to store it fails the registration or the address change and nothing is left behind.

### Quiet logs and the development seed

- With `emailTransport = none` the module logs **one** warning at start-up and counts dropped mail (`status().sentWithoutTransport`, and `dropped` in
  the delivery job's log line); the transport `none` never logs per message.
- **`scorpion seed-dev-mail`** (a command of `core.notifications`) stores `smtp`/`localhost:1025` only when no settings are stored, and refuses with
  `NODE_ENV=production`, which every image sets. `pnpm dev` runs it; no image runs it.
- `SMTP_URL` is not read and not mentioned in code. The plan's risk table asked for a start-up message when it is set; its definition of done (the
  name appears only in documentation) wins, and the changeset and READMEs tell operators.

## Consequences

- A leftover `SMTP_URL` is ignored silently; operators learn from the changeset and the README.
- Identity depends on notifications at build time: `defineProfile()` and `pnpm modules:sync` require `core.notifications` before `core.identity`
  (already so in `full` and `kpi-tracker`).
- The route table of `core.identity` changes in one answer (register: 201 to 202, and 409 for an address is gone). The defect-13 and registration
  tests were updated to the new answer and extended (taken and new addresses are indistinguishable while on and while off); none was weakened.
- A new language is a new catalogue key set in every template, a new entry in `SUPPORTED_LOCALES`, and the preference schema follows it.
