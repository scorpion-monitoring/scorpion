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

  it('reopens any step after a failure found at the end, and is no longer finished', async () => {
    const wizard = createWizard({ steps });
    await wizard.next();
    await wizard.next();
    await wizard.next();
    expect(wizard.state().finished).toBe(true);
    expect(wizard.reopen(0)).toBe(true);
    expect(wizard.state()).toMatchObject({ index: 0, reached: 2, finished: false, problems: [] });
    expect(wizard.reopen(3)).toBe(false);
    expect(wizard.reopen(-1)).toBe(false);
  });

  describe('with a list of steps that changes', () => {
    it('shows a step only while it applies, and keeps the person on the step they are on', async () => {
      let list = ['one', 'two', 'three'];
      const wizard = createWizard({ steps: () => list });
      await wizard.next();
      // A step before the current one appears: the person is still on `two`, now at index 2.
      list = ['zero', 'one', 'two', 'three'];
      expect(wizard.state()).toMatchObject({ index: 2 });
      expect(wizard.state().reached).toBe(2);
      // A step that appeared behind them can be opened (backwards is always allowed); one ahead is not
      // open until they get there.
      list = ['zero', 'one', 'two', 'three', 'four'];
      expect(await wizard.goTo(4)).toBe(false);
      expect(await wizard.goTo(0)).toBe(true);
    });

    it('stays at the same place when the current step goes away, and clamps at the end', async () => {
      let list = ['one', 'two', 'three'];
      const wizard = createWizard({ steps: () => list });
      await wizard.next();
      list = ['one', 'three'];
      expect(wizard.state().index).toBe(1);
      list = ['one'];
      expect(wizard.state().index).toBe(0);
    });

    it('finishes at the last step of the list as it is when the check is done', async () => {
      let list = ['one', 'two'];
      const wizard = createWizard({
        steps: () => list,
        validate: (id) => {
          // Answering on `one` removes `two`: `one` becomes the last step.
          if (id === 'one') list = ['one'];
          return [];
        },
      });
      expect(await wizard.next()).toBe(true);
      expect(wizard.state()).toMatchObject({ index: 0, finished: true });
    });
  });
});
