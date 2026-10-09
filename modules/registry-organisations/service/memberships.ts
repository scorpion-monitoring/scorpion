// Membership: a person asks to join an organisation, an Admin or a manager of that organisation decides,
// roles are given and taken, members are removed, and people leave. The service layer is the only way
// this data changes (CLAUDE.md rule 5). The state machine (`membership-state.ts`) says what may happen;
// this file reads the row under a lock, asks it, writes the answer, and emits the event and the mail in
// the same transaction.
//
// Authorization (ADR-0034). The routes carry the plain `…organisation.read` (or `…membership.request`);
// the service **is** the authorization: every method calls `ctx.authz.require` again, and a delegated
// action calls it with the scoped permission and the organisation, so the policy `organisation.member`
// answers for managers. Nobody decides on their own request (the `approval` rule of core.authz), changes
// their own role or removes themselves (checked here), and a manager never removes a manager.
import {
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type Actor,
  type UserActor,
} from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { Db, DbTx, ModuleContext } from '@scorpion/kernel';
import { ids } from '@scorpion/kernel';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { membership, organisation } from '../db/schema.ts';
import {
  MembershipNotSupported,
  MembershipStateConflict,
  TooManyManagers,
  TooManyPending,
} from './errors.ts';
import { requireId } from './input.ts';
import { createMembershipMail, type MembershipMailDeps } from './membership-mail.ts';
import { approvedCounts } from './membership-queries.ts';
import {
  STATES,
  allowedActions,
  transition,
  type By,
  type DeciderAction,
  type Role,
  type State,
} from './membership-state.ts';
import {
  PERMISSION_DECIDE,
  PERMISSION_MANAGE_ROLES,
  PERMISSION_READ,
  PERMISSION_REMOVE,
  PERMISSION_REQUEST,
  PERMISSION_VIEW_MEMBERS,
  RESOURCE_TYPE,
} from './permissions.ts';
import { ORG_TYPE_REGISTRY, type OrgTypeEntry } from './registries.ts';
import { settingsSchema } from '../settings-schema.ts';

type Row = typeof membership.$inferSelect;
type Reader = Pick<Db | DbTx, 'select'>;

/** The organisation as a membership shows it. */
export interface OrganisationRef {
  id: string;
  type: string;
  abbreviation: string;
  name: string;
}

/** A person's own membership, in any state. */
export interface OwnMembership {
  id: string;
  organisation: OrganisationRef;
  state: State;
  role: Role;
  requestedAt: Date;
  decidedAt: Date | null;
  endedAt: Date | null;
}

/** A row a manager or an Admin works on. Never an email address. */
export interface ManagedMembership {
  id: string;
  organisation: OrganisationRef;
  userId: string;
  /** `null` for an account that is gone and whose rows the purge has not yet removed. */
  username: string | null;
  state: State;
  role: Role;
  requestedAt: Date;
  decidedAt: Date | null;
  roleChangedAt: Date | null;
  /** What the caller may do to this row now; each action is checked again when it is taken. */
  allowedActions: DeciderAction[];
}

/** What a member sees of another member: a username and a date. No state, no role, no address. */
export interface Member {
  username: string;
  since: Date;
}

export interface Page {
  page: number;
  pageSize: number;
}

export interface ManagedFilter {
  state?: State | undefined;
  organisationId?: string | undefined;
  type?: string | undefined;
}

export type Decision = 'approved' | 'rejected';

