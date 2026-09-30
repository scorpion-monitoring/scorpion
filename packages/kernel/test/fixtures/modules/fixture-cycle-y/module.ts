import { defineModule } from '@scorpion/kernel';

// Broken fixture: depends on fixture.cycle-x, which depends back on this module.
export default defineModule({ id: 'fixture.cycle-y', version: '1.0.0' });
