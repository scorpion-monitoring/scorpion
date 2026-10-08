# ADR-0028: The live inbox count is a server-sent event stream

- Status: Accepted
- Date: 2026-10-08

## Context

The header shows how many inbox items a person has not read. M5 plan, Decision 9 (2026-10-05) chose server-sent events over polling
every 60 seconds. A long-lived response is new for this server: it holds a connection, it outlives the authentication made when it
opened, and it passes through a proxy (the web process of ADR-0027) and possibly another one in front of that. This ADR records how
it is kept small and safe.

## Decision

1. **`GET /inbox/stream`** in `core.notifications`, permission `core.notifications.inbox.read`, `text/event-stream`. Session cookie or
   an access token with that scope (EventSource in a browser sends the cookie; a script may send a token).
2. **Only counts.** `event: unread` with `{"count": n}` when the stream opens and whenever the number changes, a comment line
   `: heartbeat` every 25 seconds, and one `retry:` hint. Never the title, text, link or id of an item, never an address: the page
   fetches the list through the ordinary route (which checks the caller) when the number says something changed. Event ids are not
   sent and `Last-Event-ID` is ignored: a client that reconnects gets the current count, so nothing is replayed and nothing is stored
   for it.
3. **Whose stream.** The request has no user id. The stream is the caller's own, so there is no other person's stream to open; a
   user id in the address is ignored. Opening needs the permission twice (the route, then the service).
4. **Caps.** At most `inboxStream.perUser` streams per person (default 3, one per tab) and `inboxStream.global` per server process
   (default 200), settings of `core.notifications`. Over a cap the answer is 429 problem+json with `Retry-After: 30`. The check and
   the registration have no `await` between them, so parallel requests cannot pass the cap together.
5. **It ends when the caller is no longer good.** Every heartbeat the stream asks the authentication step again, with the credentials
   of the original request (`recheckActor`, set by the pipeline), and whether the person still holds the permission. The same
   session or token must come back; anything else, including an error, ends the stream. A logout, a revoked or expired session, a
   revoked token, a deactivated account or a lost role therefore closes it within one heartbeat (plus the short caches of the
   session and permission services, 5 seconds). The re-check is **passive** (`AuthenticationRequest.passive`): it does not slide
   the inactivity end of a session, so an open tab is not "activity". The module closes every stream when it stops.
6. **Changes travel through the database.** A change of an inbox (an item is written, read, deleted) calls `pg_notify('notify_inbox',
<user id>)` in the same transaction, so a rollback announces nothing and a commit does. Each process listens on the connection it
   already holds for delivery wake-ups, and the streams of that person read the count again (changes within 100 ms are one event).
   A wake-up that is lost (the listener reconnecting) is made up at the next heartbeat, which re-reads the count. So a message
   queued by one process reaches a stream held by another.
7. **Proxies.** The response says `Cache-Control: no-store` and `X-Accel-Buffering: no`. The web process passes it on without
   buffering (ADR-0027) and exempts `text/event-stream` from `API_TIMEOUT_MS`; the 25 second heartbeat is under the idle limits of
   usual reverse proxies (30 to 60 seconds). An operator who fronts the instance with another proxy must not buffer it.
8. **The page falls back to polling.** If the stream cannot be opened (429, a proxy that cuts it, an old browser) or breaks, the
   bell asks `GET /notifications/inbox/unread-count` every 60 seconds, and tries the stream again after five minutes. The bell
   works without the stream; the stream only makes it faster.

## Consequences

- One more Postgres connection is not needed (the wake-up listener listens on a second channel).
- A server process holds up to `inboxStream.global` open connections; Node handles that, and a deployment that wants more raises the
  setting and the file-descriptor limit together.
- A person with more tabs than `perUser` sees the extra tabs poll. That is the intended degradation.
- Revocation in another process is bounded by the session cache time (5 s) plus one heartbeat, the same staleness bound as every
  other request (ADR-0007).
- The pipeline gained `recheckActor` and the authenticator a `passive` flag: a general mechanism for any response that outlives its
  request. It is in an ASVS-scoped path, so V7 and V8 name it.
