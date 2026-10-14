import { type StartedPostgres } from '@scorpion/testing';
export declare const ADMIN: {
    username: string;
    email: string;
    password: string;
};
export interface StackSpec {
    name: string;
    basePath: string;
    webPort: number;
    apiPort: number;
    /**
     * `false`: a fresh install with no administrator, for the first-admin form (the one-time token is
     * printed on the API's standard error, which the log of the stack keeps). Default `true`: the
     * administrator `ADMIN` exists, as for every other journey.
     */
    admin?: boolean;
    /** The spec files of the project (default: every spec except those that need a fresh install). */
    testMatch?: string;
}
export interface Stack extends StackSpec {
    origin: string;
    /** The connection string of the stack's own database, for a test that reads a mail or ages a session. */
    databaseUrl: string;
    /** Everything the two processes wrote, for a failing test. */
    logs: () => string;
    stop: () => Promise<void>;
}
/** The stacks the projects of `playwright.config.ts` use. */
export declare const SPECS: StackSpec[];
/** The spec that needs a fresh install; every other spec runs on the stacks that have an administrator. */
export declare const FRESH_SPEC = "bootstrap.spec.ts";
export declare function startStack(spec: StackSpec, database: StartedPostgres): Promise<Stack>;
/**
 * Starts the stacks of `SPECS`, or only those named in `only` (`E2E_STACKS`, see `scripts/e2e-parallel.ts`: two runs,
 * one per base path, each with its own database and its own ports, which `SPECS` already keeps apart).
 */
export declare function startAll(only?: readonly string[]): Promise<{
    stacks: Stack[];
    stop: () => Promise<void>;
}>;
