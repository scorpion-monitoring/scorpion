# ADR-0023: Inbox, preferences and the administration of delivery

- Status: Accepted
- Date: 2026-10-05

## Context

M4 sprint 3 adds what users and administrators see of `core.notifications`: an in-app inbox, per-category preferences, and the admin
routes for status, the delivery list, requeue and a test mail. The plan (§6) fixes the routes and permissions and leaves open where
the preference check runs, what the corner cases mean, and a few numbers. `core.notifications` is user-agnostic (ADR-0019): it knows
an opaque user id and imports nothing from `core.identity`. ADR-0012 and ADR-0019 forbid a mail's token anywhere but the queued
row, and only until the mail ends.

## Decisions

### 1. The preference check runs inside `enqueueTemplate`

When `recipient.userId` is given and the template is not `mandatory`, `enqueueTemplate` reads the preference `notifications.preferences`
with `core.settings`' trusted `getUserPreference(userId, key)` (ADR-0015, added in sprint 2) and resolves the channels with a pure
function (`resolveChannels`). Callers do not check anything and cannot forget to. The arrow stays `notifications → settings`; no
import of identity appears. A `mandatory` template skips the lookup altogether (nothing to decide). A recipient with no user id has no
preferences: both channels are wanted.

The stored value is `{ [category]: { email?: boolean, inApp?: boolean } }`; a missing switch is on. The registered schema accepts any
well-formed category key, not only today's categories: `getUserPreference` returns `undefined` for a value that no longer passes the
schema, so a stricter schema would silently reset a person's choices when a module leaves the profile. Unknown categories are ignored.
The value is written with core.settings' own `PUT /preferences/{key}`; this sprint adds no parallel route.

`mandatory` is a property of the template, and a category is shown as mandatory only when all its templates are. The category list
(`GET /notifications/preferences/categories`, permission `core.notifications.preference.read`, given to the role `user`) is built from the template registry. A template may carry an optional
`categoryDescription` (`en` and `de`); a category takes the first one it finds. Descriptions are data of the templates, not a list in this module (rule 8).

### 2. Nobody to reach is not an error; nobody _can_ be reached is a bug

`enqueueTemplate` now returns the delivery id **or `null`**. `null` means no mail was stored: the recipient has no address, or switched
email off. If the person also did not want the inbox item (or the caller did not ask for one), nothing is stored at all, the call
succeeds, and only a debug line with the template key is logged (no id, no address). A recipient with neither an address nor a user id
cannot be reached by any channel; that is a bug in the caller and throws `NotificationError`. The data is validated before any of
this, so bad input is a 422 even when the person has switched the category off.

### 3. `inApp` is the caller's choice, per message, for any recipient with a user id

