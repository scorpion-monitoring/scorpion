// The dashboard document (M11 sprint 1): table-driven cases for every repair of plan §3, and fast-check properties
// for what must hold for any input. Pure functions: no database, no clock.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MAX_DOCUMENT_BYTES, MAX_ITEMS } from '../../grid.ts';
import { widgetEntrySchema } from '../../registries.ts';
import {
  defaultDashboard,
  migrate,
  pack,
  parseDashboard,
  serialiseDashboard,
  type DashboardItem,
  type PlaceableWidget,
} from './document.ts';

const trendsConfig = z.object({
  range: z.enum(['3m', '6m', '1y', '2y', 'all']).default('1y'),
  service: z.string().max(40).optional(),
  hidden: z.array(z.string().max(20)).max(5).default([]),
});
const notesConfig = z.object({ text: z.string().max(380).default('') });

const entries: PlaceableWidget[] = [
  { id: 'fix.card', slot: 'dashboard', component: 'Card', order: 20, permission: 'p.card' },
  {
    id: 'fix.trends',
    slot: 'dashboard',
    component: 'Trends',
    order: 10,
    public: true,
    grid: { w: 6, h: 4, minW: 3, maxW: 12, minH: 2, maxH: 8, default: { x: 0, y: 0, w: 6, h: 4 } },
    configSchema: trendsConfig,
  },
  {
    id: 'fix.single',
    slot: 'dashboard',
    component: 'Single',
    order: 5,
    permission: 'p.single',
    grid: { w: 3, h: 2, singleton: true, default: { x: 6, y: 0, w: 3, h: 2 } },
  },
  {
    id: 'fix.notes',
    slot: 'dashboard',
    component: 'Notes',
    order: 30,
    public: true,
    grid: { w: 2, h: 1 },
    configSchema: notesConfig,
  },
  { id: 'fix.bell', slot: 'header', component: 'Bell', order: 1, public: true },
  { id: 'fix.admin', slot: 'dashboard', component: 'Admin', order: 40, permission: 'p.admin' },
].map((entry) => widgetEntrySchema.parse(entry));

const granted = new Set(['p.card', 'p.single']);
const may = (entry: PlaceableWidget) => entry.public === true || granted.has(entry.permission!);
const context = { entries, may };

const tile = (over: Partial<DashboardItem> = {}): DashboardItem => ({
  id: 'abcd',
  widget: 'fix.trends',
  x: 0,
  y: 0,
  w: 6,
  h: 4,
  config: { range: '1y', hidden: [] },
  ...over,
});
const doc = (...items: unknown[]) => ({ version: 1, items });
const raw = (over: Record<string, unknown> = {}) => ({ ...tile(), ...over });

const defaultIds = () => defaultDashboard(entries, may).map((item) => item.widget);

describe('the default dashboard', () => {
  it('lists the widgets that carry a default placement and that the caller may see, by row and column', () => {
    const items = defaultDashboard(entries, may);
    expect(items.map((item) => item.widget)).toEqual(['fix.trends', 'fix.single']);
    expect(items[0]).toMatchObject({ x: 0, y: 0, w: 6, h: 4, config: { range: '1y', hidden: [] } });
  });

  it('lets the widget with the lower `order` keep a place two defaults want', () => {
    const same = { x: 0, y: 0, w: 4, h: 2 };
    const wanted = [
      { ...entries[1]!, id: 'fix.late', order: 50, grid: { w: 4, h: 2, default: same } },
      { ...entries[1]!, id: 'fix.early', order: 5, grid: { w: 4, h: 2, default: same } },
    ] as PlaceableWidget[];
    expect(defaultDashboard(wanted, () => true).map((item) => [item.widget, item.y])).toEqual([
      ['fix.early', 0],
      ['fix.late', 2],
    ]);
  });

  it('leaves out a widget the caller may not see, a header widget and a card with no placement', () => {
    expect(
      defaultDashboard(entries, (entry) => entry.id === 'fix.trends').map((i) => i.widget),
    ).toEqual(['fix.trends']);
    expect(defaultIds()).not.toContain('fix.bell');
    expect(defaultIds()).not.toContain('fix.card');
  });

  it('gives each tile the same valid, unique id every time', () => {
    const first = defaultDashboard(entries, may);
    expect(first.map((item) => item.id)).toEqual(
      defaultDashboard(entries, may).map((item) => item.id),
    );
    for (const item of first) expect(item.id).toMatch(/^[a-z0-9]{4,12}$/);
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
  });

  it('packs defaults that overlap and is what a reset gives', () => {
    const crowded = [
      { ...entries[1]!, grid: { ...entries[1]!.grid!, default: { x: 0, y: 0, w: 6, h: 4 } } },
      {
        ...entries[2]!,
        id: 'fix.other',
        grid: { w: 3, h: 2, default: { x: 2, y: 1, w: 3, h: 2 } },
      },
    ] as PlaceableWidget[];
    const items = defaultDashboard(crowded, () => true);
    expect(items.map((item) => [item.widget, item.y])).toEqual([
      ['fix.trends', 0],
      ['fix.other', 4],
    ]);
    expect(parseDashboard(null, context)).toMatchObject({
      reset: true,
      resetReason: 'invalid',
      dropped: [],
      items: defaultDashboard(entries, may),
    });
  });
});

