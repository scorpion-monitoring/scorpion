// The entries kpi.framework contributes to registry.services and core.authz, with stand-ins for the database and the writer:
// the field type's schema and checks, the race that becomes a 422 on the field, and the policy of the scoped permission
// (which asks registry.services and nothing else, and refuses every other permission and a resource without a valid id).
import { Invalid } from '@scorpion/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FIELD_KEY, kpiPolicy, kpiSetFieldType, kpiSetStep } from './contributions.ts';
import type { KpisWriter } from './service-kpis.ts';

const id = '0198f3a5-1d44-7e08-a6b1-93c2d0f47e55';
const other = '0198f3a5-1d44-7e08-a6b1-93c2d0f47e56';

const writerOf = (overrides: Partial<KpisWriter> = {}): KpisWriter => ({
  check: () => Promise.resolve(),
  write: () => Promise.resolve([]),
  ...overrides,
});
const typeOf = (writer: KpisWriter) =>
  kpiSetFieldType({ db: () => undefined as never, writer: () => writer });

describe('the field type kpi-set', () => {
  it('has the widget of its name, the storage `module` and a config that names only a RIMO category', () => {
    const type = typeOf(writerOf());
    expect(type).toMatchObject({ id: 'kpi-set', widget: 'kpi-set', storages: ['module'] });
    expect(type.configSchema.safeParse({}).success).toBe(true);
    expect(type.configSchema.safeParse({ rimoCategory: 'Web_application' }).success).toBe(true);
    expect(type.configSchema.safeParse({ other: 1 }).success).toBe(false);
  });

  it.each([
    [{ setId: id, extras: [other] }, true],
    [{ setId: null, extras: [] }, true],
    [{ setId: id, extras: [other, other] }, true], // listed twice counts once
    [{ setId: id }, false],
    [{ extras: [] }, false],
    [{ setId: 'x', extras: [] }, false],
    [{ setId: id, extras: ['x'] }, false],
    [{ setId: id, extras: [], more: 1 }, false],
    ['a set', false],
    [null, false],
  ])('judges %j as %s with the same Zod schema the browser is given in JSON', (value, ok) => {
    const type = typeOf(writerOf());
    expect(type.schema({}).safeParse(value).success).toBe(ok);
  });

  it('describes the value in JSON Schema without a keyword the browser cannot check', () => {
    const json = typeOf(writerOf()).jsonSchema({});
    expect(json).toMatchObject({ type: 'object', required: ['setId', 'extras'] });
    expect(JSON.stringify(json)).not.toMatch(/oneOf|anyOf|\$ref|format/);
  });

  it('turns the 422 of the writer into a problem on the field, and lets other errors through', async () => {
    const refusing = typeOf(
      writerOf({
        check: () =>
          Promise.reject(
            new Invalid('The request is not valid.', [
              { in: 'body', path: 'setId', message: 'There is no such KPI set.' },
            ]),
          ),
      }),
    );
    expect(await refusing.check!({ setId: id, extras: [] }, {}, {} as never)).toEqual({
      problem: 'setId: There is no such KPI set.',
    });
    const broken = typeOf(writerOf({ check: () => Promise.reject(new Error('database down')) }));
    await expect(broken.check!({ setId: id, extras: [] }, {}, {} as never)).rejects.toThrow(
      'database down',
    );
    expect(
      await typeOf(writerOf()).check!({ setId: id, extras: [] }, {}, {} as never),
    ).toBeUndefined();
  });

  it('writes with the service id, the actor and the parsed value (extras once)', async () => {
    const write = vi.fn(() => Promise.resolve([]));
    const type = typeOf(writerOf({ write }));
    const tx = {} as never;
    await type.store!(tx, {
      serviceId: other,
      value: { setId: id, extras: [other, other] },
      config: {},
      actorId: 'user-1',
    });
    expect(write).toHaveBeenCalledWith(tx, other, { setId: id, extras: [other] }, 'user-1');
  });

  it('is a 422 on the field when a set or an indicator was deleted after the check (the key refuses)', async () => {
    const type = typeOf(
      writerOf({
        write: () => Promise.reject(Object.assign(new Error('x'), { cause: { code: '23503' } })),
      }),
    );
    const error = await type.store!({} as never, {
      serviceId: other,
      value: { setId: id, extras: [] },
      config: {},
      actorId: null,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    expect((error as Invalid).errors?.[0]).toMatchObject({ in: 'body', path: FIELD_KEY });
    const bug = typeOf(writerOf({ write: () => Promise.reject(new Error('a bug')) }));
    await expect(
      bug.store!({} as never, {
        serviceId: other,
        value: { setId: id, extras: [] },
        config: {},
        actorId: null,
      }),
    ).rejects.toThrow('a bug');
  });
});

describe('the wizard step', () => {
  it('has one optional field of the type, stored by the module, after the three steps of registry.services', () => {
    expect(kpiSetStep.order).toBe(40);
    expect(kpiSetStep.fields).toHaveLength(1);
    const [field] = kpiSetStep.fields;
    expect(field).toMatchObject({
      key: FIELD_KEY,
      path: '/kpiSet',
      type: 'kpi-set',
      storage: { kind: 'module' },
    });
    expect(field?.required).toBeUndefined();
  });
});

describe('the policy of the scoped permission', () => {
  const request = (permission: string, resource: { type: string; id?: string }) => ({
    actor: { userId: 'user-1' },
    permission,
    resource,
  });

  it('asks registry.services whether the user manages the provider of the service, for its own permission only', async () => {
    const asked = vi.fn(() => Promise.resolve(true));
    const policy = kpiPolicy({ isProviderManager: () => asked });
    expect(policy.resourceType).toBe('service');
    expect(
      await policy.allows(request('kpi.framework.service.kpis.edit', { type: 'service', id })),
    ).toBe(true);
    expect(asked).toHaveBeenCalledWith('user-1', id);
  });

  it.each([
    ['another permission', 'registry.services.service.edit', { type: 'service', id }],
    ['a read permission', 'kpi.framework.set.read', { type: 'service', id }],
    ['no id', 'kpi.framework.service.kpis.edit', { type: 'service' }],
    ['an id that is no UUID', 'kpi.framework.service.kpis.edit', { type: 'service', id: 'x' }],
  ])('grants nothing for %s and does not ask', async (_what, permission, resource) => {
    const asked = vi.fn(() => Promise.resolve(true));
    const policy = kpiPolicy({ isProviderManager: () => asked });
    expect(await policy.allows(request(permission, resource))).toBe(false);
    expect(asked).not.toHaveBeenCalled();
  });

  it('follows the answer of registry.services: no for a stranger', async () => {
    const policy = kpiPolicy({ isProviderManager: () => () => Promise.resolve(false) });
    expect(
      await policy.allows(request('kpi.framework.service.kpis.edit', { type: 'service', id })),
    ).toBe(false);
  });
});
