import type { Profile } from '@scorpion/kernel';

// Fixture profile: Contributes to a registry without depending on its owner.
const profile: Profile = {
  name: 'fixture-foreign-contrib',
  modules: ['fixture.b', 'fixture.foreign-contrib'],
};
export default profile;