export interface MembershipsService {
  /**
   * Needs `…membership.request`. Asks to join: `created` is true for a new request or a reopened row
   * (201), false when the person has already asked or is a member (200, the current row).
   * `422 membership-not-supported`, `409 too-many-pending`, `404` for an unknown organisation.
   */
  request: (
    actor: Actor,
    organisationId: string,
  ) => Promise<{ membership: OwnMembership; created: boolean }>;
  /** Needs `…membership.request`. Withdraws a request or leaves; `404` when there is neither. */
  leave: (actor: Actor, organisationId: string) => Promise<OwnMembership>;
  /** Needs `…membership.request`. The caller's own rows, all states, by abbreviation then id. */
  listOwn: (actor: Actor, page: Page) => Promise<{ items: OwnMembership[]; total: number }>;
  /**
   * Needs `…organisation.read`, then `…membership.view-members` on the organisation. Usernames and
   * join dates of the approved members, oldest first.
   */
  listMembers: (
    actor: Actor,
    organisationId: string,
    page: Page,
  ) => Promise<{ items: Member[]; total: number }>;
  /**
   * Needs `…organisation.read`, then `…membership.decide` on the organisation (an Admin anywhere, a
   * manager of that one). The requests and members of one organisation, oldest request first.
   */
  listForOrganisation: (
    actor: Actor,
    organisationId: string,
    filter: ManagedFilter,
    page: Page,
  ) => Promise<{ items: ManagedMembership[]; total: number }>;
  /**
   * Needs `…organisation.read`; `403` unless the caller is an Admin or manages an organisation. An
   * Admin sees every organisation, a manager only the ones they manage (a filter on another one is
   * `403`). Oldest request first.
   */
  listPending: (
    actor: Actor,
    filter: ManagedFilter,
    page: Page,
  ) => Promise<{ items: ManagedMembership[]; total: number }>;
  /** Needs `…organisation.read`. `{ pending, manages }` for the dashboard card; zeros for a plain user, never 403. */
  summary: (actor: Actor) => Promise<{ pending: number; manages: boolean }>;
  /**
   * Approves or rejects a request: `…membership.decide` on the organisation, never the caller's own
   * request. `409 membership-state` when it is no longer a request.
   */
  decide: (actor: Actor, membershipId: string, decision: Decision) => Promise<ManagedMembership>;
  /**
   * Promotes or demotes: `…membership.manage-roles` on the organisation, never the caller's own role.
   * Only an approved member; the same role again is `200` and changes nothing; `409 too-many-managers`.
   */
  setRole: (actor: Actor, membershipId: string, role: Role) => Promise<ManagedMembership>;
  /**
   * Ends an approved membership: `…membership.remove` on the organisation. A manager removes a plain
   * member only; nobody removes themselves (that is `leave`).
   */
  remove: (actor: Actor, membershipId: string) => Promise<ManagedMembership>;

  // Trusted reads for other modules (ADR-0015): no permission check, no caller named, no person named
  // beyond an id. A route that uses one must check the permission itself.
  isApprovedMemberAsSystem: (userId: string, organisationId: string) => Promise<boolean>;
  listApprovedOrganisationIdsAsSystem: (userId: string) => Promise<string[]>;
  countApprovedMembersAsSystem: (
    organisationIds: readonly string[],
  ) => Promise<Record<string, number>>;
  isManagerAsSystem: (userId: string, organisationId: string) => Promise<boolean>;
  /**
   * Deletes every membership of a purged person, managers' too, in one transaction (idempotent).
   * Called by the subscriber of `identity.user.purged@1`; no route calls it.
   */
  purgeUserAsSystem: (userId: string) => Promise<void>;
}

export interface MembershipsDeps extends MembershipMailDeps {
  authz: Pick<AuthzService, 'require' | 'can' | 'listHoldersAsSystem'>;
  identity: Pick<IdentityService, 'users'>;
  notifications: Pick<NotificationsService, 'enqueueTemplate'>;
  settings: Pick<SettingsService, 'getUserPreference'>;
}

