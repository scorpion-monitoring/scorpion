import { describe, expect, it } from 'vitest';
import { omit, overlay } from './object.ts';

describe('omit', () => {
  it('leaves out one key and keeps the input', () => {
    const input = { a: 1, b: 2 };
    expect(omit(input, 'a')).toEqual({ b: 2 });
    expect(input).toEqual({ a: 1, b: 2 });
    expect(omit(input, 'missing')).toEqual({ a: 1, b: 2 });
  });
});

describe('overlay', () => {
  it('lays the changed keys over the original, and keeps what the form did not draw', () => {
    expect(overlay({ branding: { x: 1 }, rate: { y: 2 } }, { rate: { y: 3 } })).toEqual({
      branding: { x: 1 },
      rate: { y: 3 },
    });
  });

  it('does not bring back a key the form dropped on purpose only if it was never in the original', () => {
    expect(overlay({ a: 1 }, {})).toEqual({ a: 1 });
  });
});
