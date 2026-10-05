# core.notifications

Delivery of messages: a message is stored in the transaction of the work that causes it, sent outside any
transaction, retried when the relay is down and visible to an operator. Email goes through SMTP (Nodemailer); a signed
webhook mirrors admin-addressed messages. It is user-agnostic like `core.authz` ([ADR-0019](../../docs/adr/0019-module-graph-and-notifications-port.md)):
it stores an opaque `recipient_user_id` with no foreign key and takes the address from the caller. The queue is a table
([ADR-0020](../../docs/adr/0020-delivery-queue-in-a-table.md)).

Status: M4 sprint 2. Every mail of `core.identity` goes through this module, and the variable `SMTP_URL` is gone: the relay is
configured in the settings below and its password is a secret. Templates and the two shipped languages (`en`, `de`) are here
([Templates](#templates)). There are no routes, inbox or preferences UI yet (sprint 3).

## Manifest

| Part           | Value                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id             | `core.notifications`                                                                                                                                                                             |
| table prefix   | `notify_` (set in the manifest; ADR-0004)                                                                                                                                                        |
| dependencies   | `core.authz`, `core.settings` (a module that mails depends on this one, not the other way round)                                                                                                 |
| routes         | none                                                                                                                                                                                             |
| CLI            | `scorpion seed-dev-mail`, development only, see "Development setup"                                                                                                                              |
| jobs           | `core.notifications.deliver`, see "Jobs"                                                                                                                                                         |
| events         | emits none; subscribes to `settings.changed@1` and `settings.secret.changed@1`, see "Events"                                                                                                     |
| registries     | declares `notify.transport` and `notify.template`; contributes the user preference `notifications.locale` to `settings.userPreference`, see "Registries"                                         |
| public service | `ctx.deps['core.notifications']`: `enqueue(tx, message)`, `enqueueTemplate(tx, message)` and `status(actor)`; `public.ts` also exports `defineTemplate` and the locale helpers, see "Public API" |

### Permissions

| Permission                       | Allows                                                              | Held by default by |
| -------------------------------- | ------------------------------------------------------------------- | ------------------ |
| `core.notifications.status.read` | Read the delivery status: counts, recent error codes, the transport | Admin              |

`enqueue` checks no permission: it is for trusted code (ADR-0019), like the system methods of `core.authz`. The trust
boundary is the profile's module list. Admin holds every declared permission by resolution (ADR-0014).

### Settings

Stored by `core.settings` under the module id `core.notifications`; validated by the module's schema; a change reaches
another server process within 5 seconds (ADR-0017).

| Key                           | Default    | Meaning                                                                                                                   |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `emailTransport`              | `none`     | `smtp` or `none`. `none` accepts every message, records it as `sent` with transport `none` and sends nothing.             |
| `smtp.host`                   | empty      | Required when `emailTransport` is `smtp`.                                                                                 |
| `smtp.port`                   | `587`      |                                                                                                                           |
| `smtp.tls`                    | `starttls` | `starttls` (587), `tls` (implicit TLS, 465) or `none` (a local relay such as Mailpit).                                    |
| `smtp.user`                   | empty      | Empty means the relay needs no sign-in. The password is a secret.                                                         |
| `smtp.timeoutSeconds`         | `10`       | Connection, greeting and socket stalls.                                                                                   |
| `webhook.enabled`             | `false`    | The webhook is an optional mirror for admin-addressed messages; a message for it is not queued while it is off.           |
| `webhook.url`                 | empty      | `https://` only. `http://` is allowed only together with `allowPrivateTargets`. No user name or password in the URL.      |
| `webhook.allowPrivateTargets` | `false`    | Lifts the address-range check for an internal relay (and permits `http://`). Nothing else is lifted.                      |
| `defaultLocale`               | `en`       | The language of a mail that names none (or names one that is not shipped). Shipped: `en`, `de`; anything else gives `en`. |
| `maxAttempts`                 | `8`        | Attempts before a delivery is `dead` (1 to 20).                                                                           |
| `retentionDays`               | `90`       | How long delivered rows are kept. The job that deletes them comes with sprint 3.                                          |

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

| Registry           | Entry                                                                                 | Used for                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `notify.template`  | `defineTemplate({ key, schema, sensitive, category, mandatory, catalogue, content })` | A mail. The module that owns the event contributes it; see [Templates](#templates). Both catalogues are required or the start fails.  |
| `notify.transport` | `{ id, channel: 'email' \| 'webhook', create({ settings, secret }) }`                 | A way to deliver. This module contributes `smtp`, `webhook` and `none`. `create` returns `{ id, send(message, { signal }), close? }`. |

The email channel uses the transport named by `emailTransport` (the settings schema lists the ids, so a new transport adds its id there
in the same change); the webhook channel always uses `webhook`. The module keeps one built transport per id and rebuilds it when
the settings it reads differ from the ones it was built from, when it is older than 5 seconds, and at once when this process hears
a change event.

### User preference

| Key                    | Value        | Meaning                                                                                                 |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `notifications.locale` | `en` or `de` | The language of the mail you receive. Set with `PUT /preferences/notifications.locale` (core.settings). |

### Events

| Event                       | Direction  | Meaning                                                           |
| --------------------------- | ---------- | ----------------------------------------------------------------- |
| `settings.changed@1`        | subscribes | For module `core.notifications`: forget the built transports      |
| `settings.secret.changed@1` | subscribes | For a secret named `notifications.*`: forget the built transports |

The events of sprint 3 (`notifications.delivery.dead@1`, `.requeued@1`) are not declared yet.

### Jobs

| Job                          | Schedule     | Does                                                                                             |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `core.notifications.deliver` | every minute | Claims due rows and sends them until nothing is due. Also queued after every commit (see below). |

## Templates

A mail is a **template**: a typed TypeScript function, no template engine and no dependency (M4 decision 3). It is an entry of the
registry `notify.template`, built with `defineTemplate` and contributed by the module that owns the event:

```ts
import { defineTemplate } from '@scorpion/core-notifications/public';

export const approved = defineTemplate({
  key: 'identity.approved', // lower-case segments joined by dots
  schema: z.strictObject({ username: z.string(), signInUrl: z.url() }), // the data a caller passes
  sensitive: false, // true: the rendered body is deleted once the mail is sent or dead (ADR-0019)
  mandatory: false, // true: a security mail that no preference may switch off (sprint 3)
  category: 'account', // groups templates for the preferences (sprint 3)
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
    recipient: { address: user.email, userId: user.id }, // userId is opaque, optional
    locale: 'de', // optional; checked against the shipped list
  });
});
```

`sensitive` is the template's decision, not the caller's. An unknown template key throws `NotificationError` (a bug in the caller). The raw form:

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
  });
});
```

`status(actor)` needs `core.notifications.status.read` and returns the counts by status, the error codes of the last 7 days
and `transportIsNone`, so an operator notices an instance that sends nothing. There are no routes until sprint 3.

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
Factory: `makeDelivery` in `packages/testing`.
