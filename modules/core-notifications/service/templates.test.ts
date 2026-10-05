// `enqueueTemplate` on real Postgres: the mail is rendered inside the caller's transaction from a
// registered template, in the right language, with the branding of the instance, and stored like
// any other message. Plus what the registry refuses at start.
import { Invalid, z } from '@scorpion/contracts';
import { createKernel, createLogger, defineModule, loadConfig } from '@scorpion/kernel';
import authzModule from '@scorpion/core-authz/module';
import authzPackage from '@scorpion/core-authz/package.json' with { type: 'json' };
import { createSettingsModule } from '@scorpion/core-settings/module';
import settingsPackage from '@scorpion/core-settings/package.json' with { type: 'json' };
import { makeSecretsKey } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import notificationsModule from '../module.ts';
import packageJson from '../package.json' with { type: 'json' };
import { startSmtpServer } from '../test/smtp-server.ts';
import { useNotifications } from '../test/harness.ts';
import { NotificationError } from './notifications.ts';

const harness = useNotifications();
const recipient = { address: 'ada@example.org' };

describe('enqueueTemplate', () => {
  it('renders the template and stores the mail, queued, in English by default', async () => {
    const t = await harness.start();
    const id = await t.mail.sendTemplate({
      template: 'fix.hello',
      data: { name: 'Ada' },
      recipient: { ...recipient, userId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' },
    });
    const row = await t.delivery(id);
    expect(row).toMatchObject({
      template: 'fix.hello',
      channel: 'email',
      recipient_address: 'ada@example.org',
      recipient_user_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      locale: 'en',
      subject: 'Hello Ada',
      sensitive: false,
      status: 'queued',
    });
    expect(row.text_body).toContain('Welcome, Ada.');
    expect(row.html_body).toContain('<p style=');
    expect(row.html_body).toContain('Welcome, Ada.');
  });

  it('takes the instance name, contact address, imprint and logo from the branding settings', async () => {
    const hash = 'a'.repeat(64);
    const t = await harness.start({
      branding: {
        instanceName: 'Atlas Registry',
        contactEmail: 'help@atlas.example',
        imprintUrl: 'https://atlas.example/imprint',
        logos: { light: hash },
      },
    });
    const row = await t.delivery(
      await t.mail.sendTemplate({ template: 'fix.hello', data: { name: 'Ada' }, recipient }),
    );
    expect(row.text_body).toContain('This message was sent by Atlas Registry.');
    expect(row.text_body).toContain('help@atlas.example');
    expect(row.text_body).toContain('Imprint: https://atlas.example/imprint');
    expect(row.html_body).toContain(`src="http://localhost:3000/api/internal/files/${hash}"`);
  });

  it('builds the logo URL below a base path of several segments', async () => {
    const hash = 'b'.repeat(64);
    const t = await harness.start({
      branding: { logos: { light: hash } },
      env: { BASE_PATH: '/apps/scorpion', ORIGIN: 'https://example.org' },
    });
    const row = await t.delivery(
      await t.mail.sendTemplate({ template: 'fix.hello', data: { name: 'Ada' }, recipient }),
    );
    expect(row.html_body).toContain(
      `src="https://example.org/apps/scorpion/api/internal/files/${hash}"`,
    );
  });

  it.each([
    ['a shipped locale the caller names', 'de', undefined, 'de', 'Hallo Ada'],
    ['a regional tag of a shipped language', 'de-AT', undefined, 'de', 'Hallo Ada'],
    ['no locale: the default locale setting', undefined, 'de', 'de', 'Hallo Ada'],
    ['an unsupported locale: the default locale', 'fr', 'de', 'de', 'Hallo Ada'],
    ['an unsupported locale and an unsupported default: English', 'fr', 'pt', 'en', 'Hello Ada'],
    ['the caller wins over the default', 'en', 'de', 'en', 'Hello Ada'],
  ])('%s', async (_name, requested, defaultLocale, stored, subject) => {
    const t = await harness.start({ settings: defaultLocale ? { defaultLocale } : undefined });
    const row = await t.delivery(
      await t.mail.sendTemplate({
        template: 'fix.hello',
        data: { name: 'Ada' },
        recipient,
        locale: requested,
      }),
    );
    expect([row.locale, row.subject]).toEqual([stored, subject]);
  });

  it('lets the template decide `sensitive`; the scrub then empties the bodies once sent', async () => {
    const t = await harness.start();
    const id = await t.mail.sendTemplate({
      template: 'fix.secret-link',
      data: { link: 'https://example.org/x#token=sev_secret' },
      recipient,
    });
    const queued = await t.delivery(id);
    expect(queued.sensitive).toBe(true);
    expect(queued.text_body).toContain('sev_secret');
    await t.notifications.deliverDue(); // the transport is `none`: accepted and dropped
    expect(await t.delivery(id)).toMatchObject({
      status: 'sent',
      text_body: null,
      html_body: null,
    });
  });

  it('stores nothing when the caller’s transaction rolls back, and the mail when it commits', async () => {
    const t = await harness.start();
    await expect(
      t.mail.sendTemplate(
        { template: 'fix.hello', data: { name: 'Ada' }, recipient },
        { failAfter: true },
      ),
    ).rejects.toThrow('the work failed');
    expect(await t.deliveries()).toEqual([]);
    await t.mail.sendTemplate({ template: 'fix.hello', data: { name: 'Ada' }, recipient });
    expect(await t.deliveries()).toHaveLength(1);
  });

  it('throws outside ctx.db.tx(), also with a transaction that is not the kernel’s', async () => {
    const t = await harness.start();
    await expect(
      t.mail.templateOutsideTx({ template: 'fix.hello', data: { name: 'Ada' }, recipient }),
    ).rejects.toBeInstanceOf(NotificationError);
    expect(await t.deliveries()).toEqual([]);
  });

  it('refuses data the schema rejects (422) naming fields and never repeating a value', async () => {
    const t = await harness.start();
    const secret = 'S3CRET-VALUE-IN-AN-UNKNOWN-FIELD';
    const error = await t.mail
      .sendTemplate({ template: 'fix.hello', data: { name: 42, extra: secret }, recipient })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    expect(JSON.stringify((error as Invalid).errors)).toContain('data.name');
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(await t.deliveries()).toEqual([]);
  });

  it('refuses a bad recipient address and an unknown template, storing nothing', async () => {
    const t = await harness.start();
    await expect(
      t.mail.sendTemplate({
        template: 'fix.hello',
        data: { name: 'Ada' },
        recipient: { address: 'not an address' },
      }),
    ).rejects.toBeInstanceOf(Invalid);
    const error = await t.mail
      .sendTemplate({ template: 'nope.missing', data: {}, recipient })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotificationError);
    expect((error as Error).message).toContain('nope.missing');
    expect(await t.deliveries()).toEqual([]);
  });

  it('keeps a hostile name out of the headers: one subject, no injected header, escaped HTML', async () => {
    const smtp = await startSmtpServer();
    try {
      const t = await harness.start({
        settings: {
          emailTransport: 'smtp',
          smtp: { host: '127.0.0.1', port: smtp.port, tls: 'none', timeoutSeconds: 2 },
        },
      });
      const name = 'Eve\r\nBcc: attacker@example.org\r\n\r\n<script>alert(1)</script>\u202E';
      const id = await t.mail.sendTemplate({ template: 'fix.hello', data: { name }, recipient });
      const row = await t.delivery(id);
      expect(row.subject).toBe('Hello Eve Bcc: attacker@example.org <script>alert(1)</script>');
      expect(row.html_body).not.toContain('<script');
      expect(row.html_body).toContain('&lt;script&gt;');
      await t.notifications.deliverDue();
      expect(smtp.received).toHaveLength(1);
      const [headers] = smtp.received[0]!.data.split('\r\n\r\n');
      expect(smtp.received[0]!.to).toEqual(['ada@example.org']);
      expect(headers).not.toMatch(/^Bcc:/im);
      expect(headers!.match(/^Subject:/gim)).toHaveLength(1);
    } finally {
      await smtp.stop();
    }
  });

  it('falls back to English for a message the language lacks, and logs the template, key and language only', async () => {
    const t = await harness.start();
    const row = await t.delivery(
      await t.mail.sendTemplate({
        template: 'fix.partial',
        data: { name: 'Secret Name' },
        recipient,
        locale: 'de',
      }),
    );
    expect(row.text_body).toContain('Only in English for Secret Name');
    const line = t.logs.find((l) => l.includes('missing in this language'))!;
    expect(JSON.parse(line)).toMatchObject({ template: 'fix.partial', key: 'extra', locale: 'de' });
    expect(t.logs.join('')).not.toContain('Secret Name');
    expect(t.logs.join('')).not.toContain('ada@example.org');
  });
});

