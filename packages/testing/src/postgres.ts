import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

export const POSTGRES_IMAGE = 'postgres:16.15-alpine';

export interface StartedPostgres {
  /** Connection URL, e.g. `postgres://user:pass@127.0.0.1:32768/db`. */
  url: string;
  /**
   * Creates an empty database next to the default one and returns its URL. Tests that share a
   * container use one each, so they do not see each other's tables.
   */
  createDatabase: () => Promise<string>;
  stop: () => Promise<void>;
}

/** Starts a throwaway PostgreSQL 16 container. Needs a running Docker daemon. */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const url = container.getConnectionUri();
  let counter = 0;
  return {
    url,
    createDatabase: async () => {
      const name = `test_${process.pid}_${Date.now()}_${counter++}`;
      const admin = new pg.Client({ connectionString: url });
      await admin.connect();
      try {
        await admin.query(`create database "${name}"`);
      } finally {
        await admin.end();
      }
      const created = new URL(url);
      created.pathname = `/${name}`;
      return created.toString();
    },
    stop: async () => {
      await container.stop();
    },
  };
}
