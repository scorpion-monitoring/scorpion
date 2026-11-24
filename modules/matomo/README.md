# matomo

Usage statistics of the instance with Matomo: which pages people open, how often, and by how many people. The browser
loads the tracker from the operator's Matomo and sends one page view per page. Matomo receives the page's **pattern**
(`/services/:slug`), never its address: no ids, no query, no fragment. Decisions: [ADR-0054](../../docs/adr/0054-usage-statistics-with-matomo.md);
plan: [M13b](../../docs/matomo-plan.md).

This is not the Matomo pull adapter of `kpi.ingestion` (`implementation.md` §10), which would read numbers of
_registered services_ from Matomo into their KPIs.

Status: M13b.

## Manifest

| Part                          | Value                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| id                            | `matomo`                                                                                                            |
| table prefix                  | none: the module has no tables                                                                                      |
| dependencies                  | `core.settings` (settings and the secret), `core.ui-shell` (the widget registry)                                    |
| permissions                   | none of its own: settings need `core.settings.write`, the secret `core.settings.secret.write`                       |
| settings                      | `enabled`, `url`, `siteId`, `cookieless`, `respectDoNotTrack`, `pseudonymousUserId` ([below](#settings))            |
| secret                        | `matomo.user-id-key`, only for `pseudonymousUserId`                                                                 |
| routes                        | `GET /api/internal/matomo/tracker` (public, rate limited, `no-store`)                                               |
| registries                    | contributes one `ui.widget`: `matomo.tracker` in the shell slot `page-end`, public, draws nothing                   |
| jobs, events, commands, `env` | none                                                                                                                |
| profiles                      | `full`, **off** until an administrator turns it on                                                                  |
| public                        | `public.ts` exports `isMatomoUrl`, `MAX_URL_LENGTH`, `trackerRoute`, `trackerConfigSchema` and `USER_ID_KEY_SECRET` |

## Turning it on

1. In Matomo, add a website for the instance and note its id.
2. At `/admin/settings/matomo`, set `url` (the `https:` base address of Matomo, a path such as `/matomo/` is fine) and
   `siteId`, and turn `enabled` on. The change is read within 5 seconds, with no restart.
3. Update the privacy policy (`/admin/settings/core.settings`, legal texts): see [Privacy](#privacy).

From then on every page of the web app carries the Matomo origin in its Content-Security-Policy (`script-src`,
`connect-src`, `img-src`), and only while tracking is on. Nothing else in the policy changes.

## Settings

| Key                  | Default | Meaning                                                                                                                                                                       |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `false` | Tracking on or off                                                                                                                                                            |
| `url`                | none    | The Matomo base address: `https:` only, at most 200 characters, no user, query, fragment or wildcard. Required while `enabled`                                                |
| `siteId`             | none    | The site id in Matomo. Required while `enabled`                                                                                                                               |
| `cookieless`         | `true`  | Matomo sets no cookie (`disableCookies`)                                                                                                                                      |
| `respectDoNotTrack`  | `true`  | A browser that sends Do Not Track or Global Privacy Control sends nothing                                                                                                     |
| `pseudonymousUserId` | `false` | For a signed-in person, send `HMAC-SHA256(matomo.user-id-key, user id)` (32 hex characters) as the Matomo user id. Without the secret no id is sent, and the log says so once |

Set the secret with `pnpm scorpion set-secret matomo.user-id-key` (any long random value, for example
`openssl rand -base64 32`). Setting a new value gives everybody a new id, which breaks the link to earlier ones: that is
the way to start over.

## What is sent

One page view per page the person opens (a change of the query, such as a search, is not a new page):

| Matomo field         | Value                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| URL (`setCustomUrl`) | origin + base path + the page's pattern: `https://scorpion.example.org/services/:slug` |
| Title                | the pattern again (a page title can hold a name)                                       |
| Referrer             | the tracked URL of the page before, for a navigation inside the application            |
| User id              | the pseudonymous id, only with `pseudonymousUserId`                                    |
| Error pages          | `/(error)`; a page with no pattern: `/(unknown)`                                       |

What Matomo's tracker adds on its own: the visitor's address (Matomo can shorten it: _Privacy → Anonymize data_), the
browser, the screen size and the language. Link and download tracking stay off: they would send addresses.

## Unique users

Without cookies Matomo recognises a visitor by a hash of the address, the browser set-up and the language:

| Number                                                        | Cookieless only | With `pseudonymousUserId`     |
| ------------------------------------------------------------- | --------------- | ----------------------------- |
| Visits, page views, pages, entry and exit pages, time on page | good            | good                          |
| Unique visitors per day                                       | a good estimate | exact for signed-in people    |
| Unique visitors per week, month or year                       | too high        | exact for signed-in people    |
| People behind one address with the same browser               | merged into one | apart when signed in          |
| Returning visitors                                            | not reliable    | reliable for signed-in people |

So report the weekly and monthly unique visitors of a cookieless set-up as an upper bound, not an exact number. The table
is the expected behaviour of Matomo's cookieless mode; it has not yet been checked against a real Matomo (`docs/backlog.md`,
"M13b usage statistics follow-ups").

## Privacy

The software cannot write the operator's legal text (CLAUDE.md rule 9). The privacy policy should name:

- that page views are sent to the instance's Matomo, who runs it, and where;
- what is sent (the table above) and that no cookie is set (with `cookieless`);
- with `pseudonymousUserId`: that a pseudonymous id of the account is sent, and that it cannot be traced back without a
  key that only the instance holds;
- that Do Not Track and Global Privacy Control are honoured (with `respectDoNotTrack`);
- how long Matomo keeps the data (Matomo: _Privacy → Anonymize data → Delete old raw data_).

## Not in this module

A consent banner (`requireConsent`), a same-origin proxy of the tracker, and Matomo events are in `docs/backlog.md`.
