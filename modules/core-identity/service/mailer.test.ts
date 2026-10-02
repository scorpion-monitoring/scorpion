import { createServer, type Server } from 'node:net';
import { Writable } from 'node:stream';
import { createLogger } from '@scorpion/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { linkTo, resetMail, verificationMail } from './mail-messages.ts';
import {
  createMemoryMailer,
  createSmtpMailer,
  createUnconfiguredMailer,
  describeFailure,
  dispatch,
  MailerUnavailable,
  mailerFromEnvironment,
  type Mail,
} from './mailer.ts';

const mail: Mail = {
  kind: 'password-reset',
  to: 'alice@example.org',
  from: 'no-reply@localhost',
  subject: 'Hello',
  text: 'open https://x.example/reset#token=srt_secret',
};

function capture() {
  const lines: string[] = [];
  const log = createLogger({
    level: 'trace',
    destination: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  });
  return { log, text: () => lines.join('') };
}

/** Just enough SMTP to accept one message and keep what came in. */
function smtpStub() {
  const received: string[] = [];
  const server: Server = createServer((socket) => {
    let data = false;
    let buffer = '';
    socket.write('220 stub ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (data) {
        if (buffer.endsWith('\r\n.\r\n')) {
          received.push(buffer);
          buffer = '';
          data = false;
          socket.write('250 queued\r\n');
        }
        return;
      }
      for (const line of buffer.split('\r\n').slice(0, -1)) {
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250 stub\r\n');
        else if (verb === 'DATA') {
          socket.write('354 go on\r\n');
          data = true;
        } else if (verb === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
      buffer = data ? '' : '';
    });
  });
  return {
    received,
    start: () =>
      new Promise<string>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          resolve(`smtp://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
        });
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('the in-memory mailer', () => {
  it('keeps what was sent, in order, and can be told to fail', async () => {
    const mailer = createMemoryMailer();
    await mailer.send(mail);
    await mailer.send({ ...mail, to: 'b@example.org' });
    expect(mailer.sent.map((m) => m.to)).toEqual(['alice@example.org', 'b@example.org']);
    mailer.failWith(new Error('down'));
    await expect(mailer.send(mail)).rejects.toThrow('down');
    expect(mailer.sent).toHaveLength(2);
  });
});

describe('the SMTP mailer', () => {
  let stub: ReturnType<typeof smtpStub> | undefined;
  afterEach(async () => {
    await stub?.stop();
    stub = undefined;
  });

  it('delivers to the server named by the URL', async () => {
    stub = smtpStub();
    const mailer = createSmtpMailer(await stub.start(), { timeoutMs: 5_000 });
    await mailer.send(mail);
    expect(stub.received).toHaveLength(1);
    expect(stub.received[0]).toContain('Subject: Hello');
    expect(stub.received[0]).toContain('open https://x.example/reset#token=srt_secret');
  });

  it('fails when nothing listens, with a code that is safe to log', async () => {
    const mailer = createSmtpMailer('smtp://127.0.0.1:1', { timeoutMs: 2_000 });
    const error = await mailer.send(mail).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(describeFailure(error)).toMatch(/^[A-Z_]+$/);
  });
});

describe('without SMTP_URL', () => {
  it('refuses to send, and the log says only that a mail was not sent', async () => {
    const mailer = mailerFromEnvironment({});
    await expect(mailer.send(mail)).rejects.toBeInstanceOf(MailerUnavailable);
    await expect(createUnconfiguredMailer().send(mail)).rejects.toBeInstanceOf(MailerUnavailable);

    const { log, text } = capture();
    await dispatch(mailer, log, mail);
    expect(text()).toContain('an email was not sent');
    expect(text()).toContain('password-reset');
    for (const secret of ['alice@example.org', 'srt_secret', 'Hello', 'reset#token']) {
      expect(text()).not.toContain(secret);
    }
  });

  it('treats an empty SMTP_URL as not set', async () => {
    await expect(mailerFromEnvironment({ SMTP_URL: '' }).send(mail)).rejects.toBeInstanceOf(
      MailerUnavailable,
    );
  });
});

describe('dispatch', () => {
  it('logs a failure as a kind and a code, never the address, the body or the URL', async () => {
    const { log, text } = capture();
    const failing = createMemoryMailer();
    failing.failWith(
      Object.assign(new Error('550 alice@example.org smtp://u:pw@host'), { code: 'EENVELOPE' }),
    );
    await dispatch(failing, log, mail);
    expect(text()).toContain('EENVELOPE');
    for (const secret of ['alice@example.org', 'srt_secret', 'pw@host', 'Hello']) {
      expect(text()).not.toContain(secret);
    }
  });

  it('describes an error without a usable code as a plain failure', () => {
    expect(describeFailure(new Error('x'))).toBe('send-failed');
    expect(
      describeFailure(Object.assign(new Error('x'), { code: 'has spaces and an@address' })),
    ).toBe('send-failed');
    expect(describeFailure(undefined)).toBe('send-failed');
  });
});

describe('the links and texts', () => {
  const context = {
    config: { ORIGIN: 'https://registry.example.org', BASE_PATH: '/a/b' },
    instanceName: 'Registry X',
    from: 'registry@example.org',
  };

  it.each([
    ['/', 'https://registry.example.org/reset-password#token=T'],
    ['/a', 'https://registry.example.org/a/reset-password#token=T'],
    ['/a/b/c', 'https://registry.example.org/a/b/c/reset-password#token=T'],
  ])('builds the link from ORIGIN and BASE_PATH %s', (basePath, expected) => {
    expect(
      linkTo(
        { ORIGIN: 'https://registry.example.org', BASE_PATH: basePath },
        '/reset-password',
        'T',
      ),
    ).toBe(expected);
  });

  it('keeps the token in the fragment and encodes it', () => {
    const link = linkTo(context.config, '/verify-email', 'a b+c');
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toBe('#token=a%20b%2Bc');
  });

  it('takes the instance name and the sender from the context, not from the code', () => {
    const reset = resetMail(context, 'to@example.org', 'srt_x');
    const verify = verificationMail(context, 'to@example.org', 'sev_x');
    for (const m of [reset, verify]) {
      expect(m.from).toBe('registry@example.org');
      expect(m.subject + m.text).toContain('Registry X');
      expect(m.subject + m.text).not.toMatch(/scorpion/i);
    }
    expect(reset.kind).toBe('password-reset');
    expect(verify.kind).toBe('email-verification');
  });
});
