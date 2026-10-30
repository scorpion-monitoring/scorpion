---
'scorpion': minor
---

New page "About" (`/about`, in the main navigation) for every signed-in person: it names the profile of the instance, the Scorpion version and the loaded modules with their version, split into core and optional modules. It needs the new permission `core.ui-shell.about.read`, which the role `user` holds by default; an administrator can take it from a role. The internal route is `GET /api/internal/ui/about`. Modules may now set an optional `displayName` in their manifest.
