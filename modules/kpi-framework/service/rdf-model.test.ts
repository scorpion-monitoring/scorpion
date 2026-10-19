// The query function that fills the RDF model and the service around it (M9 sprint 4): what becomes of a KPI set that maps to
// a RIMO category and of one that does not, the strongest relation when two sets share a category, the units, means and
// tools, the IRI base, a denied caller, and that the same data gives the same bytes. The writer is rdf.test.ts.
import type { Actor } from '@scorpion/contracts';
import { createDb } from '@scorpion/kernel';
import { Parser } from 'n3';
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { rejection, uniq } from '../test/world.ts';
import { buildRdfModel } from './rdf-model.ts';
import { toJsonLd, toTurtle } from './rdf.ts';

const h = useKpi();
const BASE = 'https://iri.example.org';
const RIMO = 'http://w3id.org/RIMO#';

async function start(iriBase = BASE) {
  const s = await h.start();
  if (iriBase !== '') await s.configure({ iriBase });
  return s;
}

describe('buildRdfModel', () => {
  it('maps a set to its RIMO category, or mints one, and keeps the strongest relation of two sets that share a category', async () => {
    const s = await start();
    const a = await makeIndicator(s.pool, { name: uniq('A'), unit: 'count' });
    const b = await makeIndicator(s.pool, {
      name: uniq('B'),
      unit: 'percent',
      valueType: 'percentage',
    });
    const c = await makeIndicator(s.pool, { name: uniq('C') });
    await makeKpiSet(s.pool, {
      name: 'Web one',
      rimoCategory: 'Web_application',
      indicators: [
        { indicatorId: a.id, necessity: 'optional' },
        { indicatorId: b.id, necessity: 'recommended' },
      ],
    });
    await makeKpiSet(s.pool, {
      name: 'Web two',
      rimoCategory: 'Web_application',
      indicators: [
        { indicatorId: a.id, necessity: 'mandatory' },
        { indicatorId: b.id, necessity: 'optional' },
      ],
    });
    const own = await makeKpiSet(s.pool, {
      name: 'Own "set"',
      description: 'The own one',
      indicators: [{ indicatorId: c.id, necessity: 'a-new-term' }],
    });
    await makeKpiSet(s.pool, { name: 'Empty one', rimoCategory: 'Helpdesk' });

    const parsed = new Parser({ format: 'text/turtle' }).parse(
      (await s.kpi.rdf.turtle(await s.actor('user'))).body,
    );
    const of = (indicatorIri: string, predicate: string) =>
      parsed
        .filter(
          (q) => q.subject.value === indicatorIri && q.predicate.value === `${RIMO}${predicate}`,
        )
        .map((q) => q.object.value)
        .sort();
    const iriOf = (row: { slug: string }) => `${BASE}/kpi/indicator/${row.slug}`;
    // a: mandatory in the one and optional in the other set of the same category: one triple, the strongest.
    expect(of(iriOf(a), 'mandatoryFor')).toEqual([`${RIMO}Web_application`]);
    expect(of(iriOf(a), 'appliedTo')).toEqual([]);
    expect(of(iriOf(b), 'recommendedFor')).toEqual([`${RIMO}Web_application`]);
    expect(of(iriOf(b), 'appliedTo')).toEqual([]);
    // c: a term that is neither mandatory nor recommended is the base property, towards the minted category.
    expect(of(iriOf(c), 'appliedTo')).toEqual([`${BASE}/kpi/set/${own.slug}`]);
    // The categories: the RIMO ones appear once each (also the one of an empty set), the minted one with its words.
    const categories = parsed
      .filter(
        (q) => q.predicate.value.endsWith('#type') && q.object.value === `${RIMO}ServiceCategory`,
      )
      .map((q) => q.subject.value)
      .sort();
    expect(categories).toEqual(
      [`${BASE}/kpi/set/${own.slug}`, `${RIMO}Helpdesk`, `${RIMO}Web_application`].sort(),
    );
    expect(
      parsed.find(
        (q) =>
          q.subject.value === `${BASE}/kpi/set/${own.slug}` &&
          q.predicate.value.endsWith('prefLabel'),
      )?.object.value,
    ).toBe('Own "set"');
    // The words of a RIMO category are RIMO's: this export does not assert a name for it.
    expect(parsed.filter((q) => q.subject.value === `${RIMO}Web_application`)).toHaveLength(1);
  });

  it('lists only the units, means and tools that an indicator uses, with the Units Ontology term where there is one', async () => {
    const s = await start();
    const admin = await s.actor('admin');
    // Terms of the vocabularies, as an administrator adds them.
    for (const [vocabulary, key] of [
      ['kpi.measured-by', 'web-analytics'],
      ['kpi.automation-tool', 'matomo'],
      ['kpi.unit', 'my-own-unit'],
    ] as const) {
      await s.settings.vocabularies.createTerm(admin, vocabulary, {
        key,
        labels: { en: key },
      });
    }
    await makeIndicator(s.pool, {
      name: uniq('U'),
      unit: 'request',
      measuredBy: ['web-analytics'],
      canBeAutomatedBy: ['matomo'],
    });
    await makeIndicator(s.pool, { name: uniq('V'), unit: 'my-own-unit', min: 0, max: 12.5 });
    await makeIndicator(s.pool, { name: uniq('W'), unit: null });

    const turtle = (await s.kpi.rdf.turtle(admin)).body;
    const triples = new Parser({ format: 'text/turtle' }).parse(turtle);
    const subjects = (type: string) =>
      triples
        .filter((q) => q.predicate.value.endsWith('#type') && q.object.value === type)
        .map((q) => q.subject.value)
        .sort();
    expect(subjects('https://iri.example.org/kpi/ns#Unit')).toEqual([
      `${BASE}/kpi/unit/my-own-unit`,
      `${BASE}/kpi/unit/request`,
    ]);
    expect(subjects(`${RIMO}MeasurementMeans`)).toEqual([`${BASE}/kpi/means/web-analytics`]);
    expect(subjects(`${RIMO}AutomationTool`)).toEqual([`${BASE}/kpi/tool/matomo`]);
    // `request` has no Units Ontology term of its own: it is a `count unit`, and keeps its own node.
    expect(turtle).toContain('rimo:hasUnit uo:0000189');
    expect(turtle).toContain(`scorpion:unit <${BASE}/kpi/unit/request>`);
    // An own unit has no Units Ontology term: the minted IRI is the unit.
    expect(turtle).toContain(`rimo:hasUnit <${BASE}/kpi/unit/my-own-unit>`);
    expect(turtle).toContain('scorpion:maxValue "12.5"^^xsd:decimal');
    expect(turtle).toContain('scorpion:minValue "0"^^xsd:decimal');
  });

  it('builds the IRIs from the setting iriBase, and from the origin and base path of the instance when it is empty', async () => {
    const set = await start('https://elsewhere.example.org/deep/base');
    await makeIndicator(set.pool, { name: uniq('I'), slug: 'based', unit: 'count' });
    const withSetting = (await set.kpi.rdf.turtle(await set.actor('user'))).body;
    expect(withSetting).toContain('<https://elsewhere.example.org/deep/base/kpi/indicator/based>');
    expect(withSetting).not.toContain(BASE);

    const unset = await start('');
    await makeIndicator(unset.pool, { name: uniq('I'), slug: 'based', unit: 'count' });
    const origin = unset.kernel.config.ORIGIN.replace(/\/+$/, '');
    const without = (await unset.kpi.rdf.turtle(await unset.actor('user'))).body;
    expect(without).toContain(
      `<${origin}${unset.kernel.config.BASE_PATH === '/' ? '' : unset.kernel.config.BASE_PATH}/kpi/indicator/based>`,
    );
  });
});

