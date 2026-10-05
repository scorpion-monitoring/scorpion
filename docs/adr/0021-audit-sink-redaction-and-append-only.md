# ADR-0021: The audit sink, what is stored, and an append-only table

- Status: Accepted
- Date: 2026-10-05

## Context

M4 sprint 4 adds `core.audit`: an append-only trail of administrative and permission-relevant actions and of API calls. Two things
have to write to it: the domain events that modules already emit (atomic with the change, at least once, ADR-0003), and the request
pipeline, which sees what events never do: a call that was turned away, an invalid request, the caller's address. The plan (§7, §10
decision 2 and 5) fixes the shape: an event subscriber plus a kernel port, redacted and capped bodies, an append-only table. This ADR
records the decisions that the plan left open. The number 0021 was kept free for it since ADR-0022; ADR-0024 holds the decisions
that are not about the sink.

## Decisions

### 1. The port is `kernel.auditSink`, a registry like `kernel.authorizer`

The kernel declares the registry `kernel.auditSink` (ADR-0005's pattern); `core.audit` contributes the one entry
`{ record(entry) }`; two contributors fail the start, as for the authoriser. The kernel exposes it twice: as `kernel.audit` for the
pipeline and as `ctx.audit(entry)` for every module. Without an entry both are a function that resolves and does nothing, so a profile
without `core.audit` starts and runs (a test starts such a kernel and the HTTP app on it). Modules do not import `core.audit`, and
`core.audit` has no service for other modules (`public.ts` is empty): the way in is the port.

`AuditEntry` is plain data: `action`, `outcome` (`ok`, `denied`, `error`), `source`, an actor
(`user`, `token`, `anonymous` or `system`, with the user id and token id when there are any), the request facts, a subject, and the raw
`query`, `body` and `payload`. The kernel carries it; **the sink alone decides what is stored.** Redaction and the size limit are in one
place (`core.audit`), so a service's `ctx.audit(entry)` and the pipeline's entry cannot disagree.

### 2. Failure: the pipeline never fails a request; a service call fails with its change

The two callers have opposite needs.

- **The pipeline** writes the entry after the handler has returned and the response is formed, with a 2 s limit. If the write fails or
  times out, the failure is logged with the **request id and the SQLSTATE code only** (a driver message can quote the row it refused)
  and the response is sent as it was. A test drops the table and checks the response, the log line and that nothing else leaks.
  The write is awaited, not fire-and-forget: a lost entry is then a logged event and not a race, and a test can rely on the entry being
  there when the response arrives. The price is one insert of latency on the few routes that opt in.
- **`ctx.audit` in a service** joins the caller's `ctx.db.tx()` (the sink inserts through `activeTransaction()`), so the entry commits or
  rolls back with the change, and a failure rejects the call: the change does not happen without its trail. Two entries of one
  transaction roll back together (a test).

### 3. Who the actor is, where the address comes from, what a query string means

- **Actor.** The actor is what the authentication step resolved. A session is `user`; a personal access token is `token` with the
  owner's user id and the token's id (never the token); a request without credentials, **and one whose credentials were refused (401)**,
  is `anonymous` with no user id: the pipeline has no trustworthy name for a caller whose credentials failed, and writing the claimed one
  would let an attacker put a victim's name in the log. A denied request (403) has a known actor and is recorded with it. An event with
  no actor in its payload is `system`. `UserActor` gained an optional `tokenId` for this. Ids are kept as written, with no foreign key,
  also after the account is purged.
- **Address.** The pipeline's existing rule: `createClientIpResolver(TRUSTED_PROXIES)`. `X-Forwarded-For` counts only when the peer is a
  trusted proxy, and is read from the right. No second rule. The sink stores the address only when `net.isIP` accepts it, so the later
  cut cannot hit a value the database refuses. After `ipTruncateAfterDays` (30) the retention job cuts it to a network prefix (/24 for
  IPv4, /48 for IPv6).
- **Query strings.** Never stored unless the route opted in with `body: true` (the option covers the body **and** the query, which is how
  filters of an export end up on the record). The route template is stored, never the concrete URL; the last path parameter is the
  subject id (`/users/{id}/approve` → subject `users`, the id).

### 4. What a route may ask to be stored, and what is redacted

`createRoute({ audit })` takes `boolean | { body?: boolean; redact?: string[] }`. `true` records who, what and the outcome of every call,
**including 401, 403, 429 and 422**, with no body and no query. `body: true` adds the redacted body and query. A route under `/auth/`
**cannot** ask for it: registration fails (`checkRouteAudit`, unit-tested), and the pipeline ignores the flag too.

The sink replaces the value of a key by `[redacted]` at any depth, in objects and arrays, when the key, lower-cased and reduced to letters
and digits, equals **or ends with** `password`, `token`, `secret`, `authorization`, `apikey`, `code` or `value`, or one of the route's
`redact` names. So `newPassword`, `csrfToken`, `x-api-key` and `clientSecret` are caught, while `values` and `tokenId` are not.
It is a name rule, not a content scan: a secret under an innocent key is not recognised (backlog). A body that is not JSON, or JSON that
does not parse, is **described, never copied** (`[non-JSON body, 12 bytes]`); a body over 256 KB is not read. Strings are made valid for
`jsonb` (U+0000 and lone surrogates are replaced): a refused insert would be a gap in the trail that an attacker could cause.
The stored JSON of `query`, `body` and `payload` is each capped at 8 KB; past it a stand-in `{ "_truncated": true, "preview": … }` is stored
(the preview is cut after redaction) and `truncated` is set. Nesting deeper than 12 levels is replaced.

Events are stored by the subscriber with the same walk, but without `code` and `value` in the list (an event carries an error code, never
a user's value), and **without `username`**: the id is enough, and a name cannot be erased from an append-only table when the account is
purged (ADR-0013).

### 5. The audit decision for every declared event

`service/decisions.ts` holds a decision for every event that a module in the profile declares: **logged** (with who the actor is, what the
subject is, and whether it is _critical_) or **skipped with a reason**. Critical events (role, role-permission, approval, rejection, token,
settings, secret, password and sign-in-method changes, the first administrator, a purge) are logged whatever the `channels` setting says;
the others follow `channels.admin`. The only skipped event today is `settings.preference.changed@1` (a person's own preference).
A test builds the real composition of the dependencies and fails when a declared event has no decision, when a decision names an event
no module declares, when a skipped event has no reason, and when a logged one has no subscription. A second test fails when a declared
event schema has a field named like a secret or is not strict (so a secret cannot ride along).

`core.notifications` is an **optional peer** (Decision 2 of the plan). The module subscribes to its three events by name; where the module
is absent, the loader skips those subscriptions (its existing rule for an optional dependency), and the audit module is ordered after
notifications when both are there. Today `core.identity` requires notifications, so every profile with `core.audit` has it; the peer
states that the trail records notifications' events when they exist and does not force the module on a profile. A module added by a later
milestone declares events and gets a failing test until somebody decides; `core.audit` then lists that module as an optional peer.
`core.settings`' three events gained `actorId` (additive; a seed and the CLI are `null`), because "who changed the setting" is what the
trail is for.

### 6. Append-only, the retention flag, and the cut of the address

`audit_event` has a `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` trigger (migration `0001_append_only.sql`).
Everything raises `42501` except, **only when the transaction-local setting `scorpion.audit_maintenance` is `on`**:

- `DELETE`: any row, for retention;
- `UPDATE` where `to_jsonb(NEW) - 'ip' = to_jsonb(OLD) - 'ip'`: the one write that changes **only the `ip` column**, for the cut.

The retention job sets the flag with `set_config('scorpion.audit_maintenance', 'on', true)`, which is `SET LOCAL`: it ends with the
transaction, so it cannot stay on for a pooled connection. Each batch of 1000 rows is its own transaction. A test shows that every
other statement is refused, that the flag with another value does nothing, that the flag allows nothing but an `ip` change, and that
it is gone after the commit. This guards against bugs and a compromised application path. **A database superuser can drop the
trigger**; the trail is not tamper-evident against whoever owns the database (hash chains are in the backlog).

The module's own writes (an export, a requeue) go through the same insert; there is no `update` anywhere in `core.audit` except the
`ip` cut in `retention.ts`.

### 7. Reading the trail

Reading needs `core.audit.read` (list and one entry) or `core.audit.export` and nothing else; the permission is checked in the route and
again in the service. The three read routes are themselves `audit: true` (who looked, not what for: no filters are stored for the list;
the export route stores its filters, because the filters are what was exported). There is no route that writes or deletes the trail
(a test walks the route table).

## Consequences

- A profile without `core.audit` pays nothing: no table, no route, a function that returns.
- The pipeline's entry and the event's row are two rows for one action (`api.POST /users/{id}/approve` and
  `identity.user.approved@1`). The first has the caller's address and the outcome of the request; the second has the domain facts and
  is atomic with the change. That is intended; the viewer can filter on `source`.
- Reads of the log are in the log. A busy viewer fills the table; sampling is in the backlog.
- An attacker who can make the database refuse an insert could hide a request-log entry; the entry is lost but the failure is logged by
  request id, and the event rows (atomic with the change) are not affected.
