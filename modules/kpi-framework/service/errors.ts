import { DomainError } from '@scorpion/contracts';

/** 409: another row has this name or slug (without regard to case). The problem names the field only. */
export class Duplicate extends DomainError {
  constructor(what: 'indicator' | 'KPI set', field: 'name' | 'slug') {
    super(409, 'Conflict', `A ${what} with this ${field} already exists.`, [
      { in: 'body', path: field, message: `This ${field} is already taken.` },
    ]);
  }
}

/** The problem type of {@link InUse}. */
export const IN_USE = 'kpi-in-use';

/** One place that still refers to a row: a module, what it holds, and how many. */
export interface Use {
  module: string;
  /** `sets`, `evaluations` or (sprint 3) `services`. */
  what: string;
  count: number;
}

/**
 * 409: something still refers to the row, so it is not deleted. The problem names each module and the count
 * and never a row: the detail says it in words, `errors` gives each as `usage` / `<module>.<what>` / count.
 */
export class InUse extends DomainError {
  readonly uses: readonly Use[];
  constructor(what: 'indicator' | 'KPI set', uses: readonly Use[]) {
    super(
      409,
      'Conflict',
      `The ${what} is still in use by: ${uses
        .map((use) => `${use.module} (${use.count} ${use.what})`)
        .join(', ')}.`,
      uses.map((use) => ({
        in: 'usage',
        path: `${use.module}.${use.what}`,
        message: String(use.count),
      })),
      IN_USE,
    );
    this.uses = uses;
  }
}
