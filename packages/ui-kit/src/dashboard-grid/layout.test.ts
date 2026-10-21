import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  describeChange,
  dragAnnouncements,
  moveTile,
  newInstanceId,
  placeNew,
  removeTile,
  resizeTile,
  stackedOrder,
  visibleLayout,
  type GridTexts,
  type GridTile,
} from './layout.ts';

const tile = (id: string, x: number, y: number, w: number, h: number, more = {}): GridTile => ({
  id,
  x,
  y,
  w,
  h,
  ...more,
});
const at = (tiles: readonly GridTile[], id: string) => {
  const found = tiles.find((candidate) => candidate.id === id)!;
  return [found.x, found.y, found.w, found.h];
};

describe('stackedOrder', () => {
  it.each([
    [
      'by row, then column',
      [tile('b', 4, 0, 4, 3), tile('a', 0, 0, 4, 3), tile('c', 0, 3, 4, 3)],
      'abc',
    ],
    [
      'a lower tile on the left comes after a higher one on the right',
      [tile('l', 0, 3, 4, 3), tile('r', 8, 0, 4, 3)],
      'rl',
    ],
    ['equal places keep the given order', [tile('p', 0, 0, 4, 3), tile('q', 0, 0, 4, 3)], 'pq'],
    ['nothing', [], ''],
  ])('%s', (_name, tiles, expected) => {
    expect(
      stackedOrder(tiles)
        .map((candidate) => candidate.id)
        .join(''),
    ).toBe(expected);
  });

  it('does not change what it is given', () => {
    const tiles = [tile('b', 4, 0, 4, 3), tile('a', 0, 0, 4, 3)];
    stackedOrder(tiles);
    expect(tiles.map((candidate) => candidate.id)).toEqual(['b', 'a']);
  });
});

describe('placeNew', () => {
  it.each([
    ['an empty dashboard', [], { x: 0, y: 0 }],
    [
      'below the lowest tile, at the left edge',
      [tile('a', 0, 0, 4, 3), tile('b', 4, 0, 4, 5)],
      { x: 0, y: 5 },
    ],
    ['below a tile that starts low', [tile('a', 8, 4, 4, 2)], { x: 0, y: 6 }],
  ])('%s', (_name, tiles, expected) => {
    expect(placeNew(tiles)).toEqual(expected);
  });
});

