// The template of registry.services (M7 sprint 3), contributed to `notify.template`: the notice to a provider
// when a Reviewer or an administrator makes its service public or private again. The category `registry-service`
// is the one a person can switch the mail off in; the inbox item is always written.
//
// The mail names the service and says what changed, and carries a link. It names nobody: not the person who
// decided, and no address beyond the recipient's own.
import { z } from '@scorpion/contracts';
import { defineTemplate } from '@scorpion/core-notifications/public';

const CATEGORY_SERVICE = {
  en: 'Notices about your services: when one is made public or private.',
  de: 'Hinweise zu Ihren Diensten: wenn einer öffentlich oder wieder nicht öffentlich gemacht wird.',
};

export const servicePublication = defineTemplate({
  key: 'registry.service-publication',
  // To the managers of the provider and the creator of the service, never to the person who decided.
  schema: z.strictObject({
    service: z.string().min(1).max(200),
    state: z.enum(['public', 'private']),
    serviceUrl: z.url().max(2048),
  }),
  category: 'registry-service',
  categoryDescription: CATEGORY_SERVICE,
  catalogue: {
    en: {
      'subject.public': 'Your service {service} is now public',
      'subject.private': 'Your service {service} is no longer public',
      'heading.public': '{service} is now public',
      'heading.private': '{service} is no longer public',
      'body.public':
        'Anyone, signed in or not, can now read the name, description, links, provider and consortia of {service}. The contact point is never public.',
      'body.private': 'Only people who are signed in can read {service} now.',
      action: 'Open {service}',
    },
    de: {
      'subject.public': 'Ihr Dienst {service} ist jetzt öffentlich',
      'subject.private': 'Ihr Dienst {service} ist nicht mehr öffentlich',
      'heading.public': '{service} ist jetzt öffentlich',
      'heading.private': '{service} ist nicht mehr öffentlich',
      'body.public':
        'Name, Beschreibung, Links, Anbieter und Konsortien von {service} kann jetzt jeder lesen, angemeldet oder nicht. Die Kontaktstelle ist nie öffentlich.',
      'body.private': 'Nur angemeldete Personen können {service} jetzt lesen.',
      action: '{service} öffnen',
    },
  },
  content: (data, { t }) => {
    const vars = { service: data.service };
    return {
      subject: t(`subject.${data.state}`, vars),
      heading: t(`heading.${data.state}`, vars),
      blocks: [
        { kind: 'text', text: t(`body.${data.state}`, vars) },
        { kind: 'action', label: t('action', vars), url: data.serviceUrl },
      ],
    };
  },
});

export const TEMPLATES = [servicePublication];
