// The context a module receives. M1 builds it up in steps; see the kernel README for the full API.

/**
 * Public service objects by module id. Each module's `public.ts` adds its own entry:
 *
 *     declare module '@scorpion/kernel' {
 *       interface ModuleServices { 'kpi.ingestion': IngestionService }
 *     }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleServices {}

export interface ModuleContext<
  Required extends keyof ModuleServices = never,
  Optional extends keyof ModuleServices = never,
> {
  /** The id of the module this context belongs to. */
  readonly moduleId: string;
  /**
   * Public services of the required dependencies, and of optional ones that are present (else
   * `undefined`). Any other module id throws: nothing else is reachable.
   */
  readonly deps: { readonly [K in Required]: ModuleServices[K] } & {
    readonly [K in Optional]?: ModuleServices[K];
  };
  /** Validated entries of a registry declared by this module or one of its dependencies. */
  registry(name: string): readonly unknown[];
}
