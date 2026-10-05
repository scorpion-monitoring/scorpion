// The only file other modules may import. core.audit has no service for other modules: the trail is
// written through the kernel's audit sink (`ctx.audit(entry)`, ADR 0021) and read through its routes.
// The module id is declared so that `ctx.deps['core.audit']` is a known key; it is an empty object.
export type AuditPublic = Record<never, never>;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.audit': AuditPublic;
  }
}