describe('parseDashboard: a document that cannot be read becomes the default', () => {
  const deep = (depth: number) => {
    let value: unknown = 1;
    for (let i = 0; i < depth; i += 1) value = { v: value };
    return value;
  };
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'dashboard'],
    ['a number', 42],
    ['an array', []],
    ['an array of tiles', [tile()]],
    ['an empty object', {}],
    ['no items', { version: 1 }],
    ['items that are not a list', { version: 1, items: 'x' }],
    ['a version that is not a number', { version: '1', items: [] }],
    ['version 0', { version: 0, items: [] }],
    ['a fractional version', { version: 1.5, items: [] }],
    ['a negative version', { version: -1, items: [] }],
    ['a tile that is not an object', doc('x')],
    ['a tile with no widget', doc({ ...tile(), widget: undefined })],
    ['a tile whose config is not an object', doc(raw({ config: 'x' }))],
    ['a tile whose config is an array', doc(raw({ config: [] }))],
    ['a tile whose config is null', doc(raw({ config: null }))],
    ['a tile with a string size', doc(raw({ w: '6' }))],
    ['a tile with an over-long id', doc(raw({ id: 'x'.repeat(65) }))],
    [
      'a hundred and one tiles',
      doc(...Array.from({ length: 101 }, (_, i) => raw({ id: `t${i}aa` }))),
    ],
    ['a very large list', doc(...Array.from({ length: 100_000 }, () => raw()))],
  ])('%s', (_name, input) => {
    const result = parseDashboard(input, context);
    expect(result).toMatchObject({ reset: true, resetReason: 'invalid', dropped: [] });
    expect(result.items).toEqual(defaultDashboard(entries, may));
  });

  it('refuses a version it does not know and says it is newer, instead of guessing', () => {
    expect(parseDashboard({ version: 2, items: [raw()] }, context)).toMatchObject({
      reset: true,
      resetReason: 'newer-version',
      items: defaultDashboard(entries, may),
    });
    expect(parseDashboard({ version: 2, items: 'whatever' }, context).resetReason).toBe(
      'newer-version',
    );
  });

  it('replaces a document of more than 20 tiles by the default', () => {
    const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) =>
      raw({ id: `tile${i}`, y: i * 5 }),
    );
    expect(parseDashboard(doc(...items), context)).toMatchObject({
      reset: true,
      resetReason: 'too-many-items',
    });
    expect(parseDashboard(doc(...items.slice(0, MAX_ITEMS)), context).reset).toBe(false);
  });

  it('survives a value too deep to serialise, in a config', () => {
    const result = parseDashboard(
      doc(raw({ config: { range: '3m', service: deep(50_000) } })),
      context,
    );
    expect(result.reset).toBe(false);
    expect(result.items[0]!.config).toEqual({ range: '1y', hidden: [] });
  });
});

