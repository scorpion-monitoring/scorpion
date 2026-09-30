import { defineModule } from '@scorpion/kernel';
import type { OptService } from './public.ts';

// Fixture: an optional dependency of fixture.a.
export default defineModule<OptService>({
  id: 'fixture.opt',
  version: '1.0.0',
  services: () => ({ hello: () => 'opt' }),
});
