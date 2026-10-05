---
'scorpion': minor
---

**Breaking for operators: `SMTP_URL` is removed, with no fallback.** `core.identity` now sends every mail through
`core.notifications`, and the variable is no longer read by anything (a server that starts with it set ignores it). Before
you upgrade, configure mail where it now lives:

- **Relay:** the settings of `core.notifications` (`PUT /settings/core.notifications`): `emailTransport: "smtp"`, and
  `smtp.host`, `smtp.port`, `smtp.tls` (`starttls`, `tls` or `none`) and `smtp.user`.
- **Password:** `scorpion set-secret notifications.smtp.password` (stored encrypted with `SECRETS_KEY`, never in a setting).
- Until you do, `emailTransport` stays `none`: mail is recorded and dropped, the log says so **once** at start-up (not once
  per message), and the status shows `transportIsNone` and a count of dropped mail.
- The sender address and the instance name, logo, contact address and imprint link in every mail come from the branding
  settings, as before.

**`POST /auth/register` now answers `202 { "accepted": true }` for every well-formed request** (it was `201` with the new
account, and `409` for a taken email address). A new address gets the account, a welcome mail and the confirmation link,
and every administrator gets a "registration request" mail; an address that already has an account gets only a notice mail to
its owner ("someone tried to register with your address") and nothing is created. A taken **username** is still a `409`. The
response no longer contains the user, so a client reads the id after sign-in. No UI exists yet; it arrives with M5. The route
also accepts an optional `locale` in the body (also on `POST /auth/password-reset`).

New in this release:

- **Mail templates in English and German**, with a shared layout (instance name, logo, contact address, imprint link) and a
  plain-text part: welcome, registration request (to administrators), approved, rejected, password reset, email
  verification and the register notice. Templates for membership requests and decisions, onboarding applications and KPI
  reporting reminders are registered for the modules that will send them. A mail is in the language the person chose with the
  new preference `notifications.locale` (`en` or `de`, set with `PUT /preferences/notifications.locale`), else the request's
  `locale`, else the `defaultLocale` setting, else English.
- Mails are stored in the same transaction as the change that causes them, so a rollback sends nothing, and they are retried
  when the relay is down. A reset or verification link is in the mail only: its stored body is deleted once the mail is sent.
- **Development:** `pnpm dev` points a fresh database at the Mailpit of `docker-compose.dev.yml` with the new command
  `scorpion seed-dev-mail`. It only runs outside production (it refuses with `NODE_ENV=production`, which every image sets)
  and never overwrites mail settings that are saved.
- Two methods for trusted code, reachable from no route: `core.authz` lists the holders of a role, and `core.settings` reads
  another user's preference and seeds settings that were never stored.
