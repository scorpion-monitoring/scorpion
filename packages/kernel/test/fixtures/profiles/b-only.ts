import type { Profile } from '@scorpion/kernel';

// Fixture profile: Only b: used to show that an image holds no other module.
const profile: Profile = {
  name: 'fixture-b-only',
  modules: ['fixture.b'],
};
export default profile;
