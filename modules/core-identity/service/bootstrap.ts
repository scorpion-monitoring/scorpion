// Bootstrap: how a fresh install gets its first administrator without the "first registrant" rule
// (defect 1). Two ways, both through here: `scorpion create-admin` (an operator with a shell) and
// the one-time first-run token (an operator with the server's console).
//
// The administrator holds the Admin role of `core.authz`, given by the system (no human caller,
// `assigned_by` null) in the transaction that creates the account (ADR 0015). "No administrator
// yet" means "no user holds the Admin role".
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Invalid, Unauthorized } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type DbTx, type ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { firstRunToken } from '../db/schema.ts';
import type { User, UserService } from '../public.ts';
import { createAdminInput, redeemFirstRunInput, type CreateAdminInput } from '../validation.ts';
import { ADMIN_ROLE } from './roles.ts';

/** How long a first-run token lives. */
export const FIRST_RUN_TTL_MS = 60 * 60 * 1000;
/** `sfr_` and 43 base64url characters (256 bits). Not an access token: it has another mark. */
export const FIRST_RUN_MARK = 'sfr_';
const FIRST_RUN_TOKEN = /^sfr_[A-Za-z0-9_-]{43}$/;
/** Held while a first-run token is issued, so two processes starting together issue one. */
const ISSUE_LOCK = 'identity.first-run-token';

export type AdminOrigin = 'cli' | 'first-run';

export interface BootstrapService {
  /**
   * Creates an active user with a password and the Admin role, and ends every outstanding
   * first-run token. 422 for bad input, 409 for a taken name or address.
   */
  createAdmin(input: unknown, origin?: AdminOrigin): Promise<User>;
  /**
   * Issues a first-run token and announces it, once, when no user holds the Admin role and there
   * is no token that is still good. Returns whether it issued one.
   */
  issueFirstRunToken(now?: Date): Promise<boolean>;
  /**
   * Redeems a first-run token: creates the first administrator. The token is used up in the same
   * transaction, so a failure (a taken name) leaves it usable. 401, with one answer, for a token
   * that is unknown, used, expired or ended by an administrator.
   */
  redeemFirstRunToken(input: unknown, now?: Date): Promise<User>;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function invalid(error: ZodError): Invalid {
  return new Invalid(
    'The request is not valid.',
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

export function createBootstrapService(
  ctx: ModuleContext,
  deps: {
    users: UserService;
    authz: AuthzService;
    /**
     * Where the first-run token is shown: the process's console, as plain text. This is the one
     * place a secret may be printed, so it is never the structured logger (whose lines also go to
     * log shippers), and it is called once per token.
     */
    announce: (text: string) => void;
    ttlMs?: number;
  },
): BootstrapService {
  const { users, authz, announce } = deps;
  const ttlMs = deps.ttlMs ?? FIRST_RUN_TTL_MS;

  /** Somebody holds the Admin role. A deactivated administrator counts until the purge removes the role. */
  const anAdminExists = (tx: Pick<DbTx, 'select'>) => authz.hasHolders(ADMIN_ROLE, tx);

  /** The user, the Admin role, the end of every outstanding token and the event: one write. */
  async function create(admin: CreateAdminInput, origin: AdminOrigin) {
    return ctx.db.tx(async (tx) => {
      const created = await users.createUser({
        username: admin.username,
        email: admin.email,
        auth: { provider: 'local', password: admin.password },
        status: 'active',
      });
      await authz.assignRoleAsSystem(tx, { userId: created.id, roleKey: ADMIN_ROLE });
      await tx
        .update(firstRunToken)
        .set({ redeemedAt: sql`now()` })
        .where(isNull(firstRunToken.redeemedAt));
      await ctx.events.emit('identity.admin.created@1', {
        userId: created.id,
        username: created.username,
        origin,
      });
      return created;
    });
  }

  return {
    async createAdmin(input, origin = 'cli') {
      const parsed = createAdminInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      return create(parsed.data, origin);
    },

    async issueFirstRunToken(now = new Date()) {
      const secret = randomBytes(32).toString('base64url');
      const token = `${FIRST_RUN_MARK}${secret}`;
      const expiresAt = new Date(now.getTime() + ttlMs);

      const issued = await ctx.db.tx(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ISSUE_LOCK}))`);
        if (await anAdminExists(tx)) return false;
        const [live] = await tx
          .select({ id: firstRunToken.id, expiresAt: firstRunToken.expiresAt })
          .from(firstRunToken)
          .where(and(isNull(firstRunToken.redeemedAt), gt(firstRunToken.expiresAt, now)))
          .limit(1);
        if (live) {
          // The secret was shown once and cannot be shown again; say so without a secret.
          ctx.log.info(
            { expiresAt: live.expiresAt },
            'a first-run token is outstanding; use `scorpion create-admin`, or wait until it expires',
          );
          return false;
        }
        await tx.insert(firstRunToken).values({
          id: ids.uuidv7(),
          secretHash: hashToken(token),
          createdAt: now,
          expiresAt,
        });
        return true;
      });
      if (!issued) return false;

      // After the commit, so a token that was never stored is never shown.
      announce(
        [
          '',
          '================================================================================',
          ' Scorpion has no administrator yet.',
          ` First-run token (single use, valid until ${expiresAt.toISOString()}):`,
          '',
          `   ${token}`,
          '',
          ' Create the first administrator with it:',
          '   POST /api/internal/bootstrap/first-admin   (below BASE_PATH)',
          '   { "token": "…", "username": "…", "email": "…", "password": "…" }',
          ' or run `scorpion create-admin` instead. This is shown once and not logged again.',
          '================================================================================',
          '',
        ].join('\n'),
      );
      return true;
    },

    async redeemFirstRunToken(input, now = new Date()) {
      const parsed = redeemFirstRunInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { token, ...account } = parsed.data;
      const refused = () => new Unauthorized('The first-run token is not valid.');
      if (!FIRST_RUN_TOKEN.test(token)) throw refused();

      return ctx.db.tx(async (tx) => {
        // Used up first and in this transaction: if creating the account fails, so does this.
        const [used] = await tx
          .update(firstRunToken)
          .set({ redeemedAt: now })
          .where(
            and(
              eq(firstRunToken.secretHash, hashToken(token)),
              isNull(firstRunToken.redeemedAt),
              gt(firstRunToken.expiresAt, now),
            ),
          )
          .returning({ id: firstRunToken.id });
        if (!used) throw refused();
        if (await anAdminExists(tx)) throw refused();
        return create(account, 'first-run');
      });
    },
  };
}
