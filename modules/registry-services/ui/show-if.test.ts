// The browser's half of `showIf` (ADR-0040 addendum): the same condition the server asks, on the same form, so a field
// or step the server would drop is not drawn, not checked and not sent. Pure functions over the shapes the schema has.
import { describe, expect, it } from 'vitest';
import { fieldShown, showIfHolds, visibleSteps, withoutHidden } from './form-state.ts';
import type { WizardField, WizardStep } from './wizard-types.ts';

const field = (key: string, extra: Partial<WizardField> = {}): WizardField => ({
  key,
  path: `/${key}`,
  type: 'note',
  widget: 'note',
  label: `l.${key}`,
  required: false,
  config: {},
  deferred: false,
  ...extra,
});
const step = (id: string, fields: WizardField[], extra: Partial<WizardStep> = {}): WizardStep => ({
  id,
  order: 1,
  title: id,
  intro: [],
  contributed: true,
  fields,
  schema: {},
  ...extra,
});

describe('showIfHolds', () => {
  it.each([
    [undefined, {}, true],
    [{ path: '/kind', equals: 'a' }, { kind: 'a' }, true],
    [{ path: '/kind', equals: 'a' }, { kind: 'b' }, false],
    [{ path: '/kind', equals: 'a' }, {}, false],
    [{ path: '/kind', oneOf: ['a', 'b'] }, { kind: 'b' }, true],
    [{ path: '/kind', oneOf: ['a', 'b'] }, { kind: 'c' }, false],
    [{ path: '/on', equals: true }, { on: true }, true],
    [{ path: '/contact/type', equals: 'x' }, { contact: { type: 'x' } }, true],
  ])('%j on %j is %s', (condition, form, expected) => {
    expect(showIfHolds(condition, form)).toBe(expected);
  });
});

describe('the steps and fields the form shows', () => {
  const kind = field('kind');
  const detail = field('detail', { showIf: { path: '/kind', equals: 'special' } });
  const hiddenStep = step('more', [field('extra')], {
    showIf: { path: '/kind', oneOf: ['special'] },
  });
  const steps = [step('first', [kind, detail]), hiddenStep];

  it('hides a step whose condition fails, and shows it when it holds', () => {
    expect(visibleSteps(steps, {}, {}).map((s) => s.id)).toEqual(['first']);
    expect(visibleSteps(steps, { kind: 'special' }, {}).map((s) => s.id)).toEqual([
      'first',
      'more',
    ]);
  });

  it('keeps asking `applies` as well: either one can hide a step', () => {
    expect(
      visibleSteps(steps, { kind: 'special' }, { more: () => false }).map((s) => s.id),
    ).toEqual(['first']);
  });

  it('hides a field whose condition fails', () => {
    expect(fieldShown(detail, {})).toBe(false);
    expect(fieldShown(detail, { kind: 'special' })).toBe(true);
    expect(fieldShown(kind, {})).toBe(true);
  });

  it('removes the value of a hidden field and of a field of a hidden step from the body', () => {
    const form = { kind: 'plain', detail: 'stale', extra: 'stale too' };
    expect(withoutHidden(form, { steps }, form)).toEqual({ kind: 'plain' });
    const shown = { kind: 'special', detail: 'kept', extra: 'kept too' };
    expect(withoutHidden(shown, { steps }, shown)).toEqual(shown);
  });

  it('judges the condition on the form, not on the body that was already cleaned', () => {
    const form = { kind: 'special', detail: ' ' };
    expect(withoutHidden({ kind: 'special' }, { steps }, form)).toEqual({ kind: 'special' });
  });
});
