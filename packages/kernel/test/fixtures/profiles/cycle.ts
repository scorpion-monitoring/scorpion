import type { Profile } from '@scorpion/kernel';

// Fixture profile: Two modules that depend on each other.
const profile: Profile = {
  name: 'fixture-cycle',
  modules: ['fixture.cycle-x', 'fixture.cycle-y'],
};
export default profile;
