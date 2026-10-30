// The demo seed of core.identity (`scorpion seed --demo`, ADR-0046): the two accounts every other module's seed acts as,
// `demo-admin` (an administrator) and `demo-user` (a plain account). It runs first, registers them as `demo.actors`, and
// refuses to run when the database holds an account that is not a demo account, because that is a real instance.
import { randomBytes } from 'node:crypto';
import { DemoSeedRefused, type DemoSeedContext, type JobResult } from '@scorpion/kernel';
import type { UserActor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { Db } from '@scorpion/kernel';
import { count, like, not } from 'drizzle-orm';
import { user } from '../db/schema.ts';
import type { User } from '../public.ts';
import type { BootstrapService } from './bootstrap.ts';
import type { UserService } from '../public.ts';
import { DEFAULT_ROLE } from './roles.ts';

/** Every demo account starts with this, so a real account is told apart from a demo one. */
export const DEMO_PREFIX = 'demo-';
export const DEMO_ADMIN = 'demo-admin';
export const DEMO_USER = 'demo-user';

export interface DemoSeedDeps {
  db: Pick<Db, 'select' | 'tx'>;
  bootstrap: () => BootstrapService;
  users: () => UserService;
  authz: AuthzService;
}

const actorOf = (user: Pick<User, 'id' | 'username'>): UserActor => ({
  kind: 'user',
  userId: user.id,
  username: user.username,
  roles: [],
  via: 'session',
});

export function createDemoSeed(deps: DemoSeedDeps) {
  return async function demoSeed(_ctx: unknown, demo: DemoSeedContext): Promise<JobResult> {
    if (!demo.allowProduction) {
      const [row] = await deps.db
        .select({ n: count() })
        .from(user)
        .where(not(like(user.username, `${DEMO_PREFIX}%`)));
      const real = row?.n ?? 0;
      if (real > 0) {
        throw new DemoSeedRefused(
          `the database holds ${real} account(s) that are not demo accounts, so it looks like a real instance. ` +
            'Use an empty database, or pass --allow-production if you mean it.',
        );
      }
    }
    let created = 0;
    let existing = 0;
    const users = deps.users();

    async function ensure(
      username: string,
      make: (password: string) => Promise<User>,
      role?: string,
    ) {
      const found = await users.findByUsername(username);
      if (found) {
        existing += 1;
        demo.actors.set(username === DEMO_ADMIN ? 'admin' : 'user', actorOf(found));
        return;
      }
      // Never a guessable password: the operator's, or a random one that is shown once, here.
      const password = demo.password ?? randomBytes(18).toString('base64url');
      const user = await make(password);
      if (role)
        await deps.db.tx((tx) =>
          deps.authz.assignRoleAsSystem(tx, { userId: user.id, roleKey: role }),
        );
      created += 1;
      if (demo.password === undefined)
        demo.out(`Demo account "${username}" has the password ${password} (shown once).`);
      demo.actors.set(username === DEMO_ADMIN ? 'admin' : 'user', actorOf(user));
    }

    await ensure(DEMO_ADMIN, (password) =>
      deps
        .bootstrap()
        .createAdmin({ username: DEMO_ADMIN, email: 'demo-admin@example.org', password }),
    );
    await ensure(
      DEMO_USER,
      (password) =>
        users.createUser({
          username: DEMO_USER,
          email: 'demo-user@example.org',
          status: 'active',
          auth: { provider: 'local', password },
        }),
      DEFAULT_ROLE,
    );
    return { created, existing };
  };
}