describe('moveTile', () => {
  const row = [tile('a', 0, 0, 4, 3), tile('b', 4, 0, 4, 3), tile('c', 8, 0, 4, 3)];

  it.each([
    [
      'right into a free column',
      'a',
      'right',
      [tile('a', 0, 0, 3, 3), tile('b', 6, 0, 2, 3)],
      [1, 0],
    ],
    ['left', 'b', 'left', [tile('a', 0, 0, 2, 3), tile('b', 3, 0, 2, 3)], [2, 0]],
  ] as const)('%s', (_name, id, direction, tiles, expected) => {
    const result = moveTile(tiles, id, direction);
    expect(result.ok).toBe(true);
    if (result.ok) expect([result.tile.x, result.tile.y]).toEqual(expected);
  });

  it.each([
    ['left of the first column', 'a', 'left'],
    ['right of the last column', 'c', 'right'],
    ['above the first row', 'a', 'up'],
    ['down from the last row, where it would rise again', 'a', 'down'],
  ] as const)('refuses %s', (_name, id, direction) => {
    const result = moveTile(row, id, direction);
    expect(result).toMatchObject({ ok: false, reason: 'edge' });
  });

  it('keeps a tile wider than the free space inside the twelve columns', () => {
    const wide = [tile('a', 6, 0, 6, 2)];
    expect(moveTile(wide, 'a', 'right')).toMatchObject({ ok: false, reason: 'edge' });
    expect(moveTile([tile('a', 5, 0, 6, 2)], 'a', 'right')).toMatchObject({ ok: true });
  });

  it('moves down past a tile below, and the two swap', () => {
    const stack = [tile('a', 0, 0, 4, 2), tile('b', 0, 2, 4, 3)];
    const result = moveTile(stack, 'a', 'down');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The moved tile holds its new row; `b` makes room and the whole stack settles.
      expect(at(result.tiles, 'a')).toEqual([0, 3, 4, 2]);
      expect(at(result.tiles, 'b')).toEqual([0, 0, 4, 3]);
    }
  });

  it('moves up past a tile above, and the two swap', () => {
    const stack = [tile('a', 0, 0, 4, 2), tile('b', 0, 2, 4, 3)];
    const result = moveTile(stack, 'b', 'up');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The two swap places, as they do when one is dragged over the other.
      expect(at(result.tiles, 'b')).toEqual([0, 0, 4, 3]);
      expect(at(result.tiles, 'a')).toEqual([0, 3, 4, 2]);
    }
  });

  it('passes a tile in the row to the next free place, and refuses when there is none', () => {
    const two = [tile('a', 0, 0, 4, 3), tile('b', 4, 0, 4, 3)];
    const passed = moveTile(two, 'a', 'right');
    expect(passed.ok && at(passed.tiles, 'a')).toEqual([8, 0, 4, 3]);
    expect(moveTile(row, 'a', 'right')).toMatchObject({ ok: false, reason: 'edge' });
    // Nothing is free to the left of the first tile, so the second cannot pass it.
    expect(moveTile(two, 'b', 'left')).toMatchObject({ ok: false, reason: 'edge' });
  });

  it('says so for a tile that is not there', () => {
    expect(moveTile(row, 'nope', 'left')).toEqual({
      ok: false,
      reason: 'unknown',
      tile: undefined,
    });
  });

  it('never leaves an overlap, a tile outside the grid, or a lost tile (property)', () => {
    const direction = fc.constantFrom('left', 'right', 'up', 'down' as const);
    fc.assert(
      fc.property(fc.array(direction, { minLength: 1, maxLength: 25 }), (steps) => {
        let tiles: GridTile[] = [
          tile('a', 0, 0, 4, 3),
          tile('b', 4, 0, 4, 2),
          tile('c', 8, 0, 4, 4),
          tile('d', 0, 3, 6, 2),
        ];
        for (const [index, step] of steps.entries()) {
          const result = moveTile(tiles, 'abcd'[index % 4]!, step);
          if (result.ok) tiles = result.tiles;
        }
        expect(tiles).toHaveLength(4);
        for (const one of tiles) {
          expect(one.x).toBeGreaterThanOrEqual(0);
          expect(one.x + one.w).toBeLessThanOrEqual(12);
          for (const other of tiles) {
            if (one === other) continue;
            const apart =
              one.x + one.w <= other.x ||
              other.x + other.w <= one.x ||
              one.y + one.h <= other.y ||
              other.y + other.h <= one.y;
            expect(apart).toBe(true);
          }
        }
      }),
    );
  });
});

describe('resizeTile', () => {
  const limits = { minW: 3, maxW: 8, minH: 2, maxH: 6 };
  const base = tile('a', 0, 0, 4, 3, limits);

  it.each([
    ['wider', [5, 3]],
    ['narrower', [3, 3]],
    ['taller', [4, 4]],
    ['shorter', [4, 2]],
  ] as const)('%s by one cell', (direction, size) => {
    const result = resizeTile([base], 'a', direction);
    expect(result.ok).toBe(true);
    if (result.ok) expect([result.tile.w, result.tile.h]).toEqual(size);
  });

  it.each([
    ['below the minimum width', tile('a', 0, 0, 3, 3, limits), 'narrower'],
    ['above the maximum width', tile('a', 0, 0, 8, 3, limits), 'wider'],
    ['below the minimum height', tile('a', 0, 0, 4, 2, limits), 'shorter'],
    ['above the maximum height', tile('a', 0, 0, 4, 6, limits), 'taller'],
    ['past the right edge of the grid', tile('a', 8, 0, 4, 3), 'wider'],
  ] as const)('refuses %s', (_name, one, direction) => {
    expect(resizeTile([one], 'a', direction)).toMatchObject({ ok: false, reason: 'limit' });
  });

  it('pushes the tile below down when it grows into it', () => {
    const stack = [tile('a', 0, 0, 4, 2), tile('b', 0, 2, 4, 2)];
    const result = resizeTile(stack, 'a', 'taller');
    expect(result.ok).toBe(true);
    if (result.ok) expect(at(result.tiles, 'b')).toEqual([0, 3, 4, 2]);
  });
});

