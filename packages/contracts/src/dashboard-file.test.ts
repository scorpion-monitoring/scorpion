import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FILE_FORMAT,
  dashboardFile,
  dashboardFileName,
  MAX_DASHBOARD_FILE_BYTES,
  readDashboardFile,
} from './dashboard-file.ts';

const item = {
  id: 'abcd',
  widget: 'kpi.analytics.trends',
  x: 4,
  y: 3,
  w: 8,
  h: 5,
  config: { range: '1y', category: 'all' },
};

describe('dashboardFile', () => {
  it('writes the format, the version and the known keys of each tile only, in a fixed order', () => {
    const extra = { ...item, secret: 'not exported' } as typeof item;
    const file = dashboardFile([extra]);
    expect(file).toEqual({ format: DASHBOARD_FILE_FORMAT, version: 1, items: [item] });
    expect(JSON.stringify(file)).not.toContain('not exported');
    expect(Object.keys(file.items[0]!)).toEqual(['id', 'widget', 'x', 'y', 'w', 'h', 'config']);
  });

  it('is read back as the same file', () => {
    const file = dashboardFile([item]);
    expect(readDashboardFile(JSON.stringify(file))).toEqual({ ok: true, file });
  });
});

describe('dashboardFileName', () => {
  it('names the file after the local date', () => {
    expect(dashboardFileName(new Date(2026, 0, 5, 23, 59))).toBe('dashboard-2026-01-05.json');
  });
});

describe('readDashboardFile', () => {
  const good = { format: DASHBOARD_FILE_FORMAT, version: 1, items: [] };
  it.each([
    ['not JSON', '{nope', 'not-json'],
    ['an array', '[]', 'not-dashboard'],
    ['null', 'null', 'not-dashboard'],
    ['another format', JSON.stringify({ ...good, format: 'other' }), 'not-dashboard'],
    ['no items', JSON.stringify({ format: DASHBOARD_FILE_FORMAT, version: 1 }), 'not-dashboard'],
    ['items not a list', JSON.stringify({ ...good, items: {} }), 'not-dashboard'],
    ['version 0', JSON.stringify({ ...good, version: 0 }), 'not-dashboard'],
    ['a fractional version', JSON.stringify({ ...good, version: 1.5 }), 'not-dashboard'],
    ['a newer version', JSON.stringify({ ...good, version: 2 }), 'newer-version'],
    ['too large', ' '.repeat(MAX_DASHBOARD_FILE_BYTES + 1), 'too-large'],
  ])('refuses %s', (_name, text, reason) => {
    expect(readDashboardFile(text)).toEqual({ ok: false, reason });
  });

  it('accepts an empty dashboard', () => {
    expect(readDashboardFile(JSON.stringify(good))).toEqual({ ok: true, file: good });
  });
});
