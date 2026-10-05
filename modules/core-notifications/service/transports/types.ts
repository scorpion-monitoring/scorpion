// The shape of a transport (registry `notify.transport`, ADR 0020) and what may be said about a failure.
import { z } from '@scorpion/contracts';
import type { NotificationSettings } from '../../settings-schema.ts';

export interface OutgoingMessage {
  id: string;
  template: string;
  channel: 'email' | 'webhook';
  /** The recipient of an email; null for the webhook. */
  to: string | null;
  /** The sender of an email, from the branding settings. */
  from: string;
  subject: string;
  text: string;
  html: string | null;
  locale: string;
  createdAt: Date;
}

export interface Transport {
  /** The id of the registry entry that built it; stored on the delivery row. */
  readonly id: string;
  /** Resolves when the relay accepted the message. Rejects with a `TransportError`, or anything else (mapped by `failureCode`). */
  send: (message: OutgoingMessage, options: { signal?: AbortSignal }) => Promise<void>;
  /** Releases connections when the transport is replaced. */
  close?: () => void;
}

export interface TransportInput {
  settings: NotificationSettings;
  /** `getSecret` of core.settings: the one place a password or a signing secret is read. */
  secret: (name: string) => Promise<string | undefined>;
}

export interface TransportEntry {
  id: string;
  channel: 'email' | 'webhook';
  create: (input: TransportInput) => Transport | Promise<Transport>;
}

export const TRANSPORT_REGISTRY = 'notify.transport';

export const transportEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  channel: z.enum(['email', 'webhook']),
  create: z.custom<TransportEntry['create']>(
    (value) => typeof value === 'function',
    'expected a function',
  ),
});

/** A failure with a code that is safe to store and log (`timeout`, `http-502`, `target-refused`). */
export class TransportError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code); // the message is the code: nothing else about the failure is kept
    this.name = 'TransportError';
    this.code = code;
  }
}

const SAFE_CODE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The code stored in `last_error` and logged: a transport error's own code, or the `code` of a
 * system or Nodemailer error (`ECONNREFUSED`, `EAUTH`), else `send-failed`. Never a message: a
 * message can carry an address or a URL.
 */
export function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : 'send-failed';
}
