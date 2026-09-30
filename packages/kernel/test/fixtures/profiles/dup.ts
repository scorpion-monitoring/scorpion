import type { Profile } from '@scorpion/kernel';

// Fixture profile: Two modules that declare the same permission.
const profile: Profile = {
  name: 'fixture-dup',
  modules: ['fixture.dup', 'fixture.dup.inner'],
};
export default profile;
