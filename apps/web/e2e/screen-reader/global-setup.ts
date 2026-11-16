import { startHarness } from '../support/harness.ts';

// Only the component harness: the screen-reader runners have no Docker, so no stack.
export default async function globalSetup() {
  const harness = await startHarness();
  return () => harness.stop();
}
