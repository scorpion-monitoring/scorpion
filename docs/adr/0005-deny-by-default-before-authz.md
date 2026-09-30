# ADR-0005: Deny by default until `core.authz` exists

- Status: Accepted
- Date: 2026-09-30

## Context

Defect 1 (FEATURES §5) is unprotected internal endpoints. The rebuild must not have a window in
which routes exist but nothing checks who calls them. `core.authz` arrives in M3; modules and
routes appear from M2 on. Someone has to say what an unauthorised route does in between.

## Decision

- **A route declares its access or does not register.** `createRoute()` (packages/contracts)
  requires either `permission` or `public: true` with a `publicReason`. When a module registers
  the route (`r.internal(route, handler)`, `r.public('v1', route, handler)`), the kernel checks
  that the permission is one the same module declares, that a public route has a reason, and
  that the method and path are free. A violation stops startup and names the module and the
  route (`fixture.no-permission: GET /unprotected needs a permission (or public: true with a
publicReason)`).
- **The pipeline has an authorisation hook** between input validation and the handler
  (request id → security headers → logging → body limit → validation → **authorisation** →
  handler → error mapper). Validation comes first, as in architecture.md, so a caller never
  learns more from a 403 than from a 422; the handler never runs when the hook throws.
- **The hook is the registry `kernel.authorizer`**, declared by the kernel and open to
  contributions from any module (no dependency on the kernel is needed, because the kernel is not
  a module). An entry is `{ authorize(request) }`; it resolves to allow, or throws `Unauthorized`
  (401) or `Forbidden` (403). `core.authz` contributes the one entry in M3. Two entries stop
  startup.
- **Without an entry, the kernel uses `denyByDefault`**: every non-public route answers 403
  problem+json. A crashing authoriser is a 500 and never lets the request through. Public routes
  skip the hook.
- The service layer checks again for resource-scoped permissions (CLAUDE.md, security rules). That
  is the module's job through `ctx.authz.require()` from M3 on; M1 has no such context member.
- The regression test for defect 1 is named `defect-01.privilege-escalation.test.ts` and is written
  in M3, when the hook is filled. The M1 tests prove the default: every fixture route that is not
  public answers 403, and the handler does not run.

## Consequences

- Until M3, an instance with modules can serve public routes only. That is intended.
- The hook receives the validated Hono context, so `core.identity` (M2) can put the session or PAT
  behind it without a second pipeline.
- Contributing to `kernel.authorizer` is a powerful act: the module list in a profile is the
  trust boundary, as for every other registry.
