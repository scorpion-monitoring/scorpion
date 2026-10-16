import { describe, expect, it } from 'vitest';
import {
  bodyFromForm,
  emptyForm,
  formFromIndicator,
  parseBound,
  showsBounds,
  type ValueTypeChoice,
} from './form.ts';

const types: ValueTypeChoice[] = [
  { id: 'integer', labels: { en: 'Whole number' }, numeric: true, aggregates: ['sum'] },
  { id: 'text', labels: { en: 'Text' }, numeric: false, aggregates: [] },
];

describe('parseBound', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['0', 0],
    ['-3', -3],
    ['12.5', 12.5],
    ['.5', 0.5],
    ['+7', 7],
    ['1e3', undefined],
    ['abc', undefined],
    ['1,5', undefined],
    ['--1', undefined],
  ])('%j → %j', (text, expected) => {
    expect(parseBound(text)).toBe(expected);
  });
});

describe('showsBounds', () => {
  it('is for a numeric type that is not qualitative, decided by the registry entry', () => {
    expect(showsBounds({ ...emptyForm('integer', 'Usage') }, types)).toBe(true);
    expect(showsBounds({ ...emptyForm('text', 'Usage') }, types)).toBe(false);
    expect(showsBounds({ ...emptyForm('integer', 'Usage'), qualitative: true }, types)).toBe(false);
    expect(showsBounds({ ...emptyForm('unknown', 'Usage') }, types)).toBe(false);
  });
});

describe('bodyFromForm', () => {
  it('sends the bounds as numbers and an empty unit as null', () => {
    const form = { ...emptyForm('integer', 'Usage'), name: 'Views', min: '0', max: '10.5' };
    expect(bodyFromForm(form, types)).toMatchObject({
      body: {
        name: 'Views',
        valueType: 'integer',
        unit: null,
        min: 0,
        max: 10.5,
        thematic: 'Usage',
      },
    });
  });

  it('names a bound that is not a number, and sends none for a type without bounds', () => {
    expect(bodyFromForm({ ...emptyForm('integer', 'Usage'), min: 'x', max: 'y' }, types)).toEqual({
      invalid: ['min', 'max'],
    });
    const text = bodyFromForm({ ...emptyForm('text', 'Usage'), min: 'x' }, types);
    expect(text).toMatchObject({ body: { min: null, max: null } });
  });

  it('makes a qualitative indicator a text one without bounds', () => {
    const form = { ...emptyForm('integer', 'Usage'), qualitative: true, min: '1' };
    expect(bodyFromForm(form, types)).toMatchObject({
      body: { qualitative: true, valueType: 'text', min: null, max: null },
    });
  });
});

describe('formFromIndicator', () => {
  it('turns nulls into empty boxes and copies the lists', () => {
    const measuredBy = ['a'];
    const form = formFromIndicator({
      name: 'N',
      description: null,
      example: null,
      qualitative: false,
      valueType: 'integer',
      unit: null,
      min: 0,
      max: null,
      thematic: 'Usage',
      measuredBy,
      canBeAutomatedBy: [],
    });
    expect(form).toMatchObject({ description: '', example: '', unit: '', min: '0', max: '' });
    expect(form.measuredBy).toEqual(['a']);
    expect(form.measuredBy).not.toBe(measuredBy);
  });
});
