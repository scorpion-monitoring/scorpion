// The text of the mails core.identity sends. Plain text, English, no template engine (M4 brings
// templates and localisation). The instance name and the sender come from settings, never from
// this file. The link carries the token in the URL fragment: a fragment is not sent to the server
// or to a proxy's access log and not in a Referer header, and the page that M5 builds reads it and
// posts it to the confirm route.
import { mountPath } from '@scorpion/kernel';
import type { Mail, MailKind } from './mailer.ts';

export const RESET_PAGE = '/reset-password';
export const VERIFY_PAGE = '/verify-email';

export interface MailContext {
  config: { ORIGIN: string; BASE_PATH: string };
  instanceName: string;
  from: string;
}

/** `<ORIGIN><BASE_PATH><page>#token=<token>`; any number of path segments in BASE_PATH works. */
export function linkTo(
  config: MailContext['config'],
  page: typeof RESET_PAGE | typeof VERIFY_PAGE,
  token: string,
): string {
  return `${config.ORIGIN}${mountPath(config)}${page}#token=${encodeURIComponent(token)}`;
}

export function resetMail(context: MailContext, to: string, token: string): Mail {
  const kind: MailKind = 'password-reset';
  return {
    kind,
    to,
    from: context.from,
    subject: `Reset your ${context.instanceName} password`,
    text: [
      `Someone asked to reset the password of your account on ${context.instanceName}.`,
      '',
      'To choose a new password, open this link within 1 hour. It works once.',
      linkTo(context.config, RESET_PAGE, token),
      '',
      'If you did not ask for this, ignore this email. Your password stays as it is.',
      '',
    ].join('\n'),
  };
}

export function verificationMail(context: MailContext, to: string, token: string): Mail {
  const kind: MailKind = 'email-verification';
  return {
    kind,
    to,
    from: context.from,
    subject: `Confirm your email address for ${context.instanceName}`,
    text: [
      `Please confirm that this email address belongs to your account on ${context.instanceName}.`,
      '',
      'Open this link within 24 hours. It works once.',
      linkTo(context.config, VERIFY_PAGE, token),
      '',
      'If you did not ask for this, ignore this email.',
      '',
    ].join('\n'),
  };
}
