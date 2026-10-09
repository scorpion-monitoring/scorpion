import type { UiLoadContext } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { loadDocs } from './docs.ts';

const context = (paths: Record<string, unknown>) =>
  ({ publicApi: { openapi: '3.1.0', info: { title: 't', version: '1' }, paths } }) as UiLoadContext;

describe('loadDocs', () => {
  it('lists no operation for a document without paths', () => {
    expect(loadDocs(context({}))).toEqual({ operations: [] });
  });

  it('lists the operations by path then method, with how they are guarded', () => {
    const { operations } = loadDocs(
      context({
        '/services': {
          post: { summary: 'Create', 'x-permission': 'registry.service.create' },
          get: { summary: 'List', 'x-public': true },
        },
        '/a': { get: { description: 'Read a', 'x-permission': 'm.a.read' }, parameters: [] },
      }),
    );
    expect(operations).toEqual([
      { method: 'get', path: '/a', summary: 'Read a', public: false, permission: 'm.a.read' },
      { method: 'get', path: '/services', summary: 'List', public: true, permission: null },
      {
        method: 'post',
        path: '/services',
        summary: 'Create',
        public: false,
        permission: 'registry.service.create',
      },
    ]);
  });
});
