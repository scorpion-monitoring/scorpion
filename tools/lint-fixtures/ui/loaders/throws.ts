// The way a loader reports a failure: it throws.
export const load = () => {
  throw new Error('The token is missing.');
};
