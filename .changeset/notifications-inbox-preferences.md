---
'scorpion': minor
---

**In-app inbox, notification preferences and an administrator's view of delivery** (`core.notifications`, in the `full` and
`kpi-tracker` profiles). Mail itself behaves as before; this adds what people and administrators can see and control.

- **New migration:** one table, `notify_inbox_item`. Run `scorpion migrate` (or just start the server).
- **New permissions.** Held by every signed-in user (the role `user`): `core.notifications.inbox.read`,
  `core.notifications.inbox.write`, `core.notifications.preference.read`. Held by Admin only:
  `core.notifications.deliveries.read`, `core.notifications.deliveries.manage`, `core.notifications.test` (next to the existing
  `core.notifications.status.read`). Custom roles get none of them until you add them. A plain User gets **403** on every
  administrator route.
- **New routes** (internal API, standard envelope, 0-based pages):
  - your inbox: `GET /notifications/inbox`, `GET /notifications/inbox/unread-count`, `POST /notifications/inbox/read-all`,
    `POST /notifications/inbox/{id}/read`, `DELETE /notifications/inbox/{id}`. You see only your own items; an item id that is
    not yours (or does not exist) is 403, never 404.
  - `GET /notifications/preferences/categories`: the kinds of notification the profile sends, with descriptions in English and German.
  - `GET /notifications/status`: counts by status, the transport and the latest error codes.
  - `GET /notifications/deliveries`: filter by `status`, `template`, `channel`, `from`, `to`. **Metadata only**: never a body,
    address, subject or link.
  - `POST /notifications/deliveries/{id}/requeue`: puts a `dead` delivery back in the queue with its attempts reset. A delivery whose
    body was removed when it ended (a reset or verification mail) cannot be requeued (409).
  - `POST /notifications/test`: sends a test mail to **your own** address through the configured transport (3 at once, then 6 an hour;
    429 after that; 409 if your account has no address). The answer says whether the transport is `none`.
- **Preferences.** Each person can switch a category of notification off for mail and for the inbox with
  `PUT /preferences/notifications.preferences` (`{ "<category>": { "email": false, "inApp": false } }`; the default is on). Security
  mails (reset, verification, the register notice) and the test mail are mandatory and ignore the switch. This applies at once to
  the welcome, approved, rejected and registration-request mails, which a recipient can now switch off.
- **What a person sees in the inbox:** the title, text and first link of the same message the mail carries, as plain text. A mail
  that holds a credential (password reset, address confirmation) never leaves an inbox item. Nothing writes inbox items for identity
  mail yet; the first modules that use them arrive with the registry and onboarding modules.
- **New settings** of `core.notifications`: `inboxRetentionDays` (default 90; counted from when an item was read, unread items are
  kept). `retentionDays` (default 90) now takes effect.
- **New job** `core.notifications.retention`, daily at 03:17 UTC: deletes `sent` and `dead` deliveries older than `retentionDays`
  (never `queued` or `sending` ones) and read inbox items older than `inboxRetentionDays`.
- **New events** in the outbox, with ids and template keys only (no address, subject or body): `notifications.delivery.dead@1`,
  `notifications.delivery.requeued@1`, `notifications.settings.tested@1`.
- Purging a soft-deleted account (after the 30-day retention) now also deletes the person's inbox items.
