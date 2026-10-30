# ADR-0045: The About page and `ctx.instance`

- Status: Accepted
- Date: 2026-10-30

## Context

A signed-in person can only guess the profile of an instance from the navigation. The knowledge base (issue #136, request R5) needs a page
that names the profile, the Scorpion version and the active modules, so that "Which modules does my instance have?" can point to it. The
kernel knows all three, but a module could not read them: `ctx` offered the permissions, settings schemas and routes, not the profile.

## Decision

1. **`ctx.instance`** is a new read-only member of the module context: `{ profile, version, modules }`, where each module has `id`,
   `displayName`, `version` and `kind` (`core` for ids that start with `core.`, else `optional`). The kernel builds it from the resolved
   profile; the server passes the product `version`, read from the root `package.json` (`apps/server/src/version.ts`; the image carries it,
   `scripts/image-tree.ts`), and the kernel says `unknown` when it is not given one. No other module is imported and no `public.ts` entry
   is added: this is the existing context, as `ctx.permissions` is.
2. **`displayName`** is a new optional manifest field (1 to 60 characters; the id when absent). Every module of the workspace sets it. It
   is the name the docs export (R1) will use too.
3. **Who may see the page.** The page `/about` and the route `GET /ui/about` need the permission `core.ui-shell.about.read`, which the
   role `user` holds by default (`authz.defaultRole`), so **every signed-in person** sees it and a visitor does not. Navigation already
   shows a signed-in person the modules' pages, so the module list adds little; the page is not public because the module list and
   versions are what an attacker would use to choose an exploit, and a visitor has no need for it. An administrator can take the
   permission from a role.
4. **What it may show:** the profile name, the Scorpion version, and for each module its id, display name and own version. It shows no
   setting, no environment value, no secret and no version of a dependency; a test checks that the response has exactly these keys.
5. The service checks the permission as well as the route (`ctx.authz.require`), as the dashboard does.

## Consequences

- A module that wants to know whether another module is loaded can read `ctx.instance.modules`, but the loader's dependency rules still
  decide what it may import.
- The docs export (R1) reads `displayName` from the manifests.
- The route `GET /ui/about` is internal (not part of the public API v1), so the OpenAPI diff of v1 is unchanged.
