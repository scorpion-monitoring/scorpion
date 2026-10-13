// Defect 14 of FEATURES §5 (service part): "unknown references cause a 500". Through the whole pipeline over
// real Postgres, every reference a create can carry that is wrong answers a 4xx that names the field: 403 for a
// provider the caller is not a member of (decided before the body is read, so a member learns nothing about
// which organisations exist), 422 for an unknown or wrongly typed organisation, stage and licence, for a
// malformed id and for a key no field owns. Never a 5xx, and nothing is written. The wizard sends exactly this
// body, so what it shows on a field is what the server says here.
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
interface Problem {
  status: number;
  errors?: { path: string; message: string }[];
}

async function world() {
  const s = await app.start();
  const pool = s.kernel.pool;
  const mine = await makeOrganisation(pool, { type: 'provider' });
  const theirs = await makeOrganisation(pool, { type: 'provider' });
  const consortium = await makeOrganisation(pool, { type: 'consortium' });
  const admin = await s.signedIn('adminy', { roles: ['admin'] });
  const member = await s.signedIn('memmy');
  await makeMembership(pool, { organisationId: mine.id, userId: member.user.id, role: 'member' });
  const services = async () =>
    Number(
      (await pool.query<{ n: string }>('select count(*)::text as n from svc_service')).rows[0]!.n,
    );
  const links = async () =>
    Number(
      (await pool.query<{ n: string }>('select count(*)::text as n from svc_service_organisation'))
        .rows[0]!.n,
    );
  const create = (who: typeof admin, body: unknown) =>
    s.call('POST', '/services', { ...as(who), body });
  return { s, mine, theirs, consortium, admin, member, create, services, links };
}

let n = 0;
const slug = () => `d14-${++n}-${Math.random().toString(36).slice(2, 6)}`;

describe('defect 14: a reference that is wrong is a 4xx on its field, never a 500', () => {
  it('answers 403 for a provider the caller is not a member of and for one nobody has, and 422 for a malformed id, and writes nothing', async () => {
    const { member, theirs, consortium, create, services, links } = await world();
    for (const provider of [theirs.id, consortium.id, ABSENT]) {
      const reply = await create(member, { slug: slug(), name: 'x', provider });
      expect(reply.status, provider).toBe(403);
    }
    // A malformed id is refused by the route's own schema, before the service is asked.
    const malformed = await create(member, { slug: slug(), name: 'x', provider: 'not-an-id' });
    expect(malformed.status).toBe(422);
    expect(await services()).toBe(0);
    expect(await links()).toBe(0);
  });

  it('answers 422 naming the field for an administrator’s unknown or wrongly typed organisation, stage, licence and key', async () => {
    const { admin, mine, consortium, create, services } = await world();
    const cases: [string, Record<string, unknown>, string][] = [
      ['an unknown provider', { provider: ABSENT }, 'provider'],
      ['a consortium as the provider', { provider: consortium.id }, 'provider'],
      ['a malformed provider', { provider: 'not-an-id' }, 'provider'],
      ['an unknown consortium', { provider: mine.id, consortia: [ABSENT] }, 'consortia.0'],
      ['a provider as a consortium', { provider: mine.id, consortia: [mine.id] }, 'consortia.0'],
      ['an unknown stage', { provider: mine.id, stage: 'NOPE' }, 'stage'],
      ['an unknown licence', { provider: mine.id, license: 'No-Such-1.0' }, 'license'],
      ['a key no field owns', { provider: mine.id, colour: 'red' }, 'colour'],
      ['the icon in the body', { provider: mine.id, icon: 'x' }, 'icon'],
      [
        'a half contact point',
        { provider: mine.id, contact: { email: 'a@example.org' } },
        'contact.type',
      ],
    ];
    for (const [label, extra, path] of cases) {
      const reply = await create(admin, { slug: slug(), name: 'x', ...extra });
      expect(reply.status, label).toBe(422);
      const problem = reply.body as Problem;
      expect(
        problem.errors?.map((e) => e.path),
        label,
      ).toContain(path);
    }
    expect(await services()).toBe(0);
  });

  it('is never a server error, whatever the body is', async () => {
    const { admin, member, create } = await world();
    const bodies: unknown[] = [
      {},
      { slug: null, name: null, provider: null },
      { slug: 1, name: [], provider: {} },
      { slug: 'a', name: 'b', provider: ABSENT, consortia: 'x' },
      { slug: 'a', name: 'b', provider: ABSENT, consortia: [1, null] },
      { slug: 'a', name: 'b', provider: ABSENT, sameAs: [{}] },
      { slug: 'a', name: 'b', provider: ABSENT, contact: 'x' },
      { slug: 'a', name: 'b', provider: ABSENT, contact: { email: 1, type: [] } },
    ];
    for (const body of bodies) {
      for (const who of [admin, member]) {
        const reply = await create(who, body);
        expect(reply.status, JSON.stringify(body)).toBeLessThan(500);
        expect([403, 422]).toContain(reply.status);
      }
    }
  });

  it('lets the member create for their own organisation and puts the consortium on the service', async () => {
    const { member, mine, consortium, create, services, links } = await world();
    const reply = await create(member, {
      slug: slug(),
      name: 'Mine',
      provider: mine.id,
      consortia: [consortium.id],
    });
    expect(reply.status).toBe(201);
    expect(await services()).toBe(1);
    expect(await links()).toBe(2);
  });
});