export function createMembershipsService(
  ctx: ModuleContext,
  deps: MembershipsDeps,
): MembershipsService {
  const db: Db = ctx.db;
  const mail = createMembershipMail(ctx, deps);
  const settings = async () => settingsSchema.parse(await ctx.settings.get());
  const types = new Map<string, OrgTypeEntry>(
    (ctx.registry(ORG_TYPE_REGISTRY) as readonly OrgTypeEntry[]).map((entry) => [entry.id, entry]),
  );

  const resource = (id: string) => ({ type: RESOURCE_TYPE, id });

  /** After `authz.require` on a plain permission the actor is a signed-in user; this narrows the type. */
  function userOf(actor: Actor): UserActor {
    if (actor.kind !== 'user') throw new Unauthorized();
    return actor;
  }

  const refOf = (row: {
    id: string;
    type: string;
    abbreviation: string;
    name: string;
  }): OrganisationRef => ({
    id: row.id,
    type: row.type,
    abbreviation: row.abbreviation,
    name: row.name,
  });

  const orgColumns = {
    id: organisation.id,
    type: organisation.type,
    abbreviation: organisation.abbreviation,
    name: organisation.name,
  };

  async function loadOrganisation(tx: Reader, id: string, lock?: 'share') {
    const query = tx.select(orgColumns).from(organisation).where(eq(organisation.id, id));
    const [row] = await (lock ? query.for('share') : query);
    if (!row) throw new NotFound('There is no such organisation.');
    return row;
  }

  async function loadMembership(tx: Reader, id: string, lock = false): Promise<Row> {
    const query = tx.select().from(membership).where(eq(membership.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFound('There is no such membership.');
    return row;
  }

  async function lockedPair(tx: Reader, organisationId: string, userId: string) {
    const [row] = await tx
      .select()
      .from(membership)
      .where(and(eq(membership.organisationId, organisationId), eq(membership.userId, userId)))
      .for('update');
    return row;
  }

  /**
   * A transaction-scoped advisory lock, taken **after** any row locks and never held while a row lock
   * is awaited (ADR-0034, "Serialising changes"): it serialises what spans rows.
   */
  const advisory = (tx: DbTx, key: string) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  const lockManagers = (tx: DbTx, organisationId: string) =>
    advisory(tx, `org_managers:${organisationId}`);

  async function managerCount(tx: Reader, organisationId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(membership)
      .where(
        and(
          eq(membership.organisationId, organisationId),
          eq(membership.state, 'approved'),
          eq(membership.role, 'manager'),
        ),
      );
    return row?.n ?? 0;
  }

  async function managedIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ id: membership.organisationId })
      .from(membership)
      .where(
        and(
          eq(membership.userId, userId),
          eq(membership.state, 'approved'),
          eq(membership.role, 'manager'),
        ),
      )
      .orderBy(asc(membership.organisationId));
    return rows.map((row) => row.id);
  }

  /**
   * Whether the caller may act on memberships at all: an Admin (holds `decide` globally), or a manager
   * of at least one organisation. Anybody else is `403` before anything is looked up, so a person with
   * no right learns nothing from the difference between an unknown id and a known one (ADR-0034).
   */
  async function requireDecider(actor: Actor, user: UserActor): Promise<void> {
    if (await deps.authz.can(actor, PERMISSION_DECIDE)) return;
    if ((await managedIds(user.userId)).length === 0) throw new Forbidden();
  }

  /** The organisations the caller may decide for: everything for an Admin, else the ones they manage and may use. */
  async function decidable(
    actor: Actor,
    user: UserActor,
  ): Promise<{ admin: boolean; ids: string[]; managed: string[] }> {
    const managed = await managedIds(user.userId);
    if (await deps.authz.can(actor, PERMISSION_DECIDE)) return { admin: true, ids: [], managed };
    const allowed = await Promise.all(
      managed.map((id) => deps.authz.can(actor, PERMISSION_DECIDE, resource(id))),
    );
    return { admin: false, ids: managed.filter((_, index) => allowed[index]), managed };
  }

  const ownView = (row: Row, org: OrganisationRef): OwnMembership => ({
    id: row.id,
    organisation: org,
    state: row.state as State,
    role: row.role as Role,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    endedAt: row.endedAt,
  });

  /** A row for a decider's screen, with the actions the caller may take on it now. */
  async function managedView(
    row: Row,
    org: OrganisationRef,
    caller: { userId: string; by: Exclude<By, 'self'> },
    username?: string | null,
  ): Promise<ManagedMembership> {
    return {
      id: row.id,
      organisation: org,
      userId: row.userId,
      username: username === undefined ? ((await mail.usernameOf(row.userId)) ?? null) : username,
      state: row.state as State,
      role: row.role as Role,
      requestedAt: row.requestedAt,
      decidedAt: row.decidedAt,
      roleChangedAt: row.roleChangedAt,
      allowedActions: allowedActions(
        { state: row.state as State, role: row.role as Role },
        caller.by,
        row.userId === caller.userId,
      ),
    };
  }

  async function usernames(userIds: readonly string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIds)];
    const found = await Promise.all(unique.map((id) => mail.usernameOf(id)));
    return new Map(unique.map((id, index) => [id, found[index] ?? null]));
  }

  /** The rows of a decider's list with their organisation and username. */
  async function managedPage(
    conditions: (SQL | undefined)[],
    page: Page,
    caller: { userId: string; by: (organisationId: string) => Exclude<By, 'self'> },
  ): Promise<{ items: ManagedMembership[]; total: number }> {
    const where = and(...conditions);
    const [rows, [count]] = await Promise.all([
      db
        .select({ m: membership, o: orgColumns })
        .from(membership)
        .innerJoin(organisation, eq(organisation.id, membership.organisationId))
        .where(where)
        .orderBy(asc(membership.requestedAt), asc(membership.id))
        .limit(page.pageSize)
        .offset(page.page * page.pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(membership)
        .innerJoin(organisation, eq(organisation.id, membership.organisationId))
        .where(where),
    ]);
    const names = await usernames(rows.map((row) => row.m.userId));
    const items = await Promise.all(
      rows.map((row) =>
        managedView(
          row.m,
          refOf(row.o),
          { userId: caller.userId, by: caller.by(row.m.organisationId) },
          names.get(row.m.userId) ?? null,
        ),
      ),
    );
    return { items, total: count?.total ?? 0 };
  }

  function filterConditions(filter: ManagedFilter): (SQL | undefined)[] {
    if (filter.state !== undefined && !STATES.includes(filter.state)) {
      throw new Invalid('The request is not valid.', [
        { in: 'query', path: 'state', message: `The state must be one of: ${STATES.join(', ')}.` },
      ]);
    }
    return [
      filter.state ? eq(membership.state, filter.state) : undefined,
      filter.organisationId ? eq(membership.organisationId, filter.organisationId) : undefined,
      filter.type ? eq(organisation.type, filter.type) : undefined,
    ];
  }

  /** After a change that may have taken a manager away: the organisation has none left, tell the administrators. */
  async function announceNoManager(tx: DbTx, org: OrganisationRef): Promise<void> {
    await mail.withoutManager(tx, org);
  }

  async function listForOrganisation(
    actor: Actor,
    organisationId: string,
    filter: ManagedFilter,
    page: Page,
  ): Promise<{ items: ManagedMembership[]; total: number }> {
    await deps.authz.require(actor, PERMISSION_READ);
    const user = userOf(actor);
    requireId(organisationId);
    await deps.authz.require(actor, PERMISSION_DECIDE, resource(organisationId));
    await loadOrganisation(db, organisationId);
    const admin = await deps.authz.can(actor, PERMISSION_DECIDE);
    return managedPage(
      [
        eq(membership.organisationId, organisationId),
        ...filterConditions({ ...filter, organisationId: undefined }),
      ],
      page,
      { userId: user.userId, by: () => (admin ? 'admin' : 'manager') },
    );
  }

  return {
    async request(actor, organisationId) {
      await deps.authz.require(actor, PERMISSION_REQUEST);
      const user = userOf(actor);
      requireId(organisationId);
      const maxPending = (await settings()).membership.maxPendingPerUser;
      return db.tx(async (tx) => {
        // One person's requests are serialised, so the cap below cannot be passed by two at once.
        await advisory(tx, `org_requests:${user.userId}`);
        // `for share`: an organisation that is being deleted waits for us, or we wait for it, and a
        // request never meets a half-deleted organisation.
        const org = await loadOrganisation(tx, organisationId, 'share');
        if (!types.get(org.type)?.membership) throw new MembershipNotSupported();
        const current = await lockedPair(tx, organisationId, user.userId);
        const outcome = transition(
          current && { state: current.state as State, role: current.role as Role },
          'request',
          'self',
        );
        if (outcome.kind === 'unchanged') {
          return { membership: ownView(current!, refOf(org)), created: false };
        }
        if (outcome.kind === 'refused') throw new MembershipStateConflict(current!.state);
        const [open] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(membership)
          .where(and(eq(membership.userId, user.userId), eq(membership.state, 'requested')));
        if ((open?.n ?? 0) >= maxPending) throw new TooManyPending(maxPending);
        const now = new Date();
        // A reopened row forgets the last decision and role change: the history is the audit trail.
        const fresh = {
          state: 'requested',
          role: 'member',
          requestedAt: now,
          decidedAt: null,
          decidedBy: null,
          endedAt: null,
          endedBy: null,
          roleChangedAt: null,
          roleChangedBy: null,
          updatedAt: now,
        };
        const [row] = current
          ? await tx.update(membership).set(fresh).where(eq(membership.id, current.id)).returning()
          : await tx
              .insert(membership)
              .values({ id: ids.uuidv7(), organisationId, userId: user.userId, ...fresh })
              .returning();
        await ctx.events.emit('registry.membership.requested@1', {
          membershipId: row!.id,
          organisationId,
          userId: user.userId,
        });
        await mail.requested(tx, {
          requesterId: user.userId,
          organisation: { id: org.id, name: org.name },
        });
        return { membership: ownView(row!, refOf(org)), created: true };
      });
    },

    async leave(actor, organisationId) {
      await deps.authz.require(actor, PERMISSION_REQUEST);
      const user = userOf(actor);
      requireId(organisationId);
      return db.tx(async (tx) => {
        const current = await lockedPair(tx, organisationId, user.userId);
        // A rejected or left row is no membership: there is nothing to end.
        if (!current || current.state === 'rejected' || current.state === 'left') {
          throw new NotFound('You have no membership of this organisation to end.');
        }
        const wasManager = current.role === 'manager';
        const action = current.state === 'requested' ? 'withdraw' : 'leave';
        const outcome = transition(
          { state: current.state as State, role: current.role as Role },
          action,
          'self',
        );
        if (outcome.kind !== 'change') throw new MembershipStateConflict(current.state);
        // Row lock first, then the advisory lock, then the count (ADR-0034).
        if (wasManager) await lockManagers(tx, organisationId);
        const now = new Date();
        const [row] = await tx
          .update(membership)
          .set({
            state: outcome.state,
            role: outcome.role,
            endedAt: now,
            endedBy: user.userId,
            updatedAt: now,
          })
          .where(eq(membership.id, current.id))
          .returning();
        const org = await loadOrganisation(tx, organisationId);
        const hasManager = (await managerCount(tx, organisationId)) > 0;
        await ctx.events.emit('registry.membership.left@1', {
          membershipId: current.id,
          organisationId,
          userId: user.userId,
          by: 'member',
          actorId: user.userId,
          organisationHasManager: hasManager,
        });
        if (wasManager && !hasManager) await announceNoManager(tx, org);
        return ownView(row!, refOf(org));
      });
    },

    async listOwn(actor, page) {
      await deps.authz.require(actor, PERMISSION_REQUEST);
      const user = userOf(actor);
      const where = eq(membership.userId, user.userId);
      const [rows, [count]] = await Promise.all([
        db
          .select({ m: membership, o: orgColumns })
          .from(membership)
          .innerJoin(organisation, eq(organisation.id, membership.organisationId))
          .where(where)
          .orderBy(sql`lower(${organisation.abbreviation})`, asc(membership.id))
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(membership)
          .where(where),
      ]);
      return {
        items: rows.map((row) => ownView(row.m, refOf(row.o))),
        total: count?.total ?? 0,
      };
    },

    async listMembers(actor, organisationId, page) {
      await deps.authz.require(actor, PERMISSION_READ);
      requireId(organisationId);
      await deps.authz.require(actor, PERMISSION_VIEW_MEMBERS, resource(organisationId));
      await loadOrganisation(db, organisationId);
      const where = and(
        eq(membership.organisationId, organisationId),
        eq(membership.state, 'approved'),
      );
      const [rows, [count]] = await Promise.all([
        db
          .select({
            userId: membership.userId,
            decidedAt: membership.decidedAt,
            requestedAt: membership.requestedAt,
          })
          .from(membership)
          .where(where)
          .orderBy(asc(membership.decidedAt), asc(membership.id))
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(membership)
          .where(where),
      ]);
      const names = await usernames(rows.map((row) => row.userId));
      return {
        // An account that is gone (its purge has not run yet) is not shown.
        items: rows.flatMap((row) => {
          const username = names.get(row.userId);
          return username ? [{ username, since: row.decidedAt ?? row.requestedAt }] : [];
        }),
        total: count?.total ?? 0,
      };
    },

    listForOrganisation,

    async listPending(actor, filter, page) {
      await deps.authz.require(actor, PERMISSION_READ);
      const user = userOf(actor);
      if (filter.organisationId !== undefined) {
        requireId(filter.organisationId, 'query', 'organisationId');
        return listForOrganisation(
          actor,
          filter.organisationId,
          { ...filter, organisationId: undefined },
          page,
        );
      }
      await requireDecider(actor, user);
      const scope = await decidable(actor, user);
      const conditions = filterConditions(filter);
      if (!scope.admin) {
        // Only the organisations the caller manages; nothing else is even counted.
        if (scope.ids.length === 0) return { items: [], total: 0 };
        conditions.push(inArray(membership.organisationId, scope.ids));
      }
      return managedPage(conditions, page, {
        userId: user.userId,
        by: () => (scope.admin ? 'admin' : 'manager'),
      });
    },

    async summary(actor) {
      await deps.authz.require(actor, PERMISSION_READ);
      const user = userOf(actor);
      const scope = await decidable(actor, user);
      const manages = scope.managed.length > 0;
      if (!scope.admin && scope.ids.length === 0) return { pending: 0, manages };
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(membership)
        .where(
          and(
            eq(membership.state, 'requested'),
            // Nobody decides on their own request, so it is not theirs to count.
            ne(membership.userId, user.userId),
            scope.admin ? undefined : inArray(membership.organisationId, scope.ids),
          ),
        );
      return { pending: row?.n ?? 0, manages };
    },

    async decide(actor, membershipId, decision) {
      await deps.authz.require(actor, PERMISSION_READ);
      const user = userOf(actor);
      requireId(membershipId);
      await requireDecider(actor, user);
      const found = await loadMembership(db, membershipId);
      // The scoped check, with the `approval` rule of core.authz: nobody decides on their own request,
      // an Admin or a manager included, whatever roles they hold.
      await deps.authz.require(actor, PERMISSION_DECIDE, {
        ...resource(found.organisationId),
        approval: true,
        requestedBy: found.userId,
      });
      const by: Exclude<By, 'self'> = (await deps.authz.can(actor, PERMISSION_DECIDE))
        ? 'admin'
        : 'manager';
      return db.tx(async (tx) => {
        const current = await loadMembership(tx, membershipId, true);
        const outcome = transition(
          { state: current.state as State, role: current.role as Role },
          decision === 'approved' ? 'approve' : 'reject',
          by,
        );
        // A second decider arrives late: the row is no longer a request.
        if (outcome.kind !== 'change') throw new MembershipStateConflict(current.state);
        const now = new Date();
        const [row] = await tx
          .update(membership)
          .set({
            state: outcome.state,
            decidedAt: now,
            decidedBy: user.userId,
            updatedAt: now,
          })
          .where(eq(membership.id, membershipId))
          .returning();
        const org = await loadOrganisation(tx, current.organisationId);
        await ctx.events.emit('registry.membership.decided@1', {
          membershipId,
          organisationId: current.organisationId,
          userId: current.userId,
          state: decision,
          by,
          actorId: user.userId,
        });
        await mail.decided(tx, {
          userId: current.userId,
          organisation: { id: org.id, name: org.name },
          decision,
        });
        return managedView(row!, refOf(org), { userId: user.userId, by });
      });
    },

    async setRole(actor, membershipId, role) {
      await deps.authz.require(actor, PERMISSION_READ);
      const user = userOf(actor);
      requireId(membershipId);
      await requireDecider(actor, user);
      const found = await loadMembership(db, membershipId);
      await deps.authz.require(actor, PERMISSION_MANAGE_ROLES, resource(found.organisationId));
      // Whoever the caller is, nobody changes their own role.
      if (found.userId === user.userId) throw new Forbidden('You cannot change your own role.');
      const by: Exclude<By, 'self'> = (await deps.authz.can(actor, PERMISSION_MANAGE_ROLES))
        ? 'admin'
        : 'manager';
      const { membership: limits } = await settings();
      return db.tx(async (tx) => {
        // The target row first, then (below) the organisation's advisory lock, then the count.
        const current = await loadMembership(tx, membershipId, true);
        const outcome = transition(
          { state: current.state as State, role: current.role as Role },
          role === 'manager' ? 'promote' : 'demote',
          by,
        );
        if (outcome.kind === 'refused') throw new MembershipStateConflict(current.state);
        const org = await loadOrganisation(tx, current.organisationId);
        if (outcome.kind === 'unchanged') {
          return managedView(current, refOf(org), { userId: user.userId, by });
        }
        await lockManagers(tx, current.organisationId);
        if (
          role === 'manager' &&
          (await managerCount(tx, current.organisationId)) >= limits.maxManagersPerOrganisation
        ) {
          throw new TooManyManagers(limits.maxManagersPerOrganisation);
        }
        const now = new Date();
        const [row] = await tx
          .update(membership)
          .set({
            role: outcome.role,
            roleChangedAt: now,
            roleChangedBy: user.userId,
            updatedAt: now,
          })
          .where(eq(membership.id, membershipId))
          .returning();
        const hasManager = (await managerCount(tx, current.organisationId)) > 0;
        await ctx.events.emit('registry.membership.roleChanged@1', {
          membershipId,
          organisationId: current.organisationId,
          userId: current.userId,
          from: current.role as Role,
          to: outcome.role,
          by,
          actorId: user.userId,
          organisationHasManager: hasManager,
        });
        await mail.roleChanged(tx, {
          userId: current.userId,
          organisation: { id: org.id, name: org.name },
          role: outcome.role,
        });
        if (role === 'member' && !hasManager) await announceNoManager(tx, org);
        return managedView(row!, refOf(org), { userId: user.userId, by });
      });
    },

    async remove(actor, membershipId) {
      await deps.authz.require(actor, PERMISSION_READ);
      const user = userOf(actor);
      requireId(membershipId);
      await requireDecider(actor, user);
      const found = await loadMembership(db, membershipId);
      await deps.authz.require(actor, PERMISSION_REMOVE, resource(found.organisationId));
      if (found.userId === user.userId) {
        throw new Forbidden('Use leave to end your own membership.');
      }
      const by: Exclude<By, 'self'> = (await deps.authz.can(actor, PERMISSION_REMOVE))
        ? 'admin'
        : 'manager';
      return db.tx(async (tx) => {
        // The state and the role are read again under the lock: a member promoted a moment ago is a
        // manager now, and a manager cannot remove a manager.
        const current = await loadMembership(tx, membershipId, true);
        const outcome = transition(
          { state: current.state as State, role: current.role as Role },
          'remove',
          by,
        );
        if (outcome.kind === 'refused' && outcome.reason === 'manager-target') {
          throw new Forbidden('Only an administrator can remove a manager.');
        }
        if (outcome.kind !== 'change') throw new MembershipStateConflict(current.state);
        const wasManager = current.role === 'manager';
        if (wasManager) await lockManagers(tx, current.organisationId);
        const now = new Date();
        const [row] = await tx
          .update(membership)
          .set({
            state: outcome.state,
            role: outcome.role,
            endedAt: now,
            endedBy: user.userId,
            updatedAt: now,
          })
          .where(eq(membership.id, membershipId))
          .returning();
        const org = await loadOrganisation(tx, current.organisationId);
        const hasManager = (await managerCount(tx, current.organisationId)) > 0;
        await ctx.events.emit('registry.membership.left@1', {
          membershipId,
          organisationId: current.organisationId,
          userId: current.userId,
          by,
          actorId: user.userId,
          organisationHasManager: hasManager,
        });
        if (wasManager && !hasManager) await announceNoManager(tx, org);
        // The removed person is not mailed (backlog).
        return managedView(row!, refOf(org), { userId: user.userId, by });
      });
    },

    async isApprovedMemberAsSystem(userId, organisationId) {
      if (!isUuid(userId) || !isUuid(organisationId)) return false;
      const [row] = await db
        .select({ id: membership.id })
        .from(membership)
        .where(
          and(
            eq(membership.userId, userId),
            eq(membership.organisationId, organisationId),
            eq(membership.state, 'approved'),
          ),
        );
      return row !== undefined;
    },

    async listApprovedOrganisationIdsAsSystem(userId) {
      if (!isUuid(userId)) return [];
      const rows = await db
        .select({ id: membership.organisationId })
        .from(membership)
        .where(and(eq(membership.userId, userId), eq(membership.state, 'approved')))
        .orderBy(asc(membership.organisationId));
      return rows.map((row) => row.id);
    },

    async countApprovedMembersAsSystem(organisationIds) {
      const valid = [...new Set(organisationIds)].filter(isUuid);
      const counts = await approvedCounts(db, valid);
      return Object.fromEntries(counts);
    },

    async isManagerAsSystem(userId, organisationId) {
      if (!isUuid(userId) || !isUuid(organisationId)) return false;
      const [row] = await db
        .select({ id: membership.id })
        .from(membership)
        .where(
          and(
            eq(membership.userId, userId),
            eq(membership.organisationId, organisationId),
            eq(membership.state, 'approved'),
            eq(membership.role, 'manager'),
          ),
        );
      return row !== undefined;
    },

    async purgeUserAsSystem(userId) {
      if (!isUuid(userId)) return;
      await db.tx(async (tx) => {
        // Every row of the person, locked in id order, then the advisory locks in organisation order:
        // the same order as every other change (rows, then advisory), so no cycle can form.
        const rows = await tx
          .select()
          .from(membership)
          .where(eq(membership.userId, userId))
          .orderBy(asc(membership.id))
          .for('update');
        if (rows.length === 0) return; // idempotent: a second run finds nothing
        const managed = [
          ...new Set(
            rows
              .filter((r) => r.state === 'approved' && r.role === 'manager')
              .map((r) => r.organisationId),
          ),
        ].sort();
        for (const organisationId of managed) await lockManagers(tx, organisationId);
        // By id, scoped to this person's rows: never by anything looser.
        await tx.delete(membership).where(
          inArray(
            membership.id,
            rows.map((r) => r.id),
          ),
        );
        for (const row of rows.filter((r) => r.state === 'approved')) {
          const hasManager = (await managerCount(tx, row.organisationId)) > 0;
          await ctx.events.emit('registry.membership.left@1', {
            membershipId: row.id,
            organisationId: row.organisationId,
            userId,
            by: 'system',
            actorId: null,
            organisationHasManager: hasManager,
          });
          if (row.role === 'manager' && !hasManager) {
            await announceNoManager(tx, await loadOrganisation(tx, row.organisationId));
          }
        }
      });
    },
  };
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
