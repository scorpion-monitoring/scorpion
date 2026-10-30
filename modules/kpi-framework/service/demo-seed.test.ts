import { describe, expect, it } from 'vitest';
import { DEMO_INDICATORS, DEMO_SET } from './demo-seed.ts';
import { createIndicatorSchema, createSetSchema } from './input.ts';

describe('the demo indicators and set', () => {
  it.each(DEMO_INDICATORS.map((item) => [item.input.slug, item.input] as const))(
    '%s passes the rules of a create',
    (_slug, input) => {
      expect(createIndicatorSchema.safeParse(input).success).toBe(true);
    },
  );

  it('use terms of the built-in vocabularies and one slug each', () => {
    const slugs = DEMO_INDICATORS.map((item) => item.input.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const item of DEMO_INDICATORS) {
      expect(['Bibliographic', 'Usage', 'Technical', 'Satisfaction']).toContain(
        item.input.thematic,
      );
      expect(['mandatory', 'recommended', 'optional']).toContain(item.necessity);
      expect(['integer', 'float', 'text', 'duration', 'percentage']).toContain(
        item.input.valueType,
      );
    }
  });

  it('has a set that passes the rules of a create', () => {
    expect(createSetSchema.safeParse({ ...DEMO_SET }).success).toBe(true);
  });
});
