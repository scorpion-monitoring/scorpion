import { describe, expect, it } from 'vitest';
import { createWizard } from './wizard.ts';

const steps = ['one', 'two', 'three'];

describe('createWizard', () => {
  it('starts at the first step and moves on when the step is fine', async () => {
    const wizard = createWizard({ steps });
    expect(wizard.state()).toMatchObject({ index: 0, reached: 0, finished: false });
    expect(await wizard.next()).toBe(true);
    expect(wizard.state()).toMatchObject({ index: 1, reached: 1 });
  });

  it('stays on a step that has problems and says what they are', async () => {
    const wizard = createWizard({
      steps,
      validate: (id) => (id === 'two' ? ['Name is needed'] : undefined),
    });
    await wizard.next();
    expect(await wizard.next()).toBe(false);
    expect(wizard.state()).toMatchObject({ index: 1, problems: ['Name is needed'] });
  });

  it('waits for an asynchronous check', async () => {
    const wizard = createWizard({
      steps,
      validate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ['late'];
      },
    });
    expect(await wizard.next()).toBe(false);
    expect(wizard.state().problems).toEqual(['late']);
  });

  it('finishes at the last step once it validates, and not before', async () => {
    let ok = false;
    const wizard = createWizard({ steps, validate: (id) => (id === 'three' && !ok ? ['no'] : []) });
    await wizard.next();
    await wizard.next();
    expect(await wizard.next()).toBe(false);
    expect(wizard.state().finished).toBe(false);
    ok = true;
    expect(await wizard.next()).toBe(true);
    expect(wizard.state()).toMatchObject({ index: 2, finished: true });
  });

  it('goes back at any time, keeps how far the person got, and clears the problems', async () => {
    const wizard = createWizard({ steps });
    await wizard.next();
    await wizard.next();
    wizard.back();
    expect(wizard.state()).toMatchObject({ index: 1, reached: 2, problems: [] });
    wizard.back();
    wizard.back();
    expect(wizard.state().index).toBe(0);
  });

  it.each([
    [0, true],
    [1, true],
    [2, true],
    [3, false],
    [-1, false],
    [1.5, false],
  ])('after two steps, opening step %f gives %s', async (target, expected) => {
    const wizard = createWizard({ steps });
    await wizard.next();
    await wizard.next();
    wizard.back();
    expect(await wizard.goTo(target)).toBe(expected);
  });

  it('opens the next step through the progress list only after validating, and no step further', async () => {
    const wizard = createWizard({ steps, validate: (id) => (id === 'one' ? ['fix'] : []) });
    expect(await wizard.goTo(2)).toBe(false);
    expect(await wizard.goTo(1)).toBe(false);
    expect(wizard.state().problems).toEqual(['fix']);
  });
});