describe('the RDF service', () => {
  it('gives the same bytes for the same data, in both formats, and an ETag that is the hash of the bytes', async () => {
    const s = await start();
    const x = await makeIndicator(s.pool, { name: uniq('X'), unit: 'count' });
    await makeKpiSet(s.pool, {
      name: uniq('set'),
      rimoCategory: 'Workflow',
      indicators: [{ indicatorId: x.id, necessity: 'mandatory' }],
    });
    const user = await s.actor('user');
    const [first, second] = [await s.kpi.rdf.turtle(user), await s.kpi.rdf.turtle(user)];
    expect(second).toEqual(first);
    expect(first.etag).toMatch(/^"[0-9a-f]{32}"$/);
    const publicOne = await s.kpi.rdf.publicTurtleAsSystem();
    expect(publicOne).toEqual(first);
    const jsonOne = await s.kpi.rdf.jsonLd(user);
    expect(await s.kpi.rdf.publicJsonLdAsSystem()).toEqual(jsonOne);
    expect(jsonOne.etag).not.toBe(first.etag);
    // A change of the data changes the tag.
    await makeIndicator(s.pool, { name: uniq('Y') });
    expect((await s.kpi.rdf.turtle(user)).etag).not.toBe(first.etag);
  });

  it('does not depend on the order the rows were written in', async () => {
    const names = ['Alpha', 'Bravo', 'Charlie'];
    const outputs: string[] = [];
    for (const order of [names, [...names].reverse()]) {
      const s = await start();
      const made = new Map<string, string>();
      for (const name of order) {
        const row = await makeIndicator(s.pool, { name, slug: name.toLowerCase(), unit: 'count' });
        made.set(name, row.id);
      }
      for (const name of order)
        await makeKpiSet(s.pool, {
          name: `Set ${name}`,
          slug: `set-${name.toLowerCase()}`,
          indicators: [{ indicatorId: made.get(name)!, necessity: 'mandatory' }],
        });
      outputs.push((await s.kpi.rdf.turtle(await s.actor('user'))).body);
    }
    expect(outputs[1]).toBe(outputs[0]);
  });

  it('is empty but valid for an instance without indicators', async () => {
    const s = await start();
    const turtle = (await s.kpi.rdf.turtle(await s.actor('user'))).body;
    expect(new Parser({ format: 'text/turtle' }).parse(turtle)).toHaveLength(2);
    const document = JSON.parse((await s.kpi.rdf.jsonLd(await s.actor('user'))).body) as {
      '@graph': unknown[];
    };
    expect(document['@graph']).toHaveLength(1);
  });

  it('needs the permission: an anonymous caller is 401 and a token without the scope is 403', async () => {
    const s = await start();
    for (const read of [
      (actor: Actor) => s.kpi.rdf.turtle(actor),
      (actor: Actor) => s.kpi.rdf.jsonLd(actor),
    ]) {
      expect((await rejection(read({ kind: 'anonymous' }))).status).toBe(401);
      const withoutScope = {
        ...(await s.actor('user')),
        via: 'token' as const,
        scopes: ['core.identity.me.read'],
      };
      expect((await rejection(read(withoutScope))).status).toBe(403);
    }
  });

  it('writes with the model that toTurtle and toJsonLd render, nothing else', async () => {
    const s = await start();
    await makeIndicator(s.pool, { name: uniq('Z'), unit: 'count' });
    const user = await s.actor('user');
    const ttl = (await s.kpi.rdf.turtle(user)).body;
    const json = (await s.kpi.rdf.jsonLd(user)).body;
    // The service has no other writer: re-rendering a model built from the same rows gives the bytes it answered with.
    expect(ttl).toBe(toTurtle(await modelOf(s)));
    expect(json).toBe(toJsonLd(await modelOf(s)));
  });
});

const modelOf = (s: Awaited<ReturnType<typeof start>>) => buildRdfModel(createDb(s.pool), BASE);
