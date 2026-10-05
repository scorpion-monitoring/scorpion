// What a caller hands to `enqueue` (ADR 0019), validated with limits. Nothing in an error message
// repeats the address, the subject or a body.
import { Invalid, z } from '@scorpion/contracts';
import { LOCALE } from '../settings-schema.ts';

export const MAX_SUBJECT_LENGTH = 300;
export const MAX_TEXT_LENGTH = 100_000;
export const MAX_HTML_LENGTH = 300_000;
export const MAX_ADDRESS_LENGTH = 254;
/** `identity.password-reset`: lower-case segments joined by dots. */
export const TEMPLATE_KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** A subject goes into a mail header: one line, no control characters (header injection). */
const singleLine = (value: string) =>
  ![...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
  });

const messageSchema = z
  .strictObject({
    template: z.string().min(3).max(100).regex(TEMPLATE_KEY, 'Use a key like "identity.welcome".'),
    channel: z.enum(['email', 'webhook']).default('email'),
    /** The email channel's recipient. The webhook has one configured target and takes none. */
    recipientAddress: z.email().max(MAX_ADDRESS_LENGTH).optional(),
    /** An opaque user id (no foreign key, ADR 0019). */
    recipientUserId: z.uuid().optional(),
    /** Default: the setting `defaultLocale`. */
    locale: z.string().max(20).regex(LOCALE).optional(),
    subject: z.string().min(1).max(MAX_SUBJECT_LENGTH).refine(singleLine, 'Must be one line.'),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
    html: z.string().min(1).max(MAX_HTML_LENGTH).optional(),
    /**
     * The body holds a credential (a reset link). It is deleted from the row once the message is
     * `sent` or `dead`, and a sensitive message cannot go to the webhook.
     */
    sensitive: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.channel === 'email' && !value.recipientAddress) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipientAddress'],
        message: 'The email channel needs a recipient address.',
      });
    }
    if (value.channel === 'webhook' && value.sensitive) {
      ctx.addIssue({
        code: 'custom',
        path: ['sensitive'],
        message: 'A sensitive message cannot go to the webhook.',
      });
    }
  });

export type NotificationMessage = z.input<typeof messageSchema>;
export type ParsedMessage = z.output<typeof messageSchema>;

/** `Invalid` (422) naming the fields, never their values. */
export function parseMessage(message: unknown): ParsedMessage {
  const parsed = messageSchema.safeParse(message);
  if (parsed.success) return parsed.data;
  throw new Invalid(
    'The notification is not valid.',
    parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || 'message',
      message: issue.message,
    })),
  );
}
