import { serve } from '@hono/node-server';
import { createLogger, denyByDefault, loadConfig } from '@scorpion/kernel';
import { createApp } from './app.ts';

// Interim entry point: the request pipeline without the kernel. The ops pull request replaces it
// with the full start-up (config, migrations, modules, workers, /readyz, /metrics).
const config = loadConfig({ DATABASE_URL: 'postgres://unused@localhost/unused', ...process.env });
const log = createLogger({ level: config.LOG_LEVEL });

const app = createApp({ config, log, routes: [], authorizer: denyByDefault });
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  log.info(
    { port: info.port, profile: config.PROFILE, basePath: config.BASE_PATH },
    'scorpion server listening',
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
