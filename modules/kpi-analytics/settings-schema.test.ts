// The settings of kpi.analytics: the defaults, and a refusal (never a correction) of what is out of range.
import { describe, expect, it } from 'vitest';
import { settingsSchema } from './settings-schema.ts';
import { useAnalytics } from './test/harness.ts';
import { analyticsWorld, paths, rejection } from './test/world.ts';

const parse = (low: unknown, high: unknown) =>
  settingsSchema.safeParse({ volatility: { thresholds: { low, high } } });

describe('volatility.thresholds', () => {
  it('has the defaults 0.4 and 0.8 when nothing is stored', () => {
    expect(settingsSchema.parse({})).toEqual({
      volatility: { thresholds: { low: 0.4, high: 0.8 } },
    });
    expect(settingsSchema.parse({ volatility: {} }).volatility.thresholds).toEqual({
      low: 0.4,
      high: 0.8,
    });
    expect(
      settingsSchema.parse({ volatility: { thresholds: { low: 0.1 } } }).volatility.thresholds,
    ).toEqual({ low: 0.1, high: 0.8 });
  });

  it.each([
    [0.1, 0.2],
    [0.4, 0.8],
    [0.0001, 5],
    [4.9, 5],
  ])('accepts 0 < %s < %s <= 5', (low, high) => {
    expect(parse(low, high).success).toBe(true);
  });

  it.each([
    ['low is 0', 0, 0.8],
    ['low is negative', -0.1, 0.8],
    ['low equals high', 0.5, 0.5],
    ['low above high', 0.9, 0.8],
    ['high above the bound', 0.4, 5.01],
    ['not a number', 'x', 0.8],
    ['NaN', Number.NaN, 0.8],
    ['infinite', 0.4, Infinity],
    ['null', null, 0.8],
  ])('refuses %s, and never corrects it', (_name, low, high) => {
    expect(parse(low, high).success).toBe(false);
  });

  it('refuses an unknown key', () => {
    expect(settingsSchema.safeParse({ volatility: { thresholds: {}, extra: 1 } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ other: 1 }).success).toBe(false);
  });
});

describe('the settings page', () => {
  const h = useAnalytics();

  it('refuses an out-of-range value with a 422 naming the field, and keeps what was stored', async () => {
    const w = await analyticsWorld(await h.start());
    const before = await w.settings.settings.get(w.people.admin, 'kpi.analytics');
    const error = await rejection(
      w.settings.settings.update(w.people.admin, 'kpi.analytics', {
        version: before.version,
        values: { volatility: { thresholds: { low: 0.9, high: 0.5 } } },
      }),
    );
    expect(paths(error).join()).toContain('volatility.thresholds.high');
    const after = await w.settings.settings.get(w.people.admin, 'kpi.analytics');
    expect(after.values).toEqual(before.values);
  });

  it('describes the thresholds for the generic settings form', async () => {
    const w = await analyticsWorld(await h.start());
    const schema = JSON.stringify(
      await w.settings.settings.jsonSchema(w.people.admin, 'kpi.analytics'),
    );
    expect(schema).toContain('thresholds');
    expect(schema).toContain('"low"');
    expect(schema).toContain('"high"');
  });
});
