import { defineModule } from '@scorpion/kernel';

// Broken fixture: declares a permission that fixture.dup.inner owns and also declares.
export default defineModule({
  id: 'fixture.dup',
  version: '1.0.0',
  // Nested module ids would otherwise share a table prefix.
  tablePrefix: 'fixture_outer_',
  permissions: { 'fixture.dup.inner.use': { description: 'Clashes with fixture.dup.inner' } },
});
