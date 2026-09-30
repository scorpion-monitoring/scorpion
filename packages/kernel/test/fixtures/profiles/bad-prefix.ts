import type { Profile } from '@scorpion/kernel';

// Fixture profile: a module whose migration creates a table without its prefix.
const profile: Profile = {
  name: 'fixture-bad-prefix',
  modules: ['fixture.bad-prefix'],
};
export default profile;
