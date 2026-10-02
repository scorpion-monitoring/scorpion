// The Mailer port: the one way core.identity sends an email. Two implementations (sprint plan §1):
// SMTP over Nodemailer, which reads `SMTP_URL` (the dev Mailpit is `smtp://localhost:1025`), and an
// in-memory one for tests. M4 reuses the transport behind core.notifications; templates, queueing
// and retries are M4's.
//
// What may be logged: that a mail was not sent, its kind and a reason code. Never the address,
// the subject, the body or the SMTP URL (it can hold a password).
import { createTransport } from 'nodemailer';
import type { Logger } from '@scorpion/kernel';

/** What a mail is for. The only thing about a mail that may appear in a log line. */
export type MailKind = 'password-reset' | 'email-verification';

export interface Mail {
  kind: MailKind;
  to: string;
  from: string;
  subject: string;
  /** Plain text. There is no HTML part: no template engine before M4. */
  text: string;
}

export interface Mailer {
  /**
   * Hands the mail to the transport. Rejects with `MailerUnavailable` when no transport is
   * configured, and with whatever the transport throws when it fails. Never log the rejection:
   * use `describeFailure`.
   */
  send(mail: Mail): Promise<void>;
}

/** No SMTP_URL: the mailer refuses to send, so nothing is silently dropped or logged in the clear. */
export class MailerUnavailable extends Error {
  constructor() {
    super('No mail transport is configured (SMTP_URL).');
    this.name = 'MailerUnavailable';
  }
}

/** A reason that is safe to log: an error code, never a message (messages can carry an address). */
export function describeFailure(error: unknown): string {
  if (error instanceof MailerUnavailable) return 'not-configured';
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code) ? code : 'send-failed';
}

/** The default when `SMTP_URL` is not set. */
export function createUnconfiguredMailer(): Mailer {
  return {
    send() {
      return Promise.reject(new MailerUnavailable());
    },
  };
}

export interface SmtpOptions {
  /** Milliseconds, for the connection, the greeting and each socket stall. */
  timeoutMs?: number;
}

/** `smtp://host:port` for a plain relay (Mailpit), `smtps://user:pass@host:465` for TLS. */
export function createSmtpMailer(url: string, options: SmtpOptions = {}): Mailer {
  const timeout = options.timeoutMs ?? 10_000;
  const transport = createTransport({
    url,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  });
  return {
    async send(mail) {
      await transport.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
    },
  };
}

/** For tests: keeps what was sent, in order. */
export interface MemoryMailer extends Mailer {
  readonly sent: readonly Mail[];
  /** Makes the next sends fail, as a transport would. */
  failWith(error: Error | undefined): void;
  clear(): void;
}

export function createMemoryMailer(): MemoryMailer {
  const sent: Mail[] = [];
  let failure: Error | undefined;
  return {
    sent,
    send(mail) {
      if (failure) return Promise.reject(failure);
      sent.push(mail);
      return Promise.resolve();
    },
    failWith(error) {
      failure = error;
    },
    clear() {
      sent.length = 0;
    },
  };
}

/** SMTP when `SMTP_URL` is set, else a mailer that refuses. Read once, when the module starts. */
export function mailerFromEnvironment(env: Record<string, string | undefined>): Mailer {
  const url = env.SMTP_URL;
  return url === undefined || url === '' ? createUnconfiguredMailer() : createSmtpMailer(url);
}

/**
 * Sends a mail without making the caller wait for it or learn how it went. A request that
 * answered "the mail is sent" only for addresses that exist would tell an observer which ones do;
 * so the caller answers first and the mail goes out here. A failure is logged as a kind and a
 * reason code, nothing else. Returns the promise for tests; production callers ignore it.
 */
export function dispatch(mailer: Mailer, log: Logger, mail: Mail): Promise<void> {
  return mailer.send(mail).catch((error: unknown) => {
    const reason = describeFailure(error);
    if (reason === 'not-configured') {
      log.warn({ kind: mail.kind }, 'an email was not sent: no mail transport is configured');
    } else {
      log.error({ kind: mail.kind, reason }, 'an email could not be sent');
    }
  });
}
