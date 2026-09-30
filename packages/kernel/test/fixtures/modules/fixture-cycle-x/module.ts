import { defineModule } from '@scorpion/kernel';

// Broken fixture: depends on fixture.cycle-y, which depends back on this module.
export default defineModule({ id: 'fixture.cycle-x', version: '1.0.0' });
