// The steps of a `Wizard` as a small state machine. It knows which step is shown, how far the person has
// got, and whether they may move: backwards at any time, forwards only after the step they leave
// validates. It holds no form state: the page owns that, so it survives a move between steps.
export type StepProblems = readonly string[] | undefined | void;

export interface WizardOptions {
  /** The step ids, in order. */
  steps: readonly string[];
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
}

export function createWizard({ steps, validate }: WizardOptions): Wizard {
  let state: WizardState = { index: 0, reached: 0, problems: [], finished: false };

  async function problemsOf(index: number): Promise<string[]> {
    const found = await validate?.(steps[index]!, index);
    return found ? [...found] : [];
  }

  async function advance(): Promise<boolean> {
    const problems = await problemsOf(state.index);
    if (problems.length > 0) {
      state = { ...state, problems };
      return false;
    }
    if (state.index === steps.length - 1) {
      state = { ...state, problems: [], finished: true };
      return true;
    }
    const index = state.index + 1;
    state = { ...state, index, reached: Math.max(state.reached, index), problems: [] };
    return true;
  }

  return {
    state: () => state,
    next: advance,
    back() {
      if (state.index > 0)
        state = { ...state, index: state.index - 1, problems: [], finished: false };
    },
    async goTo(index) {
      if (!Number.isInteger(index) || index < 0 || index >= steps.length) return false;
      if (index === state.index) return true;
      if (index < state.index || index <= state.reached) {
        state = { ...state, index, problems: [], finished: false };
        return true;
      }
      return index === state.index + 1 ? advance() : false;
    },
  };
}
