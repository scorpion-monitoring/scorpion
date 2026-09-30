import { createRoute } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';

// Broken fixture: registers a route that names no permission and is not public.
const unprotected = createRoute(
  // @ts-expect-error a route needs `permission` or `public: true`; the types stop it, so this fixture bypasses them
  {
    method: 'get',
    path: '/unprotected',
    responses: { 200: { description: 'Anyone would get in.' } },
  },
);

export default defineModule({
  id: 'fixture.no-permission',
  version: '1.0.0',
  routes: (r) => {
    r.internal(unprotected, (c) => c.text('open'));
  },
});
