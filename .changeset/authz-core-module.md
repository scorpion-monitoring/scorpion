---
'scorpion': minor
---

Add the `core.authz` module to the `full` and `kpi-tracker` profiles. It stores roles as data (Admin, Reviewer
and User are created at start-up) and replaces the deny-everything default for routes that need a permission. Admin
holds every permission that a loaded module declares; other roles hold the permissions stored for them, and a stored
permission that no loaded module declares is logged and never granted. Nobody can change their own roles, approve their own
request or remove the last Admin. A new migration creates the `authz_` tables; there is nothing to configure.

What you will notice: a signed-in user still gets 403 on every route that is not public, because `core.identity`
does not assign roles yet (the next release does), and a request without credentials to such a route now gets 401
instead of 403. Role changes reach other server processes within 5 seconds. Modules can read the permissions that the
loaded manifests declare as `ctx.permissions`.
