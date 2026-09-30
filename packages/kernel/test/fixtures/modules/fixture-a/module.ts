import { defineModule } from '@scorpion/kernel';
import type { AService } from './public.ts';

// Fixture: depends on fixture.b, optionally on fixture.opt. Contributes a widget to b's registry
// and subscribes to b's event.
export default defineModule<AService, 'fixture.b', 'fixture.opt'>({
  id: 'fixture.a',
  version: '1.0.0',
  permissions: {
    'fixture.a.read': { scope: 'global', description: 'Read things' },
  },
  contributes: {
    'fixture.widget': [{ label: 'from a' }],
  },
  events: {
    on: {
      'fixture.thing.created@1': async () => {},
    },
  },
  services: (ctx) => ({
    describe: () =>
      `a+${ctx.deps['fixture.b'].name()}+${ctx.deps['fixture.opt']?.hello() ?? 'none'}`,
  }),
});
