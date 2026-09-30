import { defineModule } from '@scorpion/kernel';
import { z } from 'zod';
import type { ThingService } from './public.ts';

// Fixture: the dependency of fixture.a. Declares a registry and emits an event.
export default defineModule<ThingService>({
  id: 'fixture.b',
  version: '1.0.0',
  permissions: {
    'fixture.b.write': { scope: 'global', description: 'Write things' },
  },
  registries: {
    'fixture.widget': z.strictObject({ label: z.string().min(1) }),
  },
  events: {
    emits: { 'fixture.thing.created@1': z.strictObject({ thingId: z.string() }) },
  },
  services: () => ({ name: () => 'b' }),
});
