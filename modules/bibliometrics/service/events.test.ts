// The event bibliometrics.citations.updated@1: ids and counts, never a DOI, a title or a URL. The test walks the schema, so
// a field that could carry text cannot be added without it failing. The payloads of a real run are checked in
// citations.test.ts.
import { randomUUID } from 'node:crypto';
import { z } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { SLICE_SIZE } from './citations.ts';
import { citationsUpdatedSchema } from './events.ts';

describe('the schema of bibliometrics.citations.updated@1', () => {
  const json = z.toJSONSchema(citationsUpdatedSchema) as {
    additionalProperties?: boolean;
    required: string[];
    properties: Record<string, Record<string, unknown>>;
  };

  it('has exactly runId, serviceIds, found and failed, all required, and nothing else may be added', () => {
    expect(Object.keys(json.properties).sort()).toEqual(['failed', 'found', 'runId', 'serviceIds']);
    expect(json.additionalProperties).toBe(false);
    expect([...json.required].sort()).toEqual(Object.keys(json.properties).sort());
  });

  it('allows no free text: every field is a uuid, a list of at most 2,000 uuids, or a count', () => {
    expect(json.properties.runId).toMatchObject({ type: 'string', format: 'uuid' });
    expect(json.properties.serviceIds).toMatchObject({
      type: 'array',
      maxItems: SLICE_SIZE,
      items: { type: 'string', format: 'uuid' },
    });
    for (const field of ['found', 'failed'])
      expect(json.properties[field]).toMatchObject({ type: 'integer', minimum: 0 });
  });

  it('refuses a DOI, a title, a URL, 2,001 services or a negative count', () => {
    const good = { runId: randomUUID(), serviceIds: [randomUUID()], found: 2, failed: 1 };
    expect(citationsUpdatedSchema.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, doi: '10.5555/x' },
      { ...good, dois: ['10.5555/x'] },
      { ...good, title: 'A paper' },
      { ...good, url: 'https://api.openalex.org/works' },
      { ...good, serviceIds: ['10.5555/x'] },
      { ...good, serviceIds: Array.from({ length: SLICE_SIZE + 1 }, () => randomUUID()) },
      { ...good, found: -1 },
      { ...good, failed: 0.5 },
      { ...good, runId: 'run' },
    ])
      expect(citationsUpdatedSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(
        false,
      );
  });
});