describe('parseDashboard: what it drops, with a reason', () => {
  it.each([
    ['a widget no module offers any more', raw({ widget: 'fix.gone' }), 'unknown-widget'],
    ['a widget of the header slot', raw({ widget: 'fix.bell' }), 'unknown-widget'],
    ['a widget the caller may not see', raw({ widget: 'fix.admin' }), 'not-permitted'],
    ['an id with capitals', raw({ id: 'ABCD' }), 'invalid-item'],
    ['an id that is too short', raw({ id: 'abc' }), 'invalid-item'],
    ['an id that is too long', raw({ id: 'a'.repeat(13) }), 'invalid-item'],
    ['an id with a dash', raw({ id: 'ab-cd' }), 'invalid-item'],
  ])('%s', (_name, input, reason) => {
    const result = parseDashboard(doc(input, raw({ id: 'keep', y: 10 })), context);
    expect(result.reset).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual(['keep']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.reason).toBe(reason);
  });

  it('names a dropped tile by its id, and by its position when it has no usable id', () => {
    const result = parseDashboard(
      doc(raw({ id: 'gone', widget: 'fix.gone' }), raw({ id: '!' })),
      context,
    );
    expect(result.dropped).toEqual([
      { id: 'gone', reason: 'unknown-widget' },
      { id: '#1', reason: 'invalid-item' },
    ]);
  });

  it('keeps the first of two tiles that share an id', () => {
    const result = parseDashboard(doc(raw({ w: 4 }), raw({ w: 5, y: 9 })), context);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.w).toBe(4);
    expect(result.dropped).toEqual([{ id: 'abcd', reason: 'duplicate-id' }]);
  });

  it('keeps a singleton once', () => {
    const single = (id: string, y: number) => raw({ id, widget: 'fix.single', w: 3, h: 2, y });
    const result = parseDashboard(doc(single('aaaa', 0), single('bbbb', 3)), context);
    expect(result.items.map((item) => item.id)).toEqual(['aaaa']);
    expect(result.dropped).toEqual([{ id: 'bbbb', reason: 'singleton-repeated' }]);
  });

  it('allows several instances of a widget that is not a singleton', () => {
    const result = parseDashboard(doc(raw({ id: 'aaaa' }), raw({ id: 'bbbb', y: 4 })), context);
    expect(result.items).toHaveLength(2);
    expect(result.dropped).toEqual([]);
  });

  it('treats a number that JSON cannot carry (NaN, Infinity) as an unreadable document', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const field of ['x', 'y', 'w', 'h']) {
        expect(parseDashboard(doc(raw({ [field]: bad })), context)).toMatchObject({
          reset: true,
          resetReason: 'invalid',
        });
      }
    }
  });

  it('limits a card of the old kind to the grid, as it has no limits of its own', () => {
    const card = (over: Record<string, unknown>) =>
      parseDashboard(doc(raw({ widget: 'fix.card', config: {}, ...over })), context).items[0]!;
    expect(card({ w: 99, h: 99 })).toMatchObject({ w: 12, h: 50, config: {} });
    expect(card({ w: 0, h: -1 })).toMatchObject({ w: 1, h: 1 });
  });
});

