// The claim of a migrated account at its owner's first sign-in (ADR 0053): what claims it, everything that does not (each
// leaves the claim, links nothing and signs nobody in), one winner of two sign-ins, and the rollback of the claim's writes.
import { Forbidden } from '@scorpion/contracts';
import { makeAuthMethod } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { failOutbox } from '../test/mail.ts';
import { count, flow, fresh, rows, start, type Kernel } from '../test/oidc.ts';
import type { IdentityInternals } from '../module.ts';

const DAY = 86_400_000;

/** A migrated account: `ann`, ann@example.org, claimable at the stub provider by the provider's username `Ann.Legacy`. */
async function migrated(
  id: IdentityInternals,
  claim: Partial<{ provider: string; username: string; expiresAt: Date }> = {},
) {
  return id.users.createClaimableAsSystem({
    username: 'ann',
    email: 'ann@example.org',
    claim: {
      provider: 'stub',
      username: 'Ann.Legacy',
      expiresAt: new Date(Date.now() + 90 * DAY),
      ...claim,
    },
  });
}

/** Nothing was claimed: the claim is there, no identity, no session, the address unconfirmed. */
async function untouched(kernel: Kernel, name: string) {
  expect(await count(kernel, 'identity_account_claim'), name).toBe(1);
  expect(await count(kernel, 'identity_auth_method'), name).toBe(0);
  expect(await count(kernel, 'identity_session'), name).toBe(0);
  const [user] = await rows(
    kernel,
    `select email_verified_at from identity_user where username = 'ann'`,
  );
  expect(user!.email_verified_at, name).toBeNull();
}

describe('claiming a migrated account at the first sign-in (ADR 0053)', () => {
  it('adds the identity, deletes the claim, confirms the address and signs the owner in; later found by (provider, sub) [ASVS-10.5.2]', async () => {
    const { kernel, identity: id } = await start();
    const ann = await migrated(id);
    const login = fresh({ email: 'ANN@example.org', preferredUsername: 'ann.legacy' });

    const done = await id.oidc.complete(await flow(id, login));

    expect(done).toMatchObject({ kind: 'login' });
    expect(
      await rows(kernel, 'select user_id, provider, subject from identity_auth_method'),
    ).toEqual([{ user_id: ann.id, provider: 'stub', subject: login.subject }]);
    expect(await count(kernel, 'identity_account_claim')).toBe(0);
    expect(await count(kernel, 'identity_session')).toBe(1);
    expect((await id.users.findById(ann.id))?.emailVerified).toBe(true);
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(await rows(kernel, 'select name, payload from kernel_outbox order by id')).toEqual([
      {
        name: 'identity.authMethod.linked@1',
        payload: { userId: ann.id, username: 'ann', provider: 'stub', via: 'claim' },
      },
      {
        name: 'identity.session.created@1',
        payload: expect.objectContaining({ userId: ann.id, method: 'oidc' }) as unknown,
      },
    ]);

    // The next sign-in is an ordinary one by the identity.
    const again = await id.oidc.complete(await flow(id, login));
    expect(again).toMatchObject({ kind: 'login' });
    expect(await count(kernel, 'identity_auth_method')).toBe(1);
  });

  it('claims nothing unless every rule holds; the sign-in takes the mail path of ADR 0026 [ASVS-6.8.1]', async () => {
    const cases: [string, Parameters<typeof migrated>[1], Parameters<typeof fresh>[0]][] = [
      ['another provider', { provider: 'other-idp' }, {}],
      ['expired', { expiresAt: new Date(Date.now() - 1000) }, {}],
      ['another username', {}, { preferredUsername: 'ann' }],
      ['no username', {}, { preferredUsername: undefined }],
    ];
    for (const [name, claim, over] of cases) {
      const { kernel, identity: id, mail } = await start();
      await migrated(id, claim);
      const done = await id.oidc.complete(
        await flow(
          id,
          fresh({ email: 'ann@example.org', preferredUsername: 'Ann.Legacy', ...over }),
        ),
      );
      expect(done, name).toEqual({ kind: 'check-mail' });
      await untouched(kernel, name);
      expect(await mail.of('identity.oidc-link'), name).toHaveLength(1);
    }
  });

  it('never claims on an address the provider did not verify (a new pending account instead)', async () => {
    const { kernel, identity: id } = await start();
    await migrated(id);
    await expect(
      id.oidc.complete(
        await flow(
          id,
          fresh({
            email: 'ann@example.org',
            emailVerified: false,
            preferredUsername: 'Ann.Legacy',
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await count(kernel, 'identity_account_claim')).toBe(1);
    const [owner] = await rows(
      kernel,
      `select a.user_id from identity_auth_method a join identity_user u on u.id = a.user_id where u.username = 'ann'`,
    );
    expect(owner).toBeUndefined();
  });

  it('never claims an account that has a way to sign in, or that was deactivated', async () => {
    {
      const { kernel, identity: id } = await start();
      const ann = await migrated(id);
      await makeAuthMethod(kernel.pool, ann, { provider: 'other-idp', subject: 'someone' });
      const done = await id.oidc.complete(
        await flow(id, fresh({ email: 'ann@example.org', preferredUsername: 'Ann.Legacy' })),
      );
      expect(done).toEqual({ kind: 'check-mail' });
      expect(await count(kernel, 'identity_account_claim')).toBe(1);
      expect(await count(kernel, 'identity_auth_method')).toBe(1);
      expect(await count(kernel, 'identity_session')).toBe(0);
    }
    {
      const { kernel, identity: id } = await start();
      const ann = await migrated(id);
      await id.deactivateAsSystem(ann.id);
      const done = await id.oidc.complete(
        await flow(id, fresh({ email: 'ann@example.org', preferredUsername: 'Ann.Legacy' })),
      );
      expect(done).toEqual({ kind: 'check-mail' });
      await untouched(kernel, 'deactivated');
    }
  });

  it('two sign-ins at once with different identities: one claims, the other links nothing', async () => {
    const { kernel, identity: id } = await start();
    const ann = await migrated(id);
    const login = () => fresh({ email: 'ann@example.org', preferredUsername: 'Ann.Legacy' });
    const inputs = [await flow(id, login()), await flow(id, login())];
    const results = await Promise.all(inputs.map((input) => id.oidc.complete(input)));
    expect(results.map((r) => r.kind).sort()).toEqual(['check-mail', 'login']);
    expect(await rows(kernel, 'select user_id from identity_auth_method')).toEqual([
      { user_id: ann.id },
    ]);
    expect(await count(kernel, 'identity_account_claim')).toBe(0);
  });

  it('rolls the claim back when the event cannot be written: the claim stays, nothing is linked', async () => {
    const { kernel, identity: id } = await start();
    await migrated(id);
    await failOutbox(kernel);
    await expect(
      id.oidc.complete(
        await flow(id, fresh({ email: 'ann@example.org', preferredUsername: 'Ann.Legacy' })),
      ),
    ).rejects.toThrow();
    await untouched(kernel, 'rollback');
  });
});
