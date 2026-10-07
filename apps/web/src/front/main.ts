// `node apps/web/src/front/main.ts`: the web process of an image (ADR-0027). It runs the SvelteKit build
// (`apps/web/build`, adapter-node) behind the front. Configuration comes from the environment:
// PORT (default 3000), BASE_PATH (default `/`), API_ORIGIN (default `http://127.0.0.1:3001`), and the
// ORIGIN, PROTOCOL_HEADER and HOST_HEADER variables that adapter-node reads.
import http from 'node:http';
import { createFront } from './front.ts';

// The path is built so that no bundler or type checker looks for the build at lint time.
const handlerFile = new URL('../../build/handler.js', import.meta.url).href;
const { handler } = (await import(handlerFile)) as {
  handler: Parameters<typeof createFront>[0]['next'];
};

const port = Number(process.env.PORT ?? 3000);
const server = http.createServer(
  createFront({
    basePath: process.env.BASE_PATH ?? '/',
    apiOrigin: process.env.API_ORIGIN ?? 'http://127.0.0.1:3001',
    next: handler,
  }),
);
// An event stream is idle between heartbeats; only the headers have a time limit.
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;
server.listen(port, () => console.log(`web: listening on ${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
