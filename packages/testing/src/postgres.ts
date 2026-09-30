import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const POSTGRES_IMAGE = 'postgres:16-alpine';

export interface StartedPostgres {
  /** Connection URL, e.g. `postgres://user:pass@127.0.0.1:32768/db`. */
  url: string;
  stop: () => Promise<void>;
}

/** Starts a throwaway PostgreSQL 16 container. Needs a running Docker daemon. */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
