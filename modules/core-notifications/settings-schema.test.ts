import { describe, expect, it } from 'vitest';
import { settingsSchema } from './settings-schema.ts';

const parse = (value: unknown) => settingsSchema.safeParse(value);
const messages = (value: unknown) => {
  const result = parse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('the settings of core.notifications', () => {
  it('have defaults that work with no relay and no webhook', () => {
    const settings = settingsSchema.parse({});
    expect(settings.emailTransport).toBe('none');
    expect(settings.webhook).toEqual({ enabled: false, url: '', allowPrivateTargets: false });
    expect(settings.smtp).toMatchObject({ host: '', port: 587, tls: 'starttls', user: '' });
    expect(settings.maxAttempts).toBe(8);
    expect(settings.retentionDays).toBe(90);
    expect(settings.defaultLocale).toBe('en');
  });

  it('carry no password and no signing secret: the schema has no such key', () => {
    expect(parse({ smtp: { password: 'x' } }).success).toBe(false);
    expect(parse({ webhook: { secret: 'x' } }).success).toBe(false);
    expect(parse({ smtpUrl: 'smtp://u:p@host' }).success).toBe(false);
  });

  it('need a host when the transport is smtp', () => {
    expect(messages({ emailTransport: 'smtp' })).toEqual([
      'smtp.host: Set the host of the relay, or use the transport "none".',
    ]);
    expect(parse({ emailTransport: 'smtp', smtp: { host: 'mail.example.org' } }).success).toBe(
      true,
    );
  });

  const webhook = (url: string, extra: Record<string, unknown> = {}) => ({
    webhook: { enabled: true, url, ...extra },
  });
  it.each([
    ['https://hooks.example.org/in', {}, true],
    ['http://hooks.example.org/in', {}, false],
    ['http://relay.internal:8080/in', { allowPrivateTargets: true }, true],
    ['ftp://hooks.example.org/in', { allowPrivateTargets: true }, false],
    ['https://user:pass@hooks.example.org/in', {}, false],
    ['not a url', {}, false],
    ['', {}, false],
  ])('webhook url %s %j is valid: %s', (url, extra, valid) => {
    expect(parse(webhook(url, extra)).success).toBe(valid);
  });

  it('does not look at the url while the webhook is off and nothing is typed', () => {
    expect(parse({ webhook: { enabled: false } }).success).toBe(true);
  });

  it.each([
    [{ maxAttempts: 0 }],
    [{ maxAttempts: 21 }],
    [{ retentionDays: 0 }],
    [{ smtp: { port: 70000 } }],
    [{ smtp: { tls: 'ssl' } }],
    [{ emailTransport: 'sendgrid' }],
    [{ defaultLocale: 'English' }],
  ])('rejects %j', (value) => {
    expect(parse(value).success).toBe(false);
  });
});
