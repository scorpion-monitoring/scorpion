---
'scorpion': minor
---

core.identity now turns a `__Host-session` cookie into the signed-in user on every API call. The cookie is `Secure`, `HttpOnly` and `SameSite=Lax`, a session lasts 7 days from its last use, and the server stores only a hash of its id. Cookie-authenticated writes (anything but GET, HEAD and OPTIONS) must also send an `X-CSRF-Token` header (ADR-0007). With several server processes, a session that was revoked can still be accepted by another process for up to 5 seconds. There are no sign-in routes yet; they follow in the next change, so nothing changes for operators until then.
