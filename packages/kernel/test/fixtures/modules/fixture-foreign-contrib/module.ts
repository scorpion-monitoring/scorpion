import { defineModule } from '@scorpion/kernel';

// Broken fixture: contributes to fixture.b's registry without depending on fixture.b.
export default defineModule({
  id: 'fixture.foreign-contrib',
  version: '1.0.0',
  contributes: { 'fixture.widget': [{ label: 'not allowed' }] },
});