describe('removeTile and visibleLayout', () => {
  it('lets the tiles below rise after a removal', () => {
    const tiles = removeTile([tile('a', 0, 0, 4, 2), tile('b', 0, 2, 4, 2)], 'a');
    expect(at(tiles, 'b')).toEqual([0, 0, 4, 2]);
  });

  it('gives a tile that draws nothing no height, so the ones below rise, and keeps the others', () => {
    const tiles = [tile('a', 0, 0, 4, 3), tile('b', 0, 3, 4, 3), tile('c', 4, 0, 4, 3)];
    const shown = visibleLayout(tiles, new Set(['a']));
    expect(at(shown, 'b')).toEqual([0, 0, 4, 3]);
    expect(at(shown, 'c')).toEqual([4, 0, 4, 3]);
    expect(shown.find((candidate) => candidate.id === 'a')!.h).toBe(0);
    expect(tiles[0]!.h).toBe(3);
  });

  it('closes the width a tile that draws nothing leaves in its row, when the places are free', () => {
    const row = [tile('m', 0, 0, 4, 3), tile('p', 4, 0, 4, 3), tile('d', 8, 0, 4, 3)];
    const shown = visibleLayout(row, new Set(['m']));
    expect(at(shown, 'p')).toEqual([0, 0, 4, 3]);
    expect(at(shown, 'd')).toEqual([4, 0, 4, 3]);
    const two = visibleLayout(row, new Set(['m', 'p']));
    expect(at(two, 'd')).toEqual([0, 0, 4, 3]);
    // A tile below the row does not slide sideways (it rises into the room the row leaves).
    const below = visibleLayout([...row, tile('z', 8, 5, 4, 2)], new Set(['m']));
    expect(at(below, 'z')).toEqual([8, 0, 4, 2]);
  });

  it('keeps a tile where it is when sliding it would cover another', () => {
    const tiles = [tile('a', 0, 0, 4, 3), tile('b', 0, 3, 4, 3), tile('c', 4, 0, 4, 3)];
    const shown = visibleLayout(tiles, new Set(['a']));
    expect(at(shown, 'b')).toEqual([0, 0, 4, 3]);
    expect(at(shown, 'c')).toEqual([4, 0, 4, 3]);
  });

  it('is the layout itself when nothing is empty and it has no gaps', () => {
    const tiles = [tile('a', 0, 0, 4, 3), tile('b', 4, 0, 4, 3)];
    expect(visibleLayout(tiles, new Set())).toEqual(tiles);
  });
});

describe('newInstanceId', () => {
  it('is eight lower-case letters and digits, as the document wants', () => {
    expect(newInstanceId(new Set())).toMatch(/^[a-z0-9]{8}$/);
  });

  it('draws again on a collision', () => {
    let call = 0;
    const fill = (bytes: Uint8Array) => bytes.fill(call++ === 0 ? 0 : 1);
    expect(newInstanceId(new Set(['aaaaaaaa']), fill)).toBe('bbbbbbbb');
  });

  it('discards the bytes that would make some characters likelier', () => {
    // 252 is the first byte above the largest multiple of 36 below 256 (252 = 7 * 36).
    let call = 0;
    const fill = (bytes: Uint8Array) => bytes.fill(call++ === 0 ? 255 : 35);
    expect(newInstanceId(new Set(), fill)).toBe('99999999');
  });

  it('uses crypto and not Math.random by default', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random was called');
    };
    try {
      expect(newInstanceId(new Set())).toHaveLength(8);
    } finally {
      Math.random = original;
    }
  });
});

describe('the announcements', () => {
  const texts: GridTexts = {
    moved: (name, row, column) => `${name} moved to row ${row}, column ${column}`,
    resized: (name, width, height) => `${name} is now ${width} wide and ${height} high`,
    pickedUp: (name) => `Picked up ${name}`,
    cancelled: (name) => `Cancelled ${name}`,
    atEdge: (name) => `${name} cannot move further`,
    atLimit: (name) => `${name} cannot be resized further`,
    removed: (name, left) => `${name} removed, ${left} left`,
  };

  it('counts rows and columns from 1, as people do', () => {
    expect(describeChange(texts, 'Trends', { x: 6, y: 1, w: 6, h: 4 }, 'move')).toBe(
      'Trends moved to row 2, column 7',
    );
    expect(describeChange(texts, 'Trends', { x: 6, y: 1, w: 6, h: 4 }, 'resize')).toBe(
      'Trends is now 6 wide and 4 high',
    );
  });

  it('says what a keyboard drag does in the words of the page, and nothing for a plain drop', () => {
    const say = dragAnnouncements(texts, (id) => `Tile ${id}`);
    expect(say.dragstart({ operation: { source: { id: 'abc' } } })).toBe('Picked up Tile abc');
    expect(say.dragstart({ operation: { source: null } })).toBeUndefined();
    expect(say.dragend({ operation: { source: { id: 'abc' } }, canceled: true })).toBe(
      'Cancelled Tile abc',
    );
    // A drop is announced with the new place by the page (`describeChange`), so dnd-kit stays silent.
    expect(say.dragend({ operation: { source: { id: 'abc' } }, canceled: false })).toBeUndefined();
  });
});
