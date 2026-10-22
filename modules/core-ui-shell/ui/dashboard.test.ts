import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@scorpion/contracts/client';
import {
  applyTiles,
  canAdd,
  createAutosave,
  defaultItems,
  newItem,
  placeable,
  problemOf,
  toTiles,
  type Entry,
  type Item,
} from './dashboard.ts';

const entry = (id: string, more: Partial<Entry> = {}): Entry => ({
  id,
  slot: 'dashboard',
  component: id,
  order: 10,
  ...more,
});
const item = (id: string, widget: string, x = 0, y = 0, w = 4, h = 3): Item => ({
  id,
  widget,
  x,
  y,
  w,
  h,
  config: {},
});

describe('the tiles of the grid and the items of the document', () => {
  const entries = new Map([
    ['a.card', entry('a.card', { grid: { w: 6, h: 4, minW: 3, maxW: 9, minH: 2 } })],
    ['b.old', entry('b.old')],
  ]);

  it('give each tile the limits of its widget, and none to a widget without a grid', () => {
    const tiles = toTiles(
      [item('aaaa', 'a.card'), item('bbbb', 'b.old'), item('cccc', 'gone')],
      entries,
    );
    expect(tiles[0]).toMatchObject({ id: 'aaaa', minW: 3, maxW: 9, minH: 2, maxH: undefined });
    expect(tiles[1]).toMatchObject({ id: 'bbbb', minW: undefined });
    expect(tiles[2]).toMatchObject({ id: 'cccc', minW: undefined });
  });

  it('write the new positions back, keep the widget and the settings, and drop what the grid dropped', () => {
    const items = [{ ...item('aaaa', 'a.card'), config: { range: '1y' } }, item('bbbb', 'b.old')];
    const next = applyTiles(items, [{ id: 'aaaa', x: 6, y: 2, w: 5, h: 4 }]);
    expect(next).toEqual([
      { id: 'aaaa', widget: 'a.card', x: 6, y: 2, w: 5, h: 4, config: { range: '1y' } },
    ]);
  });
});

describe('what can be added', () => {
  it.each([
    ['a plain widget', entry('x'), [], { ok: true }],
    [
      'a singleton that is not there yet',
      entry('s', { grid: { w: 4, h: 3, singleton: true } }),
      [item('aaaa', 'x')],
      { ok: true },
    ],
    [
      'a singleton that is already there',
      entry('s', { grid: { w: 4, h: 3, singleton: true } }),
      [item('aaaa', 's')],
      { ok: false, reason: 'singleton' },
    ],
    [
      'a twenty-first tile',
      entry('x'),
      Array.from({ length: 20 }, (_, i) => item(`t${String(i).padStart(3, '0')}`, 'x')),
      { ok: false, reason: 'full' },
    ],
    [
      'the twentieth tile',
      entry('x'),
      Array.from({ length: 19 }, (_, i) => item(`t${String(i).padStart(3, '0')}`, 'x')),
      { ok: true },
    ],
  ])('%s', (_name, widget, items, expected) => {
    expect(canAdd(widget, items)).toEqual(expected);
  });

  it('keeps only the entries of the dashboard slot', () => {
    const navigation = {
      nav: [],
      routes: [],
      themes: [],
      widgets: [entry('card'), entry('bell', { slot: 'header' })],
    };
    expect(placeable(navigation).map((one) => one.id)).toEqual(['card']);
  });

  it('puts a new tile at the widget size where it is told, with a fresh id and no settings', () => {
    const made = newItem(
      entry('x', { grid: { w: 6, h: 5 } }),
      [item('aaaaaaaa', 'x')],
      { x: 0, y: 7 },
      (bytes) => bytes.fill(2),
    );
    expect(made).toEqual({ id: 'cccccccc', widget: 'x', x: 0, y: 7, w: 6, h: 5, config: {} });
    expect(newItem(entry('old'), [], { x: 0, y: 0 })).toMatchObject({ w: 4, h: 3 });
  });
});

