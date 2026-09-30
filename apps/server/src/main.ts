import { serve } from '@hono/node-server';
import { createApp } from './app.ts';

const profile = process.env.PROFILE || 'full';
const port = Number(process.env.PORT || 3000);

const app = createApp({ profile });
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`scorpion server listening on :${info.port} (profile ${profile})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
