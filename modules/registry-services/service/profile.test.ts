// The Schema.org profile of a service for a signed-in reader (`schemaOrg`), over real Postgres: any service
// (private ones too), never the contact point or the stage, the licence only when the list knows it, a configured
// field and a contributor under the allow-list, a failing contributor that does not take the profile down, and the
// denied cases.
import { NotFound, Unauthorized } from '@scorpion/contracts';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { fixtureContributor, useServices } from '../test/harness.ts';
import { anonymous, rejection, world } from '../test/world.ts';

const h = useServices();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

describe('schemaOrg', () => {
  it('describes a private service for a plain User: provider, brand, no stage, no contact point [ASVS-8.2.3]', async () => {
    const w = await world(h);
    const profile = await w.services.schemaOrg(w.people.plain, w.svc.id);
    const origin = w.kernel.config.ORIGIN;
    expect(profile).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Service',
      '@id': `${origin}/services/${w.svc.id}`,
      name: w.svc.name,
      alternateName: w.svc.slug,
      provider: { '@id': `${origin}/organisations/${w.provider.id}` },
      brand: [{ '@id': `${origin}/organisations/${w.consortium.id}` }],
    });
    const text = JSON.stringify(profile);
    expect(text).not.toMatch(/contactPoint|contact|stage|"PROD"/);
  });

  it('never carries the contact point, for the Admin and the provider’s members either [ASVS-8.2.3]', async () => {
    const w = await world(h);
    await w.pool.query(
      "update svc_service set contact_email = 'team-secret@example.org', contact_type = 'support' where id = $1",
      [w.svc.id],
    );
    for (const who of ['admin', 'manager', 'member', 'plain', 'reviewer'] as const) {
      const text = JSON.stringify(await w.services.schemaOrg(w.people[who], w.svc.id));
      expect(text, who).not.toContain('team-secret');
      expect(text, who).not.toContain('support');
    }
  });

  it('builds the organisation nodes without the organisation’s contact point', async () => {
    const w = await world(h);
    await w.pool.query(
      "update org_organisation set contact_email = 'org-secret@example.org', contact_type = 'support' where id = any($1)",
      [[w.provider.id, w.consortium.id]],
    );
    expect(JSON.stringify(await w.services.schemaOrg(w.people.admin, w.svc.id))).not.toContain(
      'org-secret',
    );
  });

  it('answers 401 to an anonymous caller, 404 for an unknown service and 422 for a bad id', async () => {
    const w = await world(h);
    await expect(w.services.schemaOrg(anonymous, w.svc.id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(w.services.schemaOrg(w.people.plain, ABSENT)).rejects.toBeInstanceOf(NotFound);
    expect(await rejection(w.services.schemaOrg(w.people.plain, 'nope'))).toMatchObject({
      status: 422,
    });
  });

  it('writes the licence page for an id the list knows and leaves it out for one it does not', async () => {
    const w = await world(h);
    const known = await makeService(w.pool, { provider: w.provider.id, license: 'MIT' });
    const unknown = await makeService(w.pool, {
      provider: w.provider.id,
      license: 'Not-A-Licence-1.0',
    });
    expect((await w.services.schemaOrg(w.people.plain, known.id)).license).toBe(
      'https://spdx.org/licenses/MIT.html',
    );
    expect('license' in (await w.services.schemaOrg(w.people.plain, unknown.id))).toBe(false);
  });

  it('writes the icon as an ImageObject under the base path and omits it without an icon', async () => {
    const w = await world(h);
    const hash = 'b'.repeat(64);
    const withIcon = await makeService(w.pool, {
      provider: w.provider.id,
      iconBlobId: '018f3b7e-2222-7000-8000-000000000002',
      iconHash: hash,
    });
    expect((await w.services.schemaOrg(w.people.plain, withIcon.id)).logo).toEqual({
      '@type': 'ImageObject',
      url: `${w.kernel.config.ORIGIN}/api/internal/files/${hash}`,
    });
    expect('logo' in (await w.services.schemaOrg(w.people.plain, w.svc.id))).toBe(false);
  });
});

