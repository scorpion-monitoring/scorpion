// The bound of the rows read: a consortium the read refuses as too large is a 422 naming `consortium` at this caller, and another error passes.
import { Invalid, type Actor } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { paths, rejection } from '../test/world.ts';
import { createImpactService } from './impact.ts';

const ID = '0198f9c0-1234-7abc-8def-0123456789ab';
const actor: Actor = { kind: 'anonymous' };
const make = (failure: Error) =>
  createImpactService({
    authz: { require: () => Promise.resolve() },
    settings: { listTerms: () => Promise.resolve([]) },
    organisations: {
      findByIdsAsSystem: () => Promise.resolve([{ id: ID, type: 'consortium' } as never]),
      listConsortiaAsSystem: () => Promise.resolve([]),
    },
    services: {
      listImpactRowsAsSystem: () => Promise.reject(failure),
      findLicencesAsSystem: () => Promise.resolve({}),
    },
  });

describe('a consortium of too many services', () => {
  it('is a 422 naming consortium, never a silent cut', async () => {
    const tooMany = new Invalid('The request is not valid.', [
      {
        in: 'query',
        path: 'organisation',
        message: 'The organisation links more than 2000 services.',
      },
    ]);
    const error = await rejection(make(tooMany).summary(actor, { consortium: ID }));
    expect(error.status).toBe(422);
    expect(paths(error)).toEqual(['query:consortium']);
  });

  it('lets any other failure through unchanged', async () => {
    await expect(make(new Error('boom')).summary(actor, { consortium: ID })).rejects.toThrow(
      'boom',
    );
  });
});
