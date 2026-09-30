import { Hono } from 'hono';

export interface AppOptions {
  /** Name of the deployment profile this server was built for. */
  profile: string;
}

// M0: only the liveness probe. The kernel, request pipeline and all other routes arrive in M1.
export function createApp({ profile }: AppOptions): Hono {
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ status: 'ok', profile }));
  return app;
}
