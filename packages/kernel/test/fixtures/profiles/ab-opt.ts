import type { Profile } from '@scorpion/kernel';

// Fixture profile: a, b and the optional dependency opt.
const profile: Profile = {
  name: 'fixture-ab-opt',
  modules: ['fixture.a', 'fixture.b', 'fixture.opt'],
};
export default profile;
