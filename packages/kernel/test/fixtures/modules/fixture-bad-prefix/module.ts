import { defineModule } from '@scorpion/kernel';

// Broken fixture: its migration creates a table without the module's prefix.
export default defineModule({
  id: 'fixture.bad-prefix',
  version: '1.0.0',
  schema: () => import('./db/schema.ts'),
  migrations: new URL('./migrations', import.meta.url),
});
