// Templates of the registry module (M6). They ship here, registered, with schemas and render tests,
// so M6 only enqueues them. When `registry.*` exists it takes them over (backlog).
import { z } from '@scorpion/contracts';
import { defineTemplate } from '../service/templates/define.ts';

const CATEGORY_MEMBERSHIP = {
  en: 'Requests to join a provider and the decisions on them.',
  de: 'Anfragen zur Mitgliedschaft bei einem Anbieter und die Entscheidungen dazu.',
};

const url = z.url().max(2048);

export const membershipRequested = defineTemplate({
  key: 'registry.membership-requested',
  // To the administrators: somebody asks to be a member of one or more providers.
  schema: z.strictObject({
    applicant: z.string().min(1).max(200),
    providers: z.array(z.string().min(1).max(200)).min(1).max(50),
    reviewUrl: url,
  }),
  category: 'membership',
  categoryDescription: CATEGORY_MEMBERSHIP,
  catalogue: {
    en: {
      subject: 'Membership request from {applicant}',
      heading: 'A membership request is waiting',
      intro: '{applicant} asks to become a member of:',
      action: 'Review the request',
    },
    de: {
      subject: 'Mitgliedschaftsanfrage von {applicant}',
      heading: 'Eine Mitgliedschaftsanfrage wartet auf Prüfung',
      intro: '{applicant} möchte Mitglied werden bei:',
      action: 'Anfrage prüfen',
    },
  },
  content: (data, { t }) => ({
    subject: t('subject', { applicant: data.applicant }),
    heading: t('heading'),
    blocks: [
      { kind: 'text', text: t('intro', { applicant: data.applicant }) },
      { kind: 'list', items: data.providers },
      { kind: 'action', label: t('action'), url: data.reviewUrl },
    ],
  }),
});

export const membershipDecided = defineTemplate({
  key: 'registry.membership-decided',
  // To the applicant: the decision on their membership request.
  schema: z.strictObject({
    provider: z.string().min(1).max(200),
    decision: z.enum(['approved', 'rejected']),
    providerUrl: url.optional(),
    note: z.string().max(1000).optional(),
  }),
  category: 'membership',
  categoryDescription: CATEGORY_MEMBERSHIP,
  catalogue: {
    en: {
      'subject.approved': 'Your membership of {provider} was approved',
      'subject.rejected': 'Your membership request for {provider} was not approved',
      'heading.approved': 'You are a member of {provider}',
      'heading.rejected': 'Your request for {provider} was not approved',
      'body.approved':
        'An administrator approved your request. You can now work with the services of {provider}.',
      'body.rejected': 'An administrator did not approve your request.',
      noteLabel: 'Note from the administrator:',
      action: 'Open {provider}',
    },
    de: {
      'subject.approved': 'Ihre Mitgliedschaft bei {provider} wurde bestätigt',
      'subject.rejected': 'Ihre Mitgliedschaftsanfrage für {provider} wurde nicht bestätigt',
      'heading.approved': 'Sie sind Mitglied von {provider}',
      'heading.rejected': 'Ihre Anfrage für {provider} wurde nicht bestätigt',
      'body.approved':
        'Ein Administrator hat Ihre Anfrage bestätigt. Sie können jetzt mit den Diensten von {provider} arbeiten.',
      'body.rejected': 'Ein Administrator hat Ihre Anfrage nicht bestätigt.',
      noteLabel: 'Hinweis des Administrators:',
      action: '{provider} öffnen',
    },
  },
  content: (data, { t }) => {
    const vars = { provider: data.provider };
    return {
      subject: t(`subject.${data.decision}`, vars),
      heading: t(`heading.${data.decision}`, vars),
      blocks: [
        { kind: 'text', text: t(`body.${data.decision}`, vars) },
        // A note is free text that somebody typed: it is a text block, so the layout cleans and escapes it.
        ...(data.note ? [{ kind: 'text' as const, text: `${t('noteLabel')}\n${data.note}` }] : []),
        ...(data.providerUrl && data.decision === 'approved'
          ? [{ kind: 'action' as const, label: t('action', vars), url: data.providerUrl }]
          : []),
      ],
    };
  },
});
