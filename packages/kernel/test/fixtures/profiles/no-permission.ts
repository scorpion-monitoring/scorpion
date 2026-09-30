import type { Profile } from '@scorpion/kernel';

// Fixture profile: A module with a route that has no permission.
const profile: Profile = {
  name: 'fixture-no-permission',
  modules: ['fixture.no-permission'],
};
export default profile;