describe('parseDashboard: what it repairs', () => {
  const one = (over: Record<string, unknown>) => parseDashboard(doc(raw(over)), context).items[0]!;

  it.each([
    ['a width above the maximum', { w: 99 }, { w: 12 }],
    ['a width below the minimum', { w: 1 }, { w: 3 }],
    ['a zero width', { w: 0 }, { w: 3 }],
    ['a negative width', { w: -4 }, { w: 3 }],
    ['a height above the maximum', { h: 40 }, { h: 8 }],
    ['a negative height', { h: -1 }, { h: 2 }],
    ['a fractional size', { w: 5.4, h: 3.6 }, { w: 5, h: 4 }],
    ['a negative column', { x: -3 }, { x: 0 }],
    ['a tile that leaves the grid on the right', { x: 10, w: 6 }, { x: 6, w: 6 }],
    ['a column far outside', { x: 1e9, w: 3 }, { x: 9, w: 3 }],
    ['a negative row', { y: -5 }, { y: 0 }],
    ['a row far below', { y: 1e9 }, { y: 1000 }],
  ])('%s', (_name, input, expected) => {
    expect(one(input)).toMatchObject(expected);
  });

  it('moves a tile that overlaps an earlier one down, below it', () => {
    const result = parseDashboard(
      doc(
        raw({ id: 'aaaa', y: 0 }),
        raw({ id: 'bbbb', y: 1, x: 3 }),
        raw({ id: 'cccc', y: 0, x: 6 }),
      ),
      context,
    );
    expect(result.items.map((item) => [item.id, item.x, item.y])).toEqual([
      ['aaaa', 0, 0],
      ['cccc', 6, 0],
      ['bbbb', 3, 4],
    ]);
    expect(result.dropped).toEqual([]);
  });

  it('keeps a gap: it moves nothing that does not overlap', () => {
    const result = parseDashboard(
      doc(raw({ id: 'aaaa', y: 0 }), raw({ id: 'bbbb', y: 20 })),
      context,
    );
    expect(result.items.map((item) => item.y)).toEqual([0, 20]);
  });

  it.each([
    ['a value the schema refuses', { range: 'forever' }],
    ['a field of the wrong type', { range: 3 }],
    ['a list that is too long', { hidden: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    [
      'a config of more than 400 bytes, though its known fields are fine',
      { range: '3m', pad: 'p'.repeat(400) },
    ],
  ])('replaces %s by the widget’s defaults and keeps the widget', (_name, config) => {
    const item = one({ config });
    expect(item.widget).toBe('fix.trends');
    expect(item.config).toEqual({ range: '1y', hidden: [] });
  });

  it.each([
    ['a string', 'x'],
    ['an array', [1]],
    ['null', null],
    ['a number', 3],
  ])('replaces a config that is %s by the widget’s defaults', (_name, config) => {
    // the structure refuses these on the stored path; called directly the repair still holds
    expect(parseDashboard(doc(raw({ config })), context).items).toEqual(
      defaultDashboard(entries, may),
    );
  });

  it('validates, defaults and strips a good config', () => {
    expect(one({ config: { range: '3m', extra: true } }).config).toEqual({
      range: '3m',
      hidden: [],
    });
    expect(one({ config: {} }).config).toEqual({ range: '1y', hidden: [] });
  });

  it('gives a widget with no config schema an empty config', () => {
    const item = parseDashboard(
      doc(raw({ widget: 'fix.card', w: 4, h: 3, config: { a: 1 } })),
      context,
    ).items[0]!;
    expect(item.config).toEqual({});
  });

  it('does not let a key such as __proto__ reach the result or the prototype of anything', () => {
    const stored = JSON.parse(
      '{"version":1,"items":[{"id":"abcd","widget":"fix.trends","x":0,"y":0,"w":6,"h":4,"config":{"__proto__":{"polluted":true},"range":"3m"}}]}',
    ) as unknown;
    const result = parseDashboard(stored, context);
    expect(result.items[0]!.config).toEqual({ range: '3m', hidden: [] });
    expect(Object.hasOwn(result.items[0]!.config, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const nested = JSON.parse(
      '{"version":1,"items":[{"id":"abcd","widget":"fix.card","x":0,"y":0,"w":4,"h":3,"__proto__":{"polluted":true},"config":{}}]}',
    ) as unknown;
    expect(parseDashboard(nested, context).items).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops the last tiles when the repaired document would still be over 8 KiB', () => {
    const notes = (i: number) =>
      raw({
        id: `note${String(i).padStart(2, '0')}`,
        widget: 'fix.notes',
        w: 2,
        h: 1,
        x: (i % 6) * 2,
        y: Math.floor(i / 6),
        config: { text: 't'.repeat(380) },
      });
    const result = parseDashboard(doc(...Array.from({ length: 20 }, (_, i) => notes(i))), context);
    expect(
      new TextEncoder().encode(JSON.stringify(serialiseDashboard(result.items))).length,
    ).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    expect(result.items.length).toBeLessThan(20);
    expect(result.dropped.length).toBe(20 - result.items.length);
    expect(new Set(result.dropped.map((d) => d.reason))).toEqual(new Set(['document-too-large']));
    // the tiles that go are the last by row and column
    expect(result.dropped[0]!.id).toBe(`note${String(19).padStart(2, '0')}`);
  });
});

describe('serialiseDashboard', () => {
  it('writes the known keys, at the current version, and nothing else', () => {
    const noisy = { ...tile(), secret: 'x', config: { range: '3m', hidden: [] } };
    expect(serialiseDashboard([noisy])).toEqual({
      version: 1,
      items: [tile({ config: { range: '3m', hidden: [] } })],
    });
    expect(Object.keys(serialiseDashboard([noisy]).items[0]!)).toEqual([
      'id',
      'widget',
      'x',
      'y',
      'w',
      'h',
      'config',
    ]);
  });

  it('throws a RangeError rather than produce a document over 8 KiB', () => {
    const big = Array.from({ length: 20 }, (_, i) =>
      tile({ id: `big${i}aa`, config: { text: 'x'.repeat(400) } }),
    );
    expect(() => serialiseDashboard(big)).toThrow(RangeError);
  });

  it('throws a RangeError for more than 20 tiles', () => {
    expect(() =>
      serialiseDashboard(Array.from({ length: 21 }, (_, i) => tile({ id: `t${i}aa`, config: {} }))),
    ).toThrow(RangeError);
  });

  it('writes 20 tiles of the kind the plan names (a service id and a short list) in well under 8 KiB', () => {
    const service = '0198fe7e-31d2-7c57-9b36-0123456789ab';
    const items = Array.from({ length: 20 }, (_, i) =>
      tile({
        id: `k${String(i).padStart(2, '0')}x9a2`,
        widget: 'kpi.analytics.trends',
        x: (i % 2) * 6,
        y: Math.floor(i / 2) * 4,
        config: {
          service,
          range: '1y',
          category: 'Usage',
          cumulative: false,
          hidden: ['kpi-a', 'kpi-b'],
          secondary: [],
        },
      }),
    );
    const size = new TextEncoder().encode(JSON.stringify(serialiseDashboard(items))).length;
    expect(size).toBeLessThan(MAX_DOCUMENT_BYTES);
  });
});

describe('migrate', () => {
  it('returns a document of the current version as it is', () => {
    const document = { version: 1, items: [] };
    expect(migrate(1, document)).toBe(document);
  });

  it.each([[2], [99], [0], [-1], [1.5], ['1'], [null], [undefined], [Number.NaN]])(
    'does not know version %s and does not guess',
    (version) => {
      expect(migrate(version, { version, items: [] })).toBeUndefined();
    },
  );
});

describe('pack', () => {
  const box = (id: string, x: number, y: number, w = 4, h = 2) => ({ id, x, y, w, h });
  it('leaves a layout with no overlap as it is, by row and column', () => {
    const layout = [box('b', 4, 0), box('a', 0, 0), box('c', 0, 5)];
    expect(pack(layout).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(pack(layout).map((item) => item.y)).toEqual([0, 0, 5]);
  });

  it('pushes a tile below everything that is in its way, one after the other', () => {
    const packed = pack([box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)]);
    expect(packed.map((item) => [item.id, item.y])).toEqual([
      ['a', 0],
      ['b', 2],
      ['c', 4],
    ]);
  });

  it('treats tiles that only touch as not overlapping', () => {
    expect(pack([box('a', 0, 0), box('b', 4, 0), box('c', 0, 2)]).map((item) => item.y)).toEqual([
      0, 0, 2,
    ]);
  });
});

// ---- properties -------------------------------------------------------------------------------------------

const SEED = 20261020;
const RUNS = 300;

// Numbers that JSON can carry: the stored document is JSON, so these are what a repair has to deal with.
const number = fc.oneof(
  fc.integer({ min: -3, max: 14 }),
  fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
  fc.double({ min: -50, max: 50, noNaN: true }),
);
const junkNumber = fc.oneof(
  number,
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  fc.string({ maxLength: 3 }),
  fc.constant(null),
);
const identifier = fc.oneof(
  fc.stringMatching(/^[a-z0-9]{4,12}$/),
  fc.constantFrom('aaaa', 'bbbb', 'cccc'),
  fc.string({ maxLength: 70 }),
);
const widget = fc.constantFrom(
  'fix.card',
  'fix.trends',
  'fix.single',
  'fix.notes',
  'fix.bell',
  'fix.admin',
  'fix.gone',
);
const config = fc.oneof(
  fc.constant({}),
  fc.record({ range: fc.oneof(fc.constantFrom('3m', '1y', 'all'), fc.string({ maxLength: 8 })) }),
  fc.record({ text: fc.string({ maxLength: 500 }) }),
  fc.dictionary(fc.string({ maxLength: 6 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 6 }),
);
const junkConfig = fc.oneof(config, fc.jsonValue({ maxDepth: 3 }), fc.string(), fc.constant(null));
const rawTile = fc.record({
  id: identifier,
  widget,
  x: number,
  y: number,
  w: number,
  h: number,
  config,
});
const junkTile = fc.record({
  id: identifier,
  widget,
  x: junkNumber,
  y: junkNumber,
  w: junkNumber,
  h: junkNumber,
  config: junkConfig,
});
// Mostly documents of the right shape (so the repairs run), some with the wrong one (so the reset runs).
const rawDoc = fc.record({ version: fc.constant(1), items: fc.array(rawTile, { maxLength: 24 }) });
const junkDoc = fc.record({
  version: fc.oneof(fc.constant(1), fc.integer({ min: -2, max: 4 }), fc.constant('1')),
  items: fc.array(junkTile, { maxLength: 30 }),
});
const anything = fc.oneof(
  { weight: 8, arbitrary: rawDoc },
  { weight: 2, arbitrary: junkDoc },
  { weight: 2, arbitrary: fc.anything({ maxDepth: 3 }) },
  { weight: 1, arbitrary: fc.jsonValue({ maxDepth: 4 }) },
);

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const byId = new Map(entries.map((entry) => [entry.id, entry]));

function expectValid(items: DashboardItem[]) {
  expect(items.length).toBeLessThanOrEqual(MAX_ITEMS);
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  const singles = new Set<string>();
  for (const item of items) {
    expect(item.id).toMatch(/^[a-z0-9]{4,12}$/);
    const entry = byId.get(item.widget)!;
    expect(entry.slot).toBe('dashboard');
    expect(may(entry)).toBe(true);
    if (entry.grid?.singleton) {
      expect(singles.has(entry.id)).toBe(false);
      singles.add(entry.id);
    }
    for (const value of [item.x, item.y, item.w, item.h])
      expect(Number.isInteger(value)).toBe(true);
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.x + item.w).toBeLessThanOrEqual(12);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.w).toBeGreaterThanOrEqual(entry.grid?.minW ?? 1);
    expect(item.w).toBeLessThanOrEqual(Math.min(entry.grid?.maxW ?? 12, 12));
    expect(item.h).toBeGreaterThanOrEqual(entry.grid?.minH ?? 1);
    expect(item.h).toBeLessThanOrEqual(entry.grid?.maxH ?? 50);
    expect(bytesOf(item.config)).toBeLessThanOrEqual(400);
    if (entry.configSchema) expect(entry.configSchema.safeParse(item.config).success).toBe(true);
    else expect(item.config).toEqual({});
  }
  for (const [i, a] of items.entries()) {
    for (const b of items.slice(i + 1)) {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart).toBe(true);
    }
  }
  expect(bytesOf(serialiseDashboard(items))).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
}

describe('properties (fast-check)', () => {
  it('any input parses without throwing, into a dashboard that is valid, fits the grid and the cap', () => {
    fc.assert(
      fc.property(anything, (input) => {
        const result = parseDashboard(input, context);
        expectValid(result.items);
        if (result.reset) expect(result.items).toEqual(defaultDashboard(entries, may));
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('repairs a well-formed document tile by tile instead of replacing it', () => {
    let repaired = 0;
    fc.assert(
      fc.property(rawDoc, (input) => {
        const result = parseDashboard(input, context);
        if (input.items.length <= MAX_ITEMS) expect(result.reset).toBe(false);
        if (result.dropped.length > 0 || result.items.length > 0) repaired += 1;
      }),
      { numRuns: RUNS, seed: SEED },
    );
    expect(repaired).toBeGreaterThan(RUNS / 2);
  });

  it('parse(serialise(x)) equals x for every valid dashboard', () => {
    fc.assert(
      fc.property(rawDoc, (input) => {
        const valid = parseDashboard(input, context);
        const back = parseDashboard(serialiseDashboard(valid.items), context);
        expect(back).toEqual({ items: valid.items, dropped: [], reset: false });
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('parsing a parsed document changes nothing', () => {
    fc.assert(
      fc.property(anything, (input) => {
        const once = parseDashboard(input, context);
        const twice = parseDashboard({ version: 1, items: once.items }, context);
        expect(twice.items).toEqual(once.items);
        expect(twice.dropped).toEqual([]);
        expect(twice.reset).toBe(false);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it('the packer leaves no overlap, keeps every tile and moves a tile only down', () => {
    const box = fc.record({
      x: fc.integer({ min: 0, max: 8 }),
      y: fc.integer({ min: 0, max: 20 }),
      w: fc.integer({ min: 1, max: 4 }),
      h: fc.integer({ min: 1, max: 6 }),
    });
    fc.assert(
      fc.property(fc.array(box, { maxLength: 20 }), (boxes) => {
        const tagged = boxes.map((b, id) => ({ ...b, id }));
        const packed = pack(tagged);
        expect(packed).toHaveLength(tagged.length);
        for (const moved of packed) expect(moved.y).toBeGreaterThanOrEqual(tagged[moved.id]!.y);
        for (const [i, a] of packed.entries()) {
          for (const b of packed.slice(i + 1)) {
            expect(
              a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
            ).toBe(true);
          }
        }
        expect(pack(packed)).toEqual(packed);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});
