// The audit decision for every event a loaded module declares (ADR 0021): logged, or skipped with a
// reason. A test fails when a declared event has no entry here, and when an entry names an event that
// no module declares, so a new event is a decision somebody made and not a gap nobody noticed.
//
// `critical` events are always logged. The rest follow the `channels.admin` setting.
import type { AuditActor } from '@scorpion/kernel';

type Payload = Record<string, unknown>;
export interface Subject {
  type: string;
  id: string | null;
}

export interface LoggedEvent {
  decision: 'log';
  /** Role, approval, token, settings and secret changes (and the other security events): logged whatever `channels` says. */
  critical: boolean;
  /** Who caused it. Read from the payload; ids are kept as written. */
  actor: (payload: Payload) => AuditActor;
  subject: (payload: Payload) => Subject | undefined;
}
export interface SkippedEvent {
  decision: 'skip';
  /** Why the trail has no entry for it. */
  reason: string;
}
export type EventDecision = LoggedEvent | SkippedEvent;

const text = (payload: Payload, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

const userBy =
  (key: string) =>
  (payload: Payload): AuditActor => {
    const userId = text(payload, key);
    return userId ? { kind: 'user', userId } : { kind: 'system' };
  };
const system = (): AuditActor => ({ kind: 'system' });
const anonymous = (): AuditActor => ({ kind: 'anonymous' });
const subjectOf =
  (type: string, key: string) =>
  (payload: Payload): Subject => ({ type, id: text(payload, key) });

const log = (
  critical: boolean,
  actor: LoggedEvent['actor'],
  subject: LoggedEvent['subject'],
): LoggedEvent => ({ decision: 'log', critical, actor, subject });

export const EVENT_DECISIONS: Readonly<Record<string, EventDecision>> = {
  // core.authz
  'authz.role.assigned@1': log(true, userBy('actorId'), subjectOf('user', 'userId')),
  'authz.role.removed@1': log(true, userBy('actorId'), subjectOf('user', 'userId')),
  'authz.role.permissions.changed@1': log(true, userBy('actorId'), subjectOf('role', 'roleKey')),

  // core.settings
  'settings.changed@1': log(true, userBy('actorId'), subjectOf('settings', 'module')),
  'settings.secret.changed@1': log(true, userBy('actorId'), subjectOf('secret', 'name')),
  'settings.vocabulary.changed@1': log(false, userBy('actorId'), (payload): Subject => ({
    type: 'vocabulary',
    id: `${text(payload, 'vocabulary') ?? ''}/${text(payload, 'key') ?? ''}`,
  })),
  'settings.preference.changed@1': {
    decision: 'skip',
    reason:
      'A person changing their own display or notification preference: frequent, not an administrative or permission-relevant action. Who changed what is also in the outbox until its retention.',
  },

  // core.identity
  'identity.user.registered@1': log(false, userBy('userId'), subjectOf('user', 'userId')),
  'identity.user.approved@1': log(true, userBy('approvedBy'), subjectOf('user', 'userId')),
  'identity.user.rejected@1': log(true, userBy('rejectedBy'), subjectOf('user', 'userId')),
  'identity.authMethod.linked@1': log(true, userBy('userId'), subjectOf('user', 'userId')),
  // Asked by somebody who is not signed in: the account is the subject, not the actor.
  'identity.password.resetRequested@1': log(true, anonymous, subjectOf('user', 'userId')),
  'identity.password.reset@1': log(true, anonymous, subjectOf('user', 'userId')),
  'identity.password.changed@1': log(true, userBy('userId'), subjectOf('user', 'userId')),
  'identity.email.verified@1': log(false, anonymous, subjectOf('user', 'userId')),
  'identity.user.purged@1': log(true, system, subjectOf('user', 'userId')),
  'identity.profile.updated@1': log(false, userBy('userId'), subjectOf('user', 'userId')),
  'identity.admin.created@1': log(true, system, subjectOf('user', 'userId')),
  'identity.token.created@1': log(true, userBy('userId'), subjectOf('token', 'tokenId')),
  'identity.token.revoked@1': log(true, userBy('revokedBy'), subjectOf('token', 'tokenId')),
  'identity.token.rotated@1': log(true, userBy('userId'), subjectOf('token', 'tokenId')),

  // core.notifications (present only in profiles that have it; see the module's optional peer)
  'notifications.delivery.dead@1': log(false, system, subjectOf('delivery', 'deliveryId')),
  'notifications.delivery.requeued@1': log(
    false,
    userBy('requestedBy'),
    subjectOf('delivery', 'deliveryId'),
  ),
  'notifications.settings.tested@1': log(
    false,
    userBy('requestedBy'),
    subjectOf('delivery', 'deliveryId'),
  ),
};

/** Keys of an event payload that are not stored: the id is enough, and a name is personal data the trail cannot later erase. */
export const PAYLOAD_DROPPED_KEYS: readonly string[] = ['username'];
