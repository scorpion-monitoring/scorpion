import { createTransport } from 'nodemailer';
import { SMTP_PASSWORD_SECRET } from '../../settings-schema.ts';
import { TransportError, type TransportEntry } from './types.ts';

/** Email over SMTP with Nodemailer. Host, port, TLS mode and user are settings; the password is a secret. */
export const smtpTransport: TransportEntry = {
  id: 'smtp',
  channel: 'email',
  async create({ settings, secret }) {
    const { host, port, tls, user, timeoutSeconds } = settings.smtp;
    if (host === '') throw new TransportError('not-configured');
    const password = user === '' ? undefined : await secret(SMTP_PASSWORD_SECRET);
    if (user !== '' && password === undefined) throw new TransportError('not-configured');
    const timeout = timeoutSeconds * 1000;
    const transport = createTransport({
      host,
      port,
      secure: tls === 'tls',
      requireTLS: tls === 'starttls',
      ignoreTLS: tls === 'none',
      ...(password === undefined ? {} : { auth: { user, pass: password } }),
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    });
    return {
      id: 'smtp',
      async send(message) {
        if (message.to === null) throw new TransportError('no-recipient');
        await transport.sendMail({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html === null ? {} : { html: message.html }),
        });
      },
      close: () => transport.close(),
    };
  },
};