The flag is generic. It applies to admin-addressed mail too ("all admins" in registration): identity passes each administrator's user id.
The sprint does not turn it on in `core.identity` (that is a behaviour change outside the plan's items; it goes to the backlog). The
preference decides, as for any user. The webhook mirror has no user and has no inbox.

### 4. What the inbox shows, and what a sensitive template shows

The title and text are rendered from the **same content blocks as the mail** (`inAppFromContent`), so there is no second text source.
They are stored as plain text, cleaned by the helpers that clean the mail (bidi marks and control characters out, a one-line title).
**A UI shows them as text and never as HTML**; the text is not HTML-escaped at rest. The link is the first action block's URL, built
by the template from the origin and the base path (`mountPath`), accepted only if `safeUrl` takes it.

**A `sensitive` template writes no inbox item, whatever the caller asks.** Its link is a credential and an inbox row outlives the
mail. Showing only the title would still tell a bystander that a reset was requested, and the mail is `mandatory` anyway. A
test greps every table, the events and the log for the token.

A raw `enqueue(tx, message)` can carry `inApp: { title, text, link? }` (no template to render from; cleaned the same way, never for
a sensitive message, never preferences since a raw message has no category).

### 5. Numbers

- **Inbox pages:** the standard `paginationQuery()`: default 20, at most 100, 0-based. Order: `created_at` desc, then `id` desc.
- **Caps** (also CHECK constraints): title 1 to 200 characters, text 0 to 2000, link 2048.
- **Retention:** `inboxRetentionDays` (setting, default 90) counts from `read_at`; unread items are kept. `retentionDays` (default 90)
  deletes `sent` and `dead` deliveries by `status_changed_at`; `queued` and `sending` rows are never deleted. Both run in the daily job
  `core.notifications.retention` (03:17 UTC), in batches of 1000. The plan's name `notify.retention` is not allowed: the kernel requires a
  job name to start with the module id.
- **Test mail:** the route is in the `strict` rate-limit group (by client address) and the service adds a bucket per administrator:
  a burst of 3, then 6 per hour. Past it: 429 with the wait in the detail.

### 6. Inbox items and the id of somebody else

Every inbox method takes the actor and uses its user id; no method takes a user id. An item id that is not the caller's is a
**403**, and so is an id that does not exist, so the answer is no oracle for other people's items. (Tokens in M3 answer 404 for both; the
sprint's requirement is 403 here.) A malformed id is 422 at the route.

### 7. A deleted user's items go with the purge, through a trusted call from identity

`core.notifications` cannot subscribe to `identity.user.purged@1` (ADR-0019: identity depends on notifications, and ADR-0003 allows
subscribing to a dependency's events only). Instead the identity purge calls `notifications.removeInboxOfUser(tx, userId)` in the purge
transaction, next to `authz.removeAllAssignments` and the avatar release. It checks no permission and no route calls it (ADR-0015).
A retention rule alone would leave unread items of a deleted person for ever. Delivery rows keep their opaque `recipient_user_id`
and their address until `retentionDays` removes them; scrubbing them at purge is a backlog item.

### 8. The address for the test mail comes from a registry, not an import

The route sends the test mail "to the caller's own address", but notifications does not know addresses. It declares a registry
`notify.recipientAddress` (`{ id, addressOf(userId) → string | null }`) and `core.identity` contributes the entry (rule 7), the same
direction as the `notify.template` entries it already contributes. A profile without identity answers 409 ("no address"). The mail is
the mandatory template `notifications.test` (category `system`), so no preference swallows it, and goes through the configured
transport like any mail; the response says whether that transport is `none`.

### 9. Requeue, scrub and events

- Only a `dead` delivery can be requeued (409 otherwise, 404 for an unknown id). **A row whose body was scrubbed cannot be sent and is
  refused with 409**: the check is on the body being gone, not on the `sensitive` flag. The row is locked, so two parallel requeues
  make one event.
- Requeue is **not** an edge of the worker's state machine (`TRANSITIONS` keeps `dead` as an end for workers); it is an administrator's
  decision in its own statement. It resets `attempts`, makes the row due and wakes delivery.
- Events (ids, template keys, channel, an error code and the requesting user's id; **no address, subject or body**), all emitted through the
  outbox in the transaction of the change: `notifications.delivery.dead@1` where a row becomes dead (the `sending → dead` update and the
  event are one transaction; if the event cannot be stored the row stays `sending` and its lease expires, so the next pass tries again),
  `notifications.delivery.requeued@1`, `notifications.settings.tested@1`.
- No admin response carries a body, address, subject or URL of a delivery. The views are written field by field, `bodyAvailable` tells
  whether the row can still be sent, and a test walks every response for forbidden keys and values.

## Consequences

- `enqueueTemplate`'s result type widens to `string | null`, and `recipient.address` becomes optional. Identity ignores the result.
- `core.notifications` gains four permissions for Admin (`status.read` exists; `deliveries.read`, `deliveries.manage`, `test`) and three for
  the role `user` (`inbox.read`, `inbox.write`, `preference.read`).
- Identity gains two small things: it contributes `notify.recipientAddress` and calls `removeInboxOfUser` in the purge.
- `TemplateEntry` gains optional `categoryDescription` and `renderInApp`; `defineTemplate` provides both. Templates built by hand (no
  `renderInApp`) cannot write an inbox item; asking for one is a `NotificationError`.
- Preferences now apply to every identity mail that passes a user id and is not `mandatory`: `identity.welcome`, `identity.approved`,
  `identity.rejected` (category `account`) and `identity.registration-request` (category `administration`) can be switched off by their
  recipient. The new-account path of registration does one preference lookup the taken-address path does not (the notice is `mandatory`);
  that is one indexed read next to an argon2 hash, within ADR-0012's "as far as practical".
- Sprint 4's audit subscriber can record the three events; they hold no personal data.
