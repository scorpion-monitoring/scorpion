import { moduleBoundaries } from './module-boundaries.js';

/** Local ESLint rules for the Scorpion repository. */
const plugin = {
  meta: { name: '@scorpion/eslint-plugin' },
  rules: {
    'module-boundaries': moduleBoundaries,
  },
};

export default plugin;
