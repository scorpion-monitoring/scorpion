import { defineModule } from '@scorpion/kernel';

// Broken fixture: depends on fixture.b, which the profile leaves out.
export default defineModule({ id: 'fixture.missing', version: '1.0.0' });
