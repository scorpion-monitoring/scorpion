import type { Profile } from '@scorpion/kernel';

// Fixture profile: a depends on b; opt is not included.
const profile: Profile = {
  name: 'fixture-ab',
  modules: ['fixture.a', 'fixture.b'],
};
export default profile;
