// Development only: `pnpm db:studio` opens Drizzle Studio on the local database with every module's tables.
// Migrations are not generated from this file (`pnpm db:generate --filter <package>` does that per module),
// and it is in no profile and in no image. The glob lists the schema of the kernel and of every module;
// `scripts/drizzle-config.test.ts` fails when a module with a `db/schema.ts` is missing from it.
import { defineConfig } from 'drizzle-kit';

const SCHEMA_FILES = ['packages/kernel/src/db/schema.ts', 'modules/*/db/schema.ts'];

export default defineConfig({
  dialect: 'postgresql',
  schema: SCHEMA_FILES,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://scorpion:scorpion@localhost:5432/scorpion',
  },
});
