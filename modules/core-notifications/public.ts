// The only file other modules may import. It holds the service interface and nothing else.
//
// `enqueue` is for trusted code (ADR 0019): it checks no permission, like the system methods of
// core.authz (ADR 0015). The trust boundary is the profile's module list.
import type { Actor } from '@scorpion/contracts';
import type { DbTx } from '@scorpion/kernel';
import type { NotificationMessage } from './service/message.ts';

export type { NotificationMessage };
export {
  defineTemplate,
  TEMPLATE_REGISTRY,
  type RenderOptions,
  type TemplateContext,
  type TemplateDefinition,
  type TemplateEntry,
} from './service/templates/define.ts';
export type { Block, Content, RenderedMail, TemplateBranding } from './service/templates/layout.ts';
export {
  matchLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from './service/templates/locale.ts';
export { oneLine, escapeHtml } from './service/templates/text.ts';
export {
  RECIPIENT_ADDRESS_REGISTRY,
  type RecipientAddressEntry,
} from './service/recipient-address.ts';
export { PREFERENCES_KEY } from './service/preferences.ts';

/** What a caller hands to `enqueueTemplate`: a template key, its data, the recipient and, optionally, a language. */
export interface TemplateMessage {
  /** A key of the registry `notify.template`, `identity.welcome`. */
  template: string;
  /** Validated by the template's Zod schema; never stored (only the rendered mail is). */
  data: unknown;
  /**
   * Who gets it. `address` is where the mail goes; without one only the inbox can be used. `userId`
   * is an opaque id (no foreign key, ADR 0019): it is kept on the delivery row, owns the inbox item
   * and is how the person's preferences are looked up. At least one of the two is required.
   */
  recipient: { address?: string; userId?: string };
  /**
   * Also write an inbox item for `recipient.userId`, in the same transaction, rendered from the
   * template's own content. Ignored for a `sensitive` template (its link is a credential) and when the
   * person switched the template's category off in-app (unless the template is `mandatory`).
   */
  inApp?: boolean;
  /**
   * A language tag the caller chose (a user's preference, or the one a request carried). It is
   * checked against the shipped list (`SUPPORTED_LOCALES`); anything else falls back to the
   * instance's `defaultLocale`, then to English.
   */
  locale?: string;
}

export interface NotificationStatus {
  /** The transport that carries email: `smtp` or `none`. */
  emailTransport: 'smtp' | 'none';
  /** True when email is not really sent: messages are recorded as `sent` and dropped. Operators should notice. */
  transportIsNone: boolean;
  webhookEnabled: boolean;
  counts: { queued: number; sending: number; sent: number; dead: number };
  /** Messages the transport `none` accepted and dropped: the counter that replaces a warning per mail. */
  sentWithoutTransport: number;
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
  /**
   * Renders a registered template and stores the mail **inside the caller's transaction**, like
   * `enqueue` (and with the same refusal outside `ctx.db.tx()`). The data is validated by the
   * template's schema (`Invalid`, naming fields, never values); the language is the one the caller
   * names if it is shipped, else `defaultLocale`; the template, not the caller, decides whether the
   * mail is `sensitive`. An unknown template key is a `NotificationError` (a bug in the caller).
   * Honours the recipient's preferences (`notifications.preferences`, ADR 0023): a `mandatory` template
   * ignores them; otherwise a category switched off stops its mail and its inbox item. Returns the
   * delivery id, or `null` when no mail was stored: no address, or the person switched email off.
   * With nothing to store at all (no mail, no inbox item) it does nothing and says so only at debug
   * level, with the template key. Checks no permission (trusted code, ADR 0019).
   */
  enqueueTemplate(tx: DbTx, message: TemplateMessage): Promise<string | null>;
  /**
   * Deletes every inbox item of a user, in the caller's transaction; returns how many. For the purge
   * of an account in core.identity. Checks no permission and no route calls it (ADR 0015, 0023).
   */
  removeInboxOfUser(tx: DbTx, userId: string): Promise<number>;
  /** Needs `core.notifications.status.read`. Counts by status, recent error codes and whether email goes nowhere. */
  status(actor: Actor): Promise<NotificationStatus>;
}

// Lets `ctx.deps['core.notifications']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.notifications': NotificationsService;
  }
}
