import { defineModule } from '@scorpion/kernel';

// Broken fixture: see fixture.dup.
export default defineModule({
  id: 'fixture.dup.inner',
  version: '1.0.0',
  permissions: { 'fixture.dup.inner.use': { description: 'Use it' } },
});
