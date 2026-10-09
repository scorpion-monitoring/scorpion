// The templates of registry.organisations (M6 sprint 3), contributed to `notify.template`. The two
// membership templates came from core.notifications with the same keys, so no stored mail changes
// shape; they say "organisation" because consortium memberships use the same mails. The other two are
// only ever written as inbox items (no address is passed, so no mail is stored): a role change, and
// an organisation that has no manager left.
//
// A mail names the organisation and the requester's username and never an address beyond the
// recipient's own. The link is built by the caller with the instance origin and the base path.
import { z } from '@scorpion/contracts';
import { defineTemplate } from '@scorpion/core-notifications/public';

const CATEGORY_MEMBERSHIP = {
  en: 'Requests to join an organisation, the decisions on them, and changes to your role in one.',
  de: 'Anfragen zur Mitgliedschaft bei einer Organisation, die Entscheidungen dazu und Änderungen Ihrer Rolle.',
};

const url = z.url().max(2048);
const name = z.string().min(1).max(200);

export const membershipRequested = defineTemplate({
  key: 'registry.membership-requested',
  // To the managers of the organisation and the administrators: somebody asks to become a member.
  schema: z.strictObject({
    applicant: name,
    organisations: z.array(name).min(1).max(50),
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
      { kind: 'list', items: data.organisations },
      { kind: 'action', label: t('action'), url: data.reviewUrl },
    ],
  }),
});

export const membershipDecided = defineTemplate({
  key: 'registry.membership-decided',
  // To the applicant: the decision on their membership request.
  schema: z.strictObject({
    organisation: name,
    decision: z.enum(['approved', 'rejected']),
    organisationUrl: url.optional(),
    note: z.string().max(1000).optional(),
  }),
  category: 'membership',
  categoryDescription: CATEGORY_MEMBERSHIP,
  catalogue: {
    en: {
      'subject.approved': 'Your membership of {organisation} was approved',
      'subject.rejected': 'Your membership request for {organisation} was not approved',
      'heading.approved': 'You are a member of {organisation}',
      'heading.rejected': 'Your request for {organisation} was not approved',
      'body.approved':
        'Your request was approved. You can now work with the services of {organisation}.',
      'body.rejected': 'Your request was not approved.',
      noteLabel: 'Note:',
      action: 'Open {organisation}',
    },
    de: {
      'subject.approved': 'Ihre Mitgliedschaft bei {organisation} wurde bestätigt',
      'subject.rejected': 'Ihre Mitgliedschaftsanfrage für {organisation} wurde nicht bestätigt',
      'heading.approved': 'Sie sind Mitglied von {organisation}',
      'heading.rejected': 'Ihre Anfrage für {organisation} wurde nicht bestätigt',
      'body.approved':
        'Ihre Anfrage wurde bestätigt. Sie können jetzt mit den Diensten von {organisation} arbeiten.',
      'body.rejected': 'Ihre Anfrage wurde nicht bestätigt.',
      noteLabel: 'Hinweis:',
      action: '{organisation} öffnen',
    },
  },
  content: (data, { t }) => {
    const vars = { organisation: data.organisation };
    return {
      subject: t(`subject.${data.decision}`, vars),
      heading: t(`heading.${data.decision}`, vars),
      blocks: [
        { kind: 'text', text: t(`body.${data.decision}`, vars) },
        // A note is free text that somebody typed: it is a text block, so the layout cleans and escapes it.
        ...(data.note ? [{ kind: 'text' as const, text: `${t('noteLabel')}\n${data.note}` }] : []),
        ...(data.organisationUrl && data.decision === 'approved'
          ? [{ kind: 'action' as const, label: t('action', vars), url: data.organisationUrl }]
          : []),
      ],
    };
  },
});

export const membershipRoleChanged = defineTemplate({
  key: 'registry.membership-role-changed',
  // To the person whose role changed. An inbox item only: the caller passes no address.
  schema: z.strictObject({
    organisation: name,
    role: z.enum(['member', 'manager']),
    organisationUrl: url,
  }),
  category: 'membership',
  categoryDescription: CATEGORY_MEMBERSHIP,
  catalogue: {
    en: {
      'subject.manager': 'You are now a manager of {organisation}',
      'subject.member': 'You are no longer a manager of {organisation}',
      'heading.manager': 'You are a manager of {organisation}',
      'heading.member': 'Your role in {organisation} changed',
      'body.manager':
        'You can now decide membership requests of {organisation}, change roles and edit its description.',
      'body.member': 'You are still a member of {organisation}.',
      action: 'Open {organisation}',
    },
    de: {
      'subject.manager': 'Sie sind jetzt Manager von {organisation}',
      'subject.member': 'Sie sind nicht mehr Manager von {organisation}',
      'heading.manager': 'Sie sind Manager von {organisation}',
      'heading.member': 'Ihre Rolle bei {organisation} hat sich geändert',
      'body.manager':
        'Sie können jetzt Mitgliedschaftsanfragen von {organisation} entscheiden, Rollen ändern und die Beschreibung bearbeiten.',
      'body.member': 'Sie sind weiterhin Mitglied von {organisation}.',
      action: '{organisation} öffnen',
    },
  },
  content: (data, { t }) => {
    const vars = { organisation: data.organisation };
    return {
      subject: t(`subject.${data.role}`, vars),
      heading: t(`heading.${data.role}`, vars),
      blocks: [
        { kind: 'text', text: t(`body.${data.role}`, vars) },
        { kind: 'action', label: t('action', vars), url: data.organisationUrl },
      ],
    };
  },
});

export const organisationWithoutManager = defineTemplate({
  key: 'registry.organisation-without-manager',
  // To the administrators, as an inbox item: the last manager of an organisation is gone.
  schema: z.strictObject({ organisation: name, organisationUrl: url }),
  category: 'membership',
  categoryDescription: CATEGORY_MEMBERSHIP,
  catalogue: {
    en: {
      subject: '{organisation} has no manager',
      heading: '{organisation} has no manager',
      body: 'Membership requests of {organisation} are decided by administrators until somebody is made manager.',
      action: 'Open {organisation}',
    },
    de: {
      subject: '{organisation} hat keinen Manager',
      heading: '{organisation} hat keinen Manager',
      body: 'Mitgliedschaftsanfragen von {organisation} entscheiden Administratoren, bis jemand zum Manager ernannt wird.',
      action: '{organisation} öffnen',
    },
  },
  content: (data, { t }) => {
    const vars = { organisation: data.organisation };
    return {
      subject: t('subject', vars),
      heading: t('heading', vars),
      blocks: [
        { kind: 'text', text: t('body', vars) },
        { kind: 'action', label: t('action', vars), url: data.organisationUrl },
      ],
    };
  },
});

export const TEMPLATES = [
  membershipRequested,
  membershipDecided,
  membershipRoleChanged,
  organisationWithoutManager,
];
