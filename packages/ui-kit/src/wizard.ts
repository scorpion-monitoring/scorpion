// The steps of a `Wizard` as a small state machine. It knows which step is shown, how far the person has
// got, and whether they may move: backwards at any time, forwards only after the step they leave
// validates. It holds no form state: the page owns that, so it survives a move between steps.
//
// The list of steps may change while the wizard is open (a step that applies only to some answers): give
// `steps` as a function. The machine follows the step the person is on by its id; when that step goes away
// it stays at the same place in the list. A step is "reached" by its id too, so a step that appears later
// is not open until the person gets to it.
export type StepProblems = readonly string[] | undefined | void;

export interface WizardOptions {
  /** The step ids, in order; or a function that gives them (asked again at every move and every `state()`). */
  steps: readonly string[] | (() => readonly string[]);
  /** The problems of a step (empty or nothing means it is fine). Runs when the person moves on. */
  validate?: (stepId: string, index: number) => StepProblems | Promise<StepProblems>;
}

export interface WizardState {
  index: number;
  /** The furthest step the person has reached; a step up to it can be opened again from the progress list. */
  reached: number;
  problems: string[];
  finished: boolean;
}

export interface Wizard {
  state(): WizardState;
  /** Validates the current step and moves on; returns whether it moved. At the last step it finishes instead. */
  next(): Promise<boolean>;
  back(): void;
  /** Opens a step already reached (or the next one, after validating); returns whether it moved. */
  goTo(index: number): Promise<boolean>;
  /**
   * Opens a step whatever its state and takes the wizard out of "finished": for a failure found only when
   * the whole form is judged (the server, or a check across steps). Returns whether the index is a step.
   */
  reopen(index: number): boolean;
}

export function createWizard({ steps, validate }: WizardOptions): Wizard {
  const ids = (): readonly string[] => (typeof steps === 'function' ? steps() : steps);
  let current = ids()[0] ?? '';
  let lastIndex = 0;
  const reached = new Set<string>(current === '' ? [] : [current]);
  let problems: string[] = [];
  let finished = false;

  /** The index of the current step in today's list; a step that went away keeps its place. */
  function indexNow(list: readonly string[]): number {
    const at = list.indexOf(current);
    const index = at >= 0 ? at : Math.min(lastIndex, Math.max(list.length - 1, 0));
    lastIndex = index;
    current = list[index] ?? current;
    return index;
  }

  function stateNow(): WizardState {
    const list = ids();
    const index = indexNow(list);
    let furthest = index;
    list.forEach((id, position) => {
      if (reached.has(id)) furthest = Math.max(furthest, position);
    });
    return { index, reached: furthest, problems: [...problems], finished };
  }

  function move(list: readonly string[], index: number) {
    current = list[index]!;
    lastIndex = index;
    reached.add(current);
    problems = [];
  }

  async function problemsOf(list: readonly string[], index: number): Promise<string[]> {
    const found = await validate?.(list[index]!, index);
    return found ? [...found] : [];
  }

  async function advance(): Promise<boolean> {
    const list = ids();
    const index = indexNow(list);
    const found = await problemsOf(list, index);
    if (found.length > 0) {
      problems = found;
      return false;
    }
    // The answers may have changed the list while the check ran.
    const after = ids();
    const here = indexNow(after);
    if (here === after.length - 1) {
      problems = [];
      finished = true;
      return true;
    }
    move(after, here + 1);
    return true;
  }

  return {
    state: stateNow,
    next: advance,
    back() {
      const list = ids();
      const index = indexNow(list);
      if (index > 0) {
        move(list, index - 1);
        finished = false;
      }
    },
    async goTo(target) {
      const list = ids();
      const index = indexNow(list);
      if (!Number.isInteger(target) || target < 0 || target >= list.length) return false;
      if (target === index) return true;
      if (target < index || reached.has(list[target]!)) {
        move(list, target);
        finished = false;
        return true;
      }
      return target === index + 1 ? advance() : false;
    },
    reopen(target) {
      const list = ids();
      if (!Number.isInteger(target) || target < 0 || target >= list.length) return false;
      move(list, target);
      finished = false;
      return true;
    },
  };
}
