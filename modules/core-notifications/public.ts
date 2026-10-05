// The only file other modules may import. It holds the service interface and nothing else.
//
// `enqueue` is for trusted code (ADR 0019): it checks no permission, like the system methods of
// core.authz (ADR 0015). The trust boundary is the profile's module list.
import type { Actor } from '@scorpion/contracts';
import type { DbTx } from '@scorpion/kernel';
import type { NotificationMessage } from './service/message.ts';

export type { NotificationMessage };

export interface NotificationStatus {
  /** The transport that carries email: `smtp` or `none`. */
  emailTransport: 'smtp' | 'none';
  /** True when email is not really sent: messages are recorded as `sent` and dropped. Operators should notice. */
  transportIsNone: boolean;
  webhookEnabled: boolean;
  counts: { queued: number; sending: number; sent: number; dead: number };
  /** Error codes of the last 7 days, newest first (at most 10): never a message, an address or a URL. */
  lastErrors: { code: string; count: number; lastAt: Date }[];
}

export interface NotificationsService {
  /**
   * Stores a message for delivery **inside the caller's transaction**: call it with the `tx` of
   * `ctx.db.tx()` and the mail exists only if that transaction commits. Throws a `NotificationError`
   * outside `ctx.db.tx()`. Validates the message (`Invalid`, 422, naming fields, never values; subject
   * on one line, address, size limits), inserts the row and sends `pg_notify`, which wakes delivery on
   * commit. Returns the delivery id, or `null` for a webhook message while the webhook is off.
   * A `sensitive` message's bodies are deleted when it reaches `sent` or `dead`; it cannot use the
   * webhook channel. The address stays out of every log line.
   */
  enqueue(tx: DbTx, message: NotificationMessage): Promise<string | null>;
  /** Needs `core.notifications.status.read`. Counts by status, recent error codes and whether email goes nowhere. */
  status(actor: Actor): Promise<NotificationStatus>;
}

// Lets `ctx.deps['core.notifications']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.notifications': NotificationsService;
  }
}
