import type { Profile } from '@scorpion/kernel';

// Fixture profile: A module whose dependency (fixture.b) is left out.
const profile: Profile = {
  name: 'fixture-missing',
  modules: ['fixture.missing'],
};
export default profile;
