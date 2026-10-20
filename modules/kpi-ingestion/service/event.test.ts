// The event measurement.recorded@1 (plan §5 item 9): ids, months and counts, never a value and never a name. A test walks
// the schema, so a field that could carry a value cannot be added without this test failing; another reads the payloads that
// a real batch stored. `kpi.impact` (M12) listens; nothing else does.
import { randomUUID } from 'node:crypto';
import { z } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { measurementRecordedSchema } from '../module.ts';
import { useKpi } from '../test/harness.ts';
import { ingestionWorld, payloads } from '../test/world.ts';

const h = useKpi();

describe('the schema of measurement.recorded@1', () => {
  const json = z.toJSONSchema(measurementRecordedSchema) as {
    type: string;
    additionalProperties?: boolean;
    required: string[];
    properties: Record<string, Record<string, unknown>>;
  };

  it('has exactly the fields serviceId, runId, periods, inserted, updated and actorId, and nothing else may be added', () => {
    expect(Object.keys(json.properties).sort()).toEqual(
      ['actorId', 'inserted', 'periods', 'runId', 'serviceId', 'updated'].sort(),
    );
    expect(json.additionalProperties).toBe(false);
    expect([...json.required].sort()).toEqual(Object.keys(json.properties).sort());
  });

  it('allows no free text anywhere: every field is an id, a date, a count or null', () => {
    const idLike = (schema: Record<string, unknown>) =>
      schema.type === 'string' && schema.format === 'uuid';
    const alternatives = (schema: Record<string, unknown>) =>
      (schema.anyOf as Record<string, unknown>[] | undefined) ?? [schema];
    for (const field of ['serviceId', 'runId', 'actorId'] as const)
      for (const option of alternatives(json.properties[field]!))
        expect(idLike(option) || option.type === 'null', field).toBe(true);
    for (const field of ['inserted', 'updated'] as const)
      expect(json.properties[field]).toMatchObject({ type: 'integer', minimum: 0 });
    const periods = json.properties.periods as {
      type: string;
      maxItems: number;
      items: { type: string; pattern: string };
    };
    expect(periods).toMatchObject({ type: 'array', maxItems: 120 });
    expect(periods.items.type).toBe('string');
    // the only text is a date of the form YYYY-MM-DD: a pattern a value or a name cannot satisfy
    expect(new RegExp(periods.items.pattern).test('2026-01-31')).toBe(true);
    expect(new RegExp(periods.items.pattern).test('Downloads')).toBe(false);
    expect(new RegExp(periods.items.pattern).test('2026-01-31 and a value')).toBe(false);
  });

  it('refuses a payload with an extra field, a value, a name, 121 months, a bad month or a negative count', () => {
    const good = {
      serviceId: randomUUID(),
      runId: null,
      periods: ['2026-01-31'],
      inserted: 1,
      updated: 0,
      actorId: randomUUID(),
    };
    expect(measurementRecordedSchema.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, value: 5 },
      { ...good, values: [5] },
      { ...good, indicator: 'Downloads' },
      { ...good, periods: Array.from({ length: 121 }, () => '2026-01-31') },
      { ...good, periods: ['January'] },
      { ...good, periods: ['2026-01-31 5'] },
      { ...good, inserted: -1 },
      { ...good, inserted: 1.5 },
      { ...good, serviceId: 'x' },
      { ...good, runId: 'x' },
      { ...good, actorId: 'x' },
    ])
      expect(measurementRecordedSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('the payloads of real batches', () => {
  it('match the schema, and hold no value, name or text that was submitted', async () => {
    const w = await ingestionWorld(await h.start());
    await w.submit([
      w.row(w.ind.downloads, '2026-01', 987_654),
      w.row(w.ind.note, '2026-01', 'a private remark about the service'),
      w.row(w.ind.share, '2026-02', 33.25),
    ]);
    await w.submit([w.row(w.ind.downloads, '2026-01', 123_456)], w.people.manager);
    const events = await payloads(w.pool, 'measurement.recorded@1');
    expect(events).toHaveLength(2);
    for (const event of events)
      expect(measurementRecordedSchema.safeParse(event).success).toBe(true);
    const text = JSON.stringify(events);
    for (const secret of [
      '987654',
      '123456',
      'private remark',
      '33.25',
      w.ind.note.name,
      w.ind.downloads.name,
    ])
      expect(text, secret).not.toContain(secret);
    expect(events[1]).toEqual({
      serviceId: w.svc.id,
      runId: null,
      periods: ['2026-01-31'],
      inserted: 0,
      updated: 1,
      actorId: w.people.manager.userId,
    });
  });
});
