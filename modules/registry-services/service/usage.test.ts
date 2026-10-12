// The contributions to other modules' registries, with the real entries: `org.usage` (an organisation
// with services cannot be deleted and its type cannot change) and the `usage` of the `stage` vocabulary.
import type { Actor, DomainError } from '@scorpion/contracts';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';

const h = useServices();

/** What the tests use of the organisation service and of the vocabularies; the services are reached through the kernel. */
interface OrganisationsAdmin {
  delete(actor: Actor, id: string): Promise<void>;
  update(actor: Actor, id: string, input: unknown): Promise<{ type: string }>;
}
interface Vocabularies {
  createTerm(actor: Actor, vocabulary: string, input: unknown): Promise<unknown>;
  removeTerm(actor: Actor, vocabulary: string, key: string): Promise<{ outcome: string }>;
}
type Started = Awaited<ReturnType<typeof h.start>>;
const organisationsOf = (s: Started): OrganisationsAdmin => {
  const service: unknown = s.kernel.services.get('registry.organisations');
  return service as OrganisationsAdmin;
};
const vocabulariesOf = (s: Started): Vocabularies => {
  const settings: unknown = s.kernel.services.get('core.settings');
  return (settings as { vocabularies: Vocabularies }).vocabularies;
};

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('the call resolved; it should have been refused');
}

describe('org.usage', () => {
  it('blocks the delete of an organisation that a service uses, naming this module, in every role', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const organisations = organisationsOf(s);
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const consortium = await makeOrganisation(s.pool, { type: 'consortium' });
    const spare = await makeOrganisation(s.pool, { type: 'provider' });
    await makeService(s.pool, { provider: provider.id, consortia: [consortium.id] });
    for (const used of [provider, consortium]) {
      const error = await rejection(organisations.delete(admin, used.id));
      expect(error).toMatchObject({ status: 409, type: 'organisation-in-use' });
      expect(error.message).toContain('registry.services');
    }
    await organisations.delete(admin, spare.id); // no service uses it
    const { rows } = await s.pool.query('select id from org_organisation');
    expect(rows).toHaveLength(2);
  });

  it('blocks a change of type while a service refers to the organisation, and allows it without one', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const organisations = organisationsOf(s);
    const used = await makeOrganisation(s.pool, { type: 'provider' });
    const free = await makeOrganisation(s.pool, { type: 'provider' });
    await makeService(s.pool, { provider: used.id });
    await expect(
      organisations.update(admin, used.id, { type: 'consortium' }),
    ).rejects.toMatchObject({
      status: 409,
      type: 'organisation-in-use',
    });
    expect((await organisations.update(admin, free.id, { type: 'consortium' })).type).toBe(
      'consortium',
    );
  });

  it('lets the organisation go once the last service link is gone', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const organisations = organisationsOf(s);
    const org = await makeOrganisation(s.pool, { type: 'provider' });
    const service = await makeService(s.pool, { provider: org.id });
    await expect(organisations.delete(admin, org.id)).rejects.toMatchObject({ status: 409 });
    await s.pool.query('delete from svc_service where id = $1', [service.id]);
    await organisations.delete(admin, org.id);
  });
});

describe('the usage of the stage vocabulary', () => {
  it('deactivates a term that a service uses instead of deleting it, and refuses it for new services', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const vocabularies = vocabulariesOf(s);
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    await vocabularies.createTerm(admin, 'stage', { key: 'BETA', labels: { en: 'Beta' } });
    await vocabularies.createTerm(admin, 'stage', { key: 'ALPHA', labels: { en: 'Alpha' } });
    const created = await s.services.create(admin, {
      slug: 'beta-svc',
      name: 'Beta service',
      provider: provider.id,
      stage: 'BETA',
    });
    expect((await vocabularies.removeTerm(admin, 'stage', 'BETA')).outcome).toBe('deactivated');
    expect((await vocabularies.removeTerm(admin, 'stage', 'ALPHA')).outcome).toBe('deleted');
    // The service keeps its stage; a new one cannot take the deactivated term.
    expect((await s.services.get(admin, created.id)).stage).toBe('BETA');
    await expect(
      s.services.create(admin, {
        slug: 'beta-2',
        name: 'Beta 2',
        provider: provider.id,
        stage: 'BETA',
      }),
    ).rejects.toMatchObject({ status: 422, errors: [{ path: 'stage' }] });
  });

  it('accepts a term an administrator adds, and every seeded stage', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const vocabularies = vocabulariesOf(s);
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    await vocabularies.createTerm(admin, 'stage', { key: 'PILOT', labels: { en: 'Pilot' } });
    for (const stage of ['DEV', 'DEMO', 'PROD', 'TERM', 'PILOT']) {
      const created = await s.services.create(admin, {
        slug: `stage-${stage.toLowerCase()}`,
        name: stage,
        provider: provider.id,
        stage,
      });
      expect(created.stage).toBe(stage);
    }
  });
});
