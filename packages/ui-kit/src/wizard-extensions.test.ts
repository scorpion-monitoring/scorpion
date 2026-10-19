// The registry that a module's `wizardExtensions` export is forwarded to (ADR-0040 addendum): what the shell registers
// is what the pages of `registry.services` read; a name registered twice is an error that names it; a module without the
// export changes nothing; `resetExtensions` empties it for the next test.
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contributedWidget,
  registerFieldWidget,
  registerServiceSection,
  registerStepApplies,
  registerWizardExtensions,
  resetExtensions,
  serviceSections,
  stepConditions,
} from './wizard-extensions.ts';

const component = (name: string) => ({ name }) as unknown as Component<never>;

afterEach(() => resetExtensions());

describe('registerWizardExtensions', () => {
  it('registers the widgets, the step conditions and the sections of one export, and reads them back', () => {
    const widget = component('widget');
    const section = component('section');
    const applies = (form: Record<string, unknown>) => form.on === true;
    registerWizardExtensions({
      widgets: { 'kpi-set': widget as never },
      applies: { later: applies },
      sections: { kpis: section as never },
    });
    expect(contributedWidget('kpi-set')).toBe(widget);
    expect(stepConditions().later?.({ on: true })).toBe(true);
    expect(stepConditions().later?.({})).toBe(false);
    expect(serviceSections()).toEqual([['kpis', section]]);
  });

  it('does nothing for a module without the export, and for an export with no keys', () => {
    registerWizardExtensions(undefined);
    registerWizardExtensions({});
    expect(serviceSections()).toEqual([]);
    expect(Object.keys(stepConditions())).toEqual([]);
    expect(contributedWidget('anything')).toBeUndefined();
  });

  it('keeps the sections in the order they were registered', () => {
    registerServiceSection('b', component('b') as never);
    registerServiceSection('a', component('a') as never);
    expect(serviceSections().map(([name]) => name)).toEqual(['b', 'a']);
  });

  it.each([
    [
      'a widget',
      () => registerFieldWidget('w', component('x') as never),
      /widget "w" is registered twice/,
    ],
    [
      'a step condition',
      () => registerStepApplies('s', () => true),
      /step "s" has its condition registered twice/,
    ],
    [
      'a section',
      () => registerServiceSection('c', component('x') as never),
      /section "c" is registered twice/,
    ],
  ])('refuses %s registered twice and names it', (_what, register, message) => {
    register();
    expect(register).toThrow(message);
  });

  it('forgets everything on reset', () => {
    registerFieldWidget('w', component('x') as never);
    registerStepApplies('s', () => true);
    registerServiceSection('c', component('x') as never);
    resetExtensions();
    expect(contributedWidget('w')).toBeUndefined();
    expect(Object.keys(stepConditions())).toEqual([]);
    expect(serviceSections()).toEqual([]);
  });
});
