# core.notifications

Delivery of messages: a message is stored in the transaction of the work that causes it, sent outside any
transaction, retried when the relay is down and visible to an operator. Email goes through SMTP (Nodemailer); a signed
webhook mirrors admin-addressed messages. It is user-agnostic like `core.authz` ([ADR-0019](../../docs/adr/0019-module-graph-and-notifications-port.md)):
it stores an opaque `recipient_user_id` with no foreign key and takes the address from the caller. The queue is a table
([ADR-0020](../../docs/adr/0020-delivery-queue-in-a-table.md)).

Status: M4 sprint 3. Every mail of `core.identity` goes through this module, and the variable `SMTP_URL` is gone: the relay is
configured in the settings below and its password is a secret. Templates and the two shipped languages (`en`, `de`) are here
([Templates](#templates)). Sprint 3 adds the in-app inbox, per-category preferences and the administrator's routes for status,
deliveries, requeue and a test mail ([ADR-0023](../../docs/adr/0023-inbox-preferences-and-delivery-administration.md)); the screens are M5.

## Manifest

| Part           | Value                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | `core.notifications`                                                                                                                                                                                                              |
| table prefix   | `notify_` (set in the manifest; ADR-0004)                                                                                                                                                                                         |
| dependencies   | `core.authz`, `core.settings` (a module that mails depends on this one, not the other way round)                                                                                                                                  |
| routes         | internal API: the caller's inbox, the category list, status, delivery list, requeue and test mail, see "Routes"                                                                                                                   |
| CLI            | `scorpion seed-dev-mail`, development only, see "Development setup"                                                                                                                                                               |
| jobs           | `core.notifications.deliver` and `core.notifications.retention`, see "Jobs"                                                                                                                                                       |
| events         | emits `notifications.delivery.dead@1`, `.requeued@1` and `notifications.settings.tested@1`; subscribes to `settings.changed@1` and `settings.secret.changed@1`, see "Events"                                                      |
| registries     | declares `notify.transport`, `notify.template` and `notify.recipientAddress`; contributes the preferences `notifications.locale` and `notifications.preferences` to `settings.userPreference`, see "Registries"                   |
| public service | `ctx.deps['core.notifications']`: `enqueue(tx, message)`, `enqueueTemplate(tx, message)`, `removeInboxOfUser(tx, userId)` and `status(actor)`; `public.ts` also exports `defineTemplate` and the locale helpers, see "Public API" |

### Permissions

| Permission                             | Allows                                                                     | Held by default by |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| `core.notifications.status.read`       | Read the delivery status: counts, recent error codes, the transport        | Admin              |
| `core.notifications.deliveries.read`   | List deliveries: metadata only, never the content, address, subject or URL | Admin              |
| `core.notifications.deliveries.manage` | Put a `dead` delivery back in the queue                                    | Admin              |
| `core.notifications.test`              | Send a test mail to your own address                                       | Admin              |
| `core.notifications.inbox.read`        | Read your own notifications                                                | User               |
| `core.notifications.inbox.write`       | Mark your own notifications read, and delete them                          | User               |
| `core.notifications.preference.read`   | List the notification categories you can switch on and off                 | User               |

The three `User` permissions come from the `authz.defaultRole` registry (`USER_PERMISSIONS` of `module.ts`).
`enqueue` checks no permission: it is for trusted code (ADR-0019), like the system methods of `core.authz`. The trust
boundary is the profile's module list. Admin holds every declared permission by resolution (ADR-0014).

### Settings

Stored by `core.settings` under the module id `core.notifications`; validated by the module's schema; a change reaches
another server process within 5 seconds (ADR-0017).

| Key                           | Default    | Meaning                                                                                                                      |
| ----------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `emailTransport`              | `none`     | `smtp` or `none`. `none` accepts every message, records it as `sent` with transport `none` and sends nothing.                |
| `smtp.host`                   | empty      | Required when `emailTransport` is `smtp`.                                                                                    |
| `smtp.port`                   | `587`      |                                                                                                                              |
| `smtp.tls`                    | `starttls` | `starttls` (587), `tls` (implicit TLS, 465) or `none` (a local relay such as Mailpit).                                       |
| `smtp.user`                   | empty      | Empty means the relay needs no sign-in. The password is a secret.                                                            |
| `smtp.timeoutSeconds`         | `10`       | Connection, greeting and socket stalls.                                                                                      |
| `webhook.enabled`             | `false`    | The webhook is an optional mirror for admin-addressed messages; a message for it is not queued while it is off.              |
| `webhook.url`                 | empty      | `https://` only. `http://` is allowed only together with `allowPrivateTargets`. No user name or password in the URL.         |
| `webhook.allowPrivateTargets` | `false`    | Lifts the address-range check for an internal relay (and permits `http://`). Nothing else is lifted.                         |
| `defaultLocale`               | `en`       | The language of a mail that names none (or names one that is not shipped). Shipped: `en`, `de`; anything else gives `en`.    |
| `maxAttempts`                 | `8`        | Attempts before a delivery is `dead` (1 to 20).                                                                              |
| `retentionDays`               | `90`       | How long `sent` and `dead` delivery rows are kept (from the last status change); the daily retention job deletes older ones. |
| `inboxRetentionDays`          | `90`       | How long a **read** inbox item is kept, counted from when it was read. Unread items are kept.                                |

The sender address and the instance name come from the branding settings of `core.settings` (`mailFrom`), read at send time.

### Secrets

Set with `scorpion set-secret <name>` (value from the prompt or standard input), stored encrypted (ADR-0016), never in a
setting, an event, a log line or an API response.

| Secret name                    | Used for                                          |
| ------------------------------ | ------------------------------------------------- |
| `notifications.smtp.password`  | The SMTP sign-in, when `smtp.user` is set         |
| `notifications.webhook.secret` | The HMAC-SHA256 key that signs every webhook body |

A transport that needs a secret that is not stored fails with the code `not-configured` and the message is retried.

**Moving from `SMTP_URL`** (0.4.x): the variable is no longer read and there is no fallback. Put the relay in the settings of
`core.notifications` (`emailTransport: smtp`, `smtp.host`, `smtp.port`, `smtp.tls`, `smtp.user`) through `PUT /settings/core.notifications`,
and the password with `scorpion set-secret notifications.smtp.password`. A server that starts with `SMTP_URL` set ignores it.

### Registries

| Registry                  | Entry                                                                                                      | Used for                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `notify.template`         | `defineTemplate({ key, schema, sensitive, category, categoryDescription, mandatory, catalogue, content })` | A mail. The module that owns the event contributes it; see [Templates](#templates). Both catalogues are required or the start fails.  |
| `notify.transport`        | `{ id, channel: 'email' \| 'webhook', create({ settings, secret }) }`                                      | A way to deliver. This module contributes `smtp`, `webhook` and `none`. `create` returns `{ id, send(message, { signal }), close? }`. |
| `notify.recipientAddress` | `{ id, addressOf(userId) → Promise<string \| null> }`                                                      | How to find a user's address, for the test mail. `core.identity` contributes it; without one the test route answers 409.              |

The email channel uses the transport named by `emailTransport` (the settings schema lists the ids, so a new transport adds its id there
in the same change); the webhook channel always uses `webhook`. The module keeps one built transport per id and rebuilds it when
the settings it reads differ from the ones it was built from, when it is older than 5 seconds, and at once when this process hears
a change event.

### User preference

| Key                         | Value                                                  | Meaning                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notifications.locale`      | `en` or `de`                                           | The language of the mail you receive. Set with `PUT /preferences/notifications.locale` (core.settings).                                                      |
| `notifications.preferences` | `{ <category>: { email?: boolean, inApp?: boolean } }` | Which kinds of notification you want by mail and in the app. A missing switch is on. `PUT /preferences/notifications.preferences` replaces the whole object. |

**How a preference is applied.** `enqueueTemplate` looks the value up (with `core.settings`' trusted `getUserPreference`) when the
recipient has a `userId` and the template is not `mandatory`. A category switched off stops its mail (`email: false`) and its inbox item
(`inApp: false`). A `mandatory` template ignores the value: the check is in the service, not in a UI. A category is `mandatory` in the list
only when all its templates are. Categories and their descriptions come from the templates (`category`, `categoryDescription`), never from a
list in this module; `GET /notifications/preferences/categories` shows them. A stored value for a category no template has any more is kept
and ignored.

### Events

| Event                               | Direction  | Payload                                                                |
| ----------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `settings.changed@1`                | subscribes | For module `core.notifications`: forget the built transports           |
| `settings.secret.changed@1`         | subscribes | For a secret named `notifications.*`: forget the built transports      |
| `notifications.delivery.dead@1`     | emits      | `deliveryId`, `template`, `channel`, `attempts`, `code`                |
| `notifications.delivery.requeued@1` | emits      | `deliveryId`, `template`, `channel`, `requestedBy` (the administrator) |
| `notifications.settings.tested@1`   | emits      | `deliveryId`, `template`, `requestedBy`                                |

Ids, template keys and an error code only: **never an address, a subject, a body or a URL**. Each is emitted in the transaction of the change.
`dead` is emitted where a row becomes dead (the `sending → dead` update and the event commit together); the other two by the admin methods. `core.audit` records all three when it is in the profile; the routes for requeue and the test mail have `audit: true` (ADR-0021).

### Jobs

| Job                            | Schedule         | Does                                                                                                                                                            |
| ------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.notifications.deliver`   | every minute     | Claims due rows and sends them until nothing is due. Also queued after every commit (see below).                                                                |
| `core.notifications.retention` | daily, 03:17 UTC | Deletes `sent` and `dead` deliveries older than `retentionDays` (never `queued` or `sending`) and read inbox items older than `inboxRetentionDays`, in batches. |

## Templates

A mail is a **template**: a typed TypeScript function, no template engine and no dependency (M4 decision 3). It is an entry of the
registry `notify.template`, built with `defineTemplate` and contributed by the module that owns the event:

```ts
import { defineTemplate } from '@scorpion/core-notifications/public';

export const approved = defineTemplate({
  key: 'identity.approved', // lower-case segments joined by dots
  schema: z.strictObject({ username: z.string(), signInUrl: z.url() }), // the data a caller passes
  sensitive: false, // true: the rendered body is deleted once the mail is sent or dead (ADR-0019)
  mandatory: false, // true: a security mail that no preference may switch off
  category: 'account', // groups templates for the preferences
  categoryDescription: { en: '...', de: '...' }, // what the category means to a person, shown next to its switches
  catalogue: {
    en: { subject: 'Welcome, {name}' /* … */ },
    de: { subject: 'Willkommen, {name}' /* … */ },
  },
  content: (data, { t, branding }) => ({
    subject: t('subject', { name: data.username }),
    blocks: [{ kind: 'action', label: t('action'), url: data.signInUrl }],
  }),
});
```

- **Both catalogues are required.** An entry without an `en` and a `de` catalogue, with an empty one, a bad key or a render that is not a
  function fails the start with the entry named; two modules contributing one key fail it too. A message missing in `de` falls back to English at
  run time, logs `{ template, key, locale }` (never a value) and fails the template's test (`templateProblems` in `@scorpion/testing`).
- **The layout is shared.** A template returns `{ subject, heading?, blocks }` (`text`, `list`, `action`, `note`); the module turns the same blocks into
  the plain-text part and the HTML part, with the instance name, logo, contact address and imprint link from the branding settings (rule 9).
- **Escaping is by construction.** Every value put in with `t('key', { name })` is cut to one line and stripped of line breaks, control characters
  and bidirectional marks; the HTML part escapes everything; a link is shown only if it is `https:`, `http:` or `mailto:`. The subject is one line
  whatever a name holds, so a hostile name cannot add a header. Tests use `<script>`, a bidi override and a line break in every template and language.
- **Language** (`enqueueTemplate`): the language the caller names (a user's `notifications.locale`, or one a request carried), checked against the
  shipped list (`de-AT` gives `de`); else `defaultLocale`; else English. An unsupported value never fails a mail.
- **Shipped here**, registered and tested, for modules that do not exist yet: `registry.membership-requested`, `registry.membership-decided`,
  `onboarding.application-submitted`, `onboarding.application-decided` and `kpi.reporting-reminder`. The seven identity templates (`identity.welcome`,
  `.registration-request`, `.approved`, `.rejected`, `.password-reset`, `.email-verification`, `.register-attempt`) belong to
  [core.identity](../core-identity/README.md).

## How delivery works

- **`enqueue(tx, message)`** throws unless it runs inside `ctx.db.tx()`, validates the message (Zod, with size limits), inserts a row in
  the caller's transaction and calls `pg_notify('notify_delivery', id)` there. A rollback removes the message; a commit guarantees it
  will be tried. It returns the delivery id, or `null` for a webhook message while the webhook is off.
- **The table is the queue.** Status is a text column checked in the service: `queued → sending → sent | queued | dead`.
  A worker claims due rows with `FOR UPDATE SKIP LOCKED` and a 5 minute lease, **counts the attempt at claim time**, sends outside any
  transaction and finishes the row with `UPDATE … WHERE status = 'sending' AND attempts = n`. Two workers cannot send one row;
  a crashed worker's lease runs out and the row is claimed again.
- **Backoff** after failed attempt `n`: `min(30 s · 2^(n-1), 1 h)`. After `maxAttempts` the row is `dead`. A failing row never blocks others.
- **Wake-up.** The `pg_notify` of a commit is heard by a `LISTEN` connection that each process holds (the module opens it at `system.ready`);
  it queues the job through `ctx.jobs.enqueue`, which sends through pg-boss outside the caller's transaction. A cron sweep every minute covers
  lost wake-ups and retries that came due. Delivery starts at most one job poll (2 s) after a commit.
- **A `sensitive` message** (a reset link) has its `text_body` and `html_body` set to null in the statement that moves it to `sent` or
  `dead`. It cannot use the webhook channel.
- **Nothing identifying is logged.** `last_error` holds a code (`ESOCKET`, `EAUTH`, `timeout`, `http-502`, `target-refused`, `not-configured`,
  `attempts-exhausted`), never a message. No address, subject, body, URL, password or signing secret reaches a log line; a test captures the
  log stream and greps it.

### The webhook

A JSON body `{ id, template, locale, subject, text, createdAt }` is posted to the configured URL with
`X-Scorpion-Signature: sha256=<hex>` (HMAC-SHA256 over `<timestamp>.<body>` with `notifications.webhook.secret`), `X-Scorpion-Timestamp`
and `X-Scorpion-Delivery`. A 2xx is delivered; anything else is a failure. The recipient address and the HTML part are never sent.
Because an administrator types the URL, the call is built against SSRF:

- the host is resolved **once** and every address must be public: loopback, private, link-local, unique-local, shared (CGNAT), multicast,
  documentation, reserved and cloud-metadata addresses are refused, in IPv4, IPv6 and the IPv4 forms inside IPv6 (mapped, NAT64, 6to4);
  a name that resolves to a public and a private address is refused;
- the connection goes to the address that was checked (no second lookup, so DNS rebinding changes nothing), with SNI and `Host` of the name;
- redirects are not followed (a 3xx is a failure, so https is never downgraded), the response is read up to 64 KiB, the whole call times out after 5 seconds;
- `allowPrivateTargets` lifts only the range check (and permits `http://`).

## Routes

All are internal API routes (`/api/internal/...`), thin, validated with Zod, 422 for bad input. Lists use the standard envelope with 0-based pages.

| Route                                         | Permission                             | Does                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /notifications/inbox`                    | `core.notifications.inbox.read`        | Your own items, newest first (`created_at`, then id); `page`, `pageSize` (at most 100)                                                                                               |
| `GET /notifications/inbox/unread-count`       | `core.notifications.inbox.read`        | `{ count }`                                                                                                                                                                          |
| `POST /notifications/inbox/read-all`          | `core.notifications.inbox.write`       | Marks all your unread items read: `{ updated }`                                                                                                                                      |
| `POST /notifications/inbox/{id}/read`         | `core.notifications.inbox.write`       | Marks one read (the first read time stays)                                                                                                                                           |
| `DELETE /notifications/inbox/{id}`            | `core.notifications.inbox.write`       | Deletes one                                                                                                                                                                          |
| `GET /notifications/preferences/categories`   | `core.notifications.preference.read`   | The categories the templates define, with descriptions (`en`, `de`), whether all their templates are mandatory, and the template keys                                                |
| `GET /notifications/status`                   | `core.notifications.status.read`       | Counts by status, the transport, `sentWithoutTransport`, the error codes of the last 7 days                                                                                          |
| `GET /notifications/deliveries`               | `core.notifications.deliveries.read`   | Filters `status`, `template`, `channel`, `from`, `to` (on creation time); newest first. **Metadata only**                                                                            |
| `POST /notifications/deliveries/{id}/requeue` | `core.notifications.deliveries.manage` | Only a `dead` delivery whose body still exists: resets `attempts`, wakes delivery, emits `notifications.delivery.requeued@1`. 404 unknown, 409 otherwise                             |
| `POST /notifications/test`                    | `core.notifications.test`              | Queues the test mail (template `notifications.test`) for **your own** address; 202 `{ deliveryId, transportIsNone }`. Burst of 3, then 6 an hour (429); 409 when no address is known |

Rules that hold for every route here:

- **Own items only.** The inbox methods take the actor and use its user id; none takes a user id. An item id that is not yours, or does not exist,
  is **403** (no 404, so the answer says nothing about other people's items). A malformed id is 422.
- **A delivery response has no body, address, subject or URL.** The view is written field by field (`id`, `template`, `channel`, `status`,
  `attempts`, `lastError` (a code), `transport`, `sensitive`, `recipientUserId`, `bodyAvailable`, timestamps). `bodyAvailable` is false once a
  sensitive body was scrubbed: such a delivery **cannot be requeued** (409).
- **Inbox items are plain text.** A UI shows `title`, `text` and `link` as text and never as HTML (no `{@html}`).
- **A `sensitive` template (reset, verification) writes no inbox item**, whatever the caller asks: its link is a credential.

## Inbox

An inbox item is written by `enqueueTemplate(tx, { ..., inApp: true })` for a recipient with a `userId`, **in the same transaction as the
mail**, or alone when the person has no address or switched email off. Title, text and link come from the **same content blocks as the mail**
(`inAppFromContent`; no second text source): the heading (else the subject), the text and list blocks, the first link. Bidi marks and control
characters are removed as in the mail; the title is one line of at most 200 characters, the text at most 2000, the link at most 2048 and
accepted only if it is an `http(s)` or `mailto` URL. The link is built by the template from `ORIGIN` and `BASE_PATH` like a mail link. Items of
a purged account are removed by the identity purge (`removeInboxOfUser`, in its transaction). Read items are deleted by the retention job.

## Public API

`ctx.deps['core.notifications']` (declare `core.notifications` in your `package.json`; see `public.ts`). Two ways to enqueue, both inside the caller's
transaction and both checking no permission. **A caller that sends a registered template uses `enqueueTemplate`; `enqueue` takes a message that is already
rendered** (an `identity` mail always uses the first):

```ts
await ctx.db.tx(async (tx) => {
  // ... the work ...
  await notifications.enqueueTemplate(tx, {
    template: 'identity.password-reset',
    data: { resetUrl, validForMinutes: 60 }, // validated by the template's schema (422 `Invalid`), never stored
    recipient: { address: user.email, userId: user.id }, // both optional, at least one; userId is opaque
    locale: 'de', // optional; checked against the shipped list
    inApp: true, // optional: also an inbox item for userId (never for a sensitive template)
  });
});
```

It returns the delivery id, or **`null` when no mail was stored**: the recipient has no address, or switched email off (see
[User preference](#user-preference)). When there is nothing to store at all it does nothing and succeeds; a recipient with neither an address nor
a user id is a bug and throws `NotificationError`. `sensitive` is the template's decision, not the caller's. An unknown template key throws `NotificationError` (a bug in the caller). The raw form:

```ts
await ctx.db.tx(async (tx) => {
  // ... the work ...
  await notifications.enqueue(tx, {
    template: 'identity.password-reset', // a key: lower-case segments joined by dots
    recipientAddress: user.email,
    recipientUserId: user.id, // optional, opaque
    subject: 'Reset your password', // one line, at most 300 characters
    text: '...', // at most 100 000
    html: '...', // optional, at most 300 000
    sensitive: true, // the bodies are deleted once the message is sent or dead
    inApp: { title: '...', text: '...', link: 'https://...' }, // optional inbox item for recipientUserId; not with sensitive
  });
});
```

`removeInboxOfUser(tx, userId)` deletes a user's inbox in the caller's transaction (for the identity purge; no permission, no route).

`status(actor)` needs `core.notifications.status.read` and returns the counts by status, the error codes of the last 7 days
and `transportIsNone`, so an operator notices an instance that sends nothing; `GET /notifications/status` serves it.

## Operating notes

- A fresh instance has `emailTransport = none`: messages are recorded and dropped, and `status().transportIsNone` is true. The log says so **once**, at
  start-up (a warning), not once per message; `status().sentWithoutTransport` and the `dropped` count in the delivery job's log line are the counter.
- To use a relay: set `emailTransport`, `smtp.*` in the settings, and `scorpion set-secret notifications.smtp.password` if it needs a sign-in.
  A change reaches every server process within 5 seconds.
- The module opens one extra Postgres connection per process for `LISTEN`. Without it, delivery still happens within a minute.
- Upgrade note: `SMTP_URL` is **not** read by anything any more ([Secrets](#secrets) says where the relay settings go).

### Development setup

`pnpm dev` starts Postgres and Mailpit (`docker-compose.dev.yml`) and then runs **`scorpion seed-dev-mail`**, which stores `emailTransport: smtp` with
`localhost:1025` (no TLS) as this module's settings **only if none are stored**. Mail then shows up in the Mailpit UI at http://localhost:8025. The command
refuses to run when `NODE_ENV=production` (every image sets it), so a production instance never gets a relay it did not configure, and it never overwrites
settings an administrator saved. `--host` and `--port` serve a compose network (`--host mailpit`).

## Tests

`pnpm test --filter @scorpion/core-notifications` (needs Docker): table-driven tests for the backoff schedule, the address-range check
(IPv4, IPv6, mapped forms, DNS rebinding, `http://` downgrade) and the settings; integration tests for rollback, exactly-once delivery with
racing workers, a relay that is down (growing attempts, dead, recovery), the sensitive-body scrub, leases, the job path, a transport change
reaching a second kernel within the TTL, the webhook, denied permissions, and a grep of the log stream for secrets. Sprint 2 adds: table-driven tests of
the escaping helpers, the locale choice and the translator; a snapshot per shipped template and language and the rules every template must keep
(`templateProblems` of `@scorpion/testing`: same keys in both languages, no English fallback, hostile names); `enqueueTemplate` against Postgres (rollback,
outside a transaction, locale choice, branding, header injection through a real relay); the start-up refusals of the registry; the seed command; and the quiet log.
Sprint 3 adds: `service/preferences.test.ts` (table-driven resolution), `templates/inapp.test.ts` and `templates/system.test.ts` (the inbox form, hostile text, category
descriptions), `service/inbox.test.ts` (an item in the mail's transaction or alone, preferences, `mandatory`, the sensitive grep, own-only access with the
403 cases, the purge hook, rollback) and `service/admin.test.ts` (the list without content, requeue with its event and rollback, the scrubbed row, the dead event,
the test mail and its budget, retention). The routes are tested through the pipeline in `apps/server/src/notification-routes.test.ts`, which also shows
a relay that is down as `dead` with its error code and no body, and the route-table walker of `defect-01.privilege-escalation.test.ts` has an entry for every route.
Factories: `makeDelivery` and `makeInboxItem` in `packages/testing`.
