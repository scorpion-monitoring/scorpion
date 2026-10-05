---
'scorpion': minor
---

New module `core.notifications` (in the `full` and `kpi-tracker` profiles): a delivery queue for email and a signed webhook.
Upgrading needs no action for this part: the module starts with email transport `none`, which records messages and sends
nothing, and says so in its status. (The next changeset moves `core.identity` onto the queue and removes `SMTP_URL`.)

- **New migration:** one table, `notify_delivery`.
- **New settings** (stored by `core.settings` under `core.notifications`): `emailTransport` (`smtp` or `none`, default `none`), `smtp`
  (`host`, `port`, `tls` = `starttls` / `tls` / `none`, `user`, `timeoutSeconds`), `webhook` (`enabled`, `url`, `allowPrivateTargets`),
  `defaultLocale`, `maxAttempts` (default 8) and `retentionDays`. A change reaches every server process within 5 seconds.
- **New secret names** (set with `scorpion set-secret`, never in settings): `notifications.smtp.password` and
  `notifications.webhook.secret` (the HMAC-SHA256 key that signs webhook bodies). Both are encrypted with `SECRETS_KEY`.
- **New permission** `core.notifications.status.read` (Admin). There are no routes yet.
- Messages are stored in the transaction that causes them and delivered by a job that runs every minute and right after
  a commit. A failed send is retried after 30 s, doubling up to 1 h, then marked dead; the body of a sensitive message
  (a reset link) is deleted once it is sent or dead. The webhook refuses private, loopback, link-local and cloud-metadata
  addresses unless `allowPrivateTargets` is on, resolves the host once, and follows no redirects.
- The module opens one extra database connection per process to listen for new messages.