describe('the registry notify.template at start', () => {
  async function startWith(entry: unknown, extra: unknown[] = []) {
    const databaseUrl = await harness.server().createDatabase();
    const fixture = defineModule<unknown, 'core.notifications'>({
      id: 'fix.templates',
      version: '1.0.0',
      contributes: { 'notify.template': [entry, ...extra] },
    });
    const kernel = createKernel({
      profile: {
        name: 'templates-test',
        modules: ['core.authz', 'core.settings', 'core.notifications', 'fix.templates'] as never,
      },
      sources: [
        { manifest: authzModule, packageJson: authzPackage },
        {
          manifest: createSettingsModule({ env: { SECRETS_KEY: makeSecretsKey() } }),
          packageJson: settingsPackage,
        },
        { manifest: notificationsModule, packageJson },
        {
          manifest: fixture,
          packageJson: {
            name: '@scorpion/fix-templates',
            dependencies: { '@scorpion/core-notifications': 'workspace:*' },
          },
        },
      ],
      modulePackages: {
        'core.authz': '@scorpion/core-authz',
        'core.settings': '@scorpion/core-settings',
        'core.notifications': '@scorpion/core-notifications',
        'fix.templates': '@scorpion/fix-templates',
      },
      config: loadConfig({ DATABASE_URL: databaseUrl, PROFILE: 'templates-test' }),
      log: createLogger({ level: 'silent' }),
    });
    try {
      await kernel.start();
    } finally {
      await kernel.stop().catch(() => undefined);
    }
  }

  const valid = {
    key: 'fix.valid',
    schema: z.object({}),
    sensitive: false,
    category: 'test',
    mandatory: false,
    catalogue: { en: { a: 'x' }, de: { a: 'y' } },
    render: () => ({ subject: 's', text: 't', html: 'h' }),
  };

  it('starts with a template that has both catalogues', async () => {
    await expect(startWith(valid)).resolves.toBeUndefined();
  });

  it('fails the start for a template without a German catalogue, naming the key’s entry', async () => {
    const { de: _de, ...onlyEnglish } = valid.catalogue;
    await expect(startWith({ ...valid, catalogue: onlyEnglish })).rejects.toThrow(/de/);
  });

  it('fails the start for an empty catalogue, a bad key and a template that is not a function', async () => {
    await expect(startWith({ ...valid, catalogue: { en: { a: 'x' }, de: {} } })).rejects.toThrow();
    await expect(startWith({ ...valid, key: 'NoDots' })).rejects.toThrow();
    await expect(startWith({ ...valid, render: 'not a function' })).rejects.toThrow();
  });

  it('fails the start when two modules contribute the same key', async () => {
    await expect(startWith(valid, [valid])).rejects.toThrow(/fix\.valid.*twice/);
  });
});
