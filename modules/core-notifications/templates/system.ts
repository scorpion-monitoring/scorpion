// Templates of this module's own messages. Kept apart from SHIPPED_TEMPLATES, which are the ones
// for modules that do not exist yet.
import { z } from '@scorpion/contracts';
import { defineTemplate } from '../service/templates/define.ts';

/** The key of the mail `POST /notifications/test` sends. */
export const TEST_TEMPLATE = 'notifications.test';

export const testMail = defineTemplate({
  key: TEST_TEMPLATE,
  // To the administrator who asked for it, at their own address: proves the transport works.
  schema: z.strictObject({}),
  category: 'system',
  categoryDescription: {
    en: 'Messages about the mail system itself, such as the test mail an administrator sends.',
    de: 'Nachrichten über das Mailsystem selbst, etwa die Testmail eines Administrators.',
  },
  // The administrator asked for it: no preference may swallow it.
  mandatory: true,
  catalogue: {
    en: {
      subject: 'Test mail from {instance}',
      heading: 'The mail transport works',
      body: 'An administrator asked for this test message. If you can read it, mail from {instance} reaches you.',
    },
    de: {
      subject: 'Testmail von {instance}',
      heading: 'Der Mailversand funktioniert',
      body: 'Ein Administrator hat diese Testnachricht angefordert. Wenn Sie sie lesen können, erreichen Sie Mails von {instance}.',
    },
  },
  content: (_data, { t, branding }) => ({
    subject: t('subject', { instance: branding.instanceName }),
    heading: t('heading'),
    blocks: [{ kind: 'text', text: t('body', { instance: branding.instanceName }) }],
  }),
});

export const SYSTEM_TEMPLATES = [testMail];