describe('the default dashboard', () => {
  it('is what the server would build from the same entries: placements by row and column, deterministic ids', () => {
    const entries = [
      entry('b', { order: 20, grid: { w: 4, h: 3, default: { x: 4, y: 0, w: 4, h: 3 } } }),
      entry('a', { order: 10, grid: { w: 4, h: 3, default: { x: 0, y: 0, w: 4, h: 3 } } }),
      entry('nodefault'),
      entry('bell', { slot: 'header', grid: { w: 1, h: 1, default: { x: 0, y: 5, w: 1, h: 1 } } }),
    ];
    const items = defaultItems(entries);
    expect(items.map((one) => [one.widget, one.x, one.y])).toEqual([
      ['a', 0, 0],
      ['b', 4, 0],
    ]);
    expect(defaultItems(entries).map((one) => one.id)).toEqual(items.map((one) => one.id));
    expect(new Set(items.map((one) => one.id)).size).toBe(2);
  });
});

describe('what a failed save means', () => {
  const failure = (status: number, errors: { path: string; message: string }[] = []) =>
    new ApiError(status, { type: 'about:blank', title: 't', status, errors });

  it.each([
    ['a missing permission', failure(403), 'forbidden'],
    [
      'a document that does not fit',
      failure(422, [{ path: 'items', message: 'too large' }]),
      'too-large',
    ],
    ['a widget that is gone', failure(422, [{ path: 'items[2].widget', message: 'no' }]), 'repair'],
    [
      'a widget that is gone and a document that does not fit',
      failure(422, [
        { path: 'items', message: 'a' },
        { path: 'items[0].widget', message: 'b' },
      ]),
      'repair',
    ],
    ['a 422 that names nothing', failure(422), 'repair'],
    ['a server error', failure(500), 'failed'],
    ['a throttled call', failure(429), 'failed'],
    ['no network', new TypeError('fetch failed'), 'failed'],
  ])('%s', (_name, error, expected) => {
    expect(problemOf(error)).toBe(expected);
  });
});

describe('the autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends one save a second after the last change of a burst, with the last value', async () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createAutosave<number>({ save });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule(3);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save.mock.calls).toEqual([[3]]);
    expect(saver.state).toBe('saved');
  });

  it('saves nothing when nothing changed', async () => {
    const save = vi.fn(() => Promise.resolve());
    createAutosave<number>({ save });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not retry by itself after a failure, and keeps the value for a retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue(undefined);
    const states: string[] = [];
    const saver = createAutosave<number>({ save, onState: (state) => states.push(state) });
    saver.schedule(7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saver.state).toBe('failed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    await saver.retry();
    expect(save.mock.calls).toEqual([[7], [7]]);
    expect(saver.state).toBe('saved');
    expect(states).toEqual(['pending', 'saving', 'failed', 'saving', 'saved']);
  });

  it('treats a change after a failure as the next attempt, once', async () => {
    const save = vi.fn().mockRejectedValue(new Error('no'));
    const saver = createAutosave<number>({ save });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(save.mock.calls).toEqual([[1], [2]]);
  });

  it('waits for a save that is running and then saves the change made meanwhile, in its own burst', async () => {
    let finish!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockResolvedValue(undefined);
    const saver = createAutosave<number>({ save });
    saver.schedule(1);
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(save.mock.calls).toEqual([[1], [2]]);
    expect(saver.state).toBe('saved');
  });

  it('flushes at once what is waiting (the person is leaving), and flushes nothing twice', async () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createAutosave<number>({ save });
    saver.schedule(4);
    await saver.flush();
    await saver.flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save.mock.calls).toEqual([[4]]);
  });

  it('does nothing after dispose', async () => {
    const save = vi.fn(() => Promise.resolve());
    const saver = createAutosave<number>({ save });
    saver.schedule(1);
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
