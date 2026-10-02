import { and, asc, eq, sql } from 'drizzle-orm';
import { Conflict, Invalid } from '@scorpion/contracts';
import { ids, type ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { authMethod, user } from '../db/schema.ts';
import type { CreateUserInput } from '../validation.ts';
import { createUserInput } from '../validation.ts';
import { hashPassword } from './password.ts';
import type { User, UserService } from '../public.ts';

/** The columns of a user that leave the service. The temporary admin marker is deliberately not one. */
const publicColumns = {
  id: user.id,
  username: user.username,
  email: user.email,
  emailVerifiedAt: user.emailVerifiedAt,
  status: user.status,
  deletedAt: user.deletedAt,
  createdAt: user.createdAt,
};

type Row = {
  id: string;
  username: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
};

function toUser(row: Row): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    status: row.status as User['status'],
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}

/** The field problems of a Zod error, without ever repeating the value that was sent. */
function invalid(error: ZodError): Invalid {
  return new Invalid(
    'The user is not valid.',
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** A Postgres unique violation (23505), which Drizzle wraps in a `cause`. */
function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null | undefined)?.code;
  return code(error) === '23505' || code((error as { cause?: unknown } | null)?.cause) === '23505';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createUserService(ctx: ModuleContext): UserService {
  return {
    async createUser(input) {
      const parsed = createUserInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { username, email, emailVerified, status, auth } = parsed.data;

      // The expensive part runs before the transaction, so it holds no connection and no locks.
      const passwordHash = 'password' in auth ? await hashPassword(auth.password) : null;

      try {
        return await ctx.db.tx(async (tx) => {
          // The duplicate check looks at every user, whatever way they sign in, and at soft-deleted
          // ones too: a username stays reserved. The unique indexes decide a race.
          const [sameUsername] = await tx
            .select({ id: user.id })
            .from(user)
            .where(eq(user.username, username))
            .limit(1);
          if (sameUsername) throw new Conflict('This username is already taken.');

          if (email !== undefined) {
            const [sameEmail] = await tx
              .select({ id: user.id })
              .from(user)
              .where(sql`lower(${user.email}) = lower(${email})`)
              .limit(1);
            if (sameEmail) throw new Conflict('This email address is already in use.');
          }

          const id = ids.uuidv7();
          const [created] = await tx
            .insert(user)
            .values({
              id,
              username,
              email: email ?? null,
              emailVerifiedAt: emailVerified ? new Date() : null,
              status,
            })
            .returning(publicColumns);

          const subject = 'subject' in auth ? auth.subject : id; // a password account's subject is the user
          if ('subject' in auth) {
            const [sameIdentity] = await tx
              .select({ id: authMethod.id })
              .from(authMethod)
              .where(and(eq(authMethod.provider, auth.provider), eq(authMethod.subject, subject)))
              .limit(1);
            if (sameIdentity) throw new Conflict('This identity is already linked to an account.');
          }
          await tx.insert(authMethod).values({
            id: ids.uuidv7(),
            userId: id,
            provider: auth.provider,
            subject,
            passwordHash,
          });
          return toUser(created!);
        });
      } catch (error) {
        // Two requests passed the check together and the unique index stopped the second one.
        if (isUniqueViolation(error))
          throw new Conflict('The username, email address or identity is already in use.');
        throw error;
      }
    },

    async findByUsername(username) {
      // Usernames are stored lower-case, and people type them any way they like.
      const [row] = await ctx.db
        .select(publicColumns)
        .from(user)
        .where(eq(user.username, username.toLowerCase()))
        .limit(1);
      return row ? toUser(row) : undefined;
    },

    async findById(id) {
      if (!UUID.test(id)) return undefined; // a malformed id is "no such user", not a database error
      const [row] = await ctx.db.select(publicColumns).from(user).where(eq(user.id, id)).limit(1);
      return row ? toUser(row) : undefined;
    },

    async findByEmail(email) {
      // At most one row is verified; prefer it, then the oldest.
      const [row] = await ctx.db
        .select(publicColumns)
        .from(user)
        .where(sql`lower(${user.email}) = lower(${email})`)
        .orderBy(sql`${user.emailVerifiedAt} is null`, asc(user.id))
        .limit(1);
      return row ? toUser(row) : undefined;
    },
  };
}

export type { CreateUserInput };