describe('schemaOrg: configured fields and contributors', () => {
  const termsField = {
    key: 'termsUrl',
    path: '/extra/termsUrl',
    type: 'text',
    label: 'services.field.termsUrl.label',
    config: { format: 'url' },
    storage: { kind: 'value' },
    schemaOrg: 'termsOfService',
  } as const;
  const config = {
    fields: [...FIELDS, termsField],
    steps: STEPS.map((step) =>
      step.id === 'basics' ? { ...step, fields: [...step.fields!, 'termsUrl'] } : step,
    ),
  };
  const contributor = (contribute: unknown) =>
    fixtureContributor({
      contributes: { 'service.profileContributor': [{ id: 'fixture-profile', contribute }] },
    });

  it('maps a configured field to the property it names', async () => {
    const w = await world(h, { config });
    await w.services.update(w.people.member, w.svc.id, {
      extra: { termsUrl: 'https://example.org/terms' },
    });
    expect((await w.services.schemaOrg(w.people.plain, w.svc.id)).termsOfService).toBe(
      'https://example.org/terms',
    );
  });

  it('adds the properties a contributor offers on the allow-list and drops the rest, @id and provider included', async () => {
    const w = await world(h, {
      extra: [
        contributor(() => ({
          serviceType: 'Workbench',
          category: ['Genomics'],
          '@id': 'https://evil.example/x',
          provider: 'evil',
          license: 'evil',
          offers: 'nope',
        })),
      ],
    });
    const profile = await w.services.schemaOrg(w.people.plain, w.svc.id);
    expect(profile).toMatchObject({ serviceType: 'Workbench', category: ['Genomics'] });
    expect(profile['@id']).toBe(`${w.kernel.config.ORIGIN}/services/${w.svc.id}`);
    expect(JSON.stringify(profile)).not.toMatch(/evil|nope/);
  });

  it('hands a contributor the stored record without the contact point', async () => {
    const seen: unknown[] = [];
    const w = await world(h, {
      extra: [
        contributor((subject: unknown) => {
          seen.push(subject);
          return {};
        }),
      ],
    });
    await w.services.schemaOrg(w.people.plain, w.svc.id);
    expect(Object.keys(seen[0] as object).sort()).toEqual(['id', 'name', 'slug', 'values']);
  });

  it('survives a contributor that throws: the profile is built without it and a warning is logged', async () => {
    const logLines: string[] = [];
    const w = await world(h, {
      logLines,
      extra: [
        contributor(() => {
          throw new Error('contributor is broken');
        }),
      ],
    });
    const profile = await w.services.schemaOrg(w.people.plain, w.svc.id);
    expect(profile.name).toBe(w.svc.name);
    expect(logLines.join('')).toContain('a profile contributor failed');
  });

  it('keeps hostile contributor text inert once serialised', async () => {
    const w = await world(h, {
      extra: [contributor(() => ({ slogan: '</script><script>alert(1)</script>' }))],
    });
    const { serializeJsonLd } = await import('@scorpion/registry-organisations/public');
    const json = serializeJsonLd(await w.services.schemaOrg(w.people.plain, w.svc.id));
    expect(json).not.toMatch(/[<>&]/);
    expect((JSON.parse(json) as { slogan: string }).slogan).toBe(
      '</script><script>alert(1)</script>',
    );
  });

  it('does not touch the database for an organisation of another service (the nodes are the service’s own)', async () => {
    const w = await world(h);
    const stranger = await makeOrganisation(w.pool, { type: 'consortium' });
    const profile = await w.services.schemaOrg(w.people.plain, w.svc.id);
    expect(JSON.stringify(profile)).not.toContain(stranger.id);
  });
});
