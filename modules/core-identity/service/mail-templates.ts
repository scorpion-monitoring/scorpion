// The seven mails of core.identity (M4 plan \u00A75 item 4), as templates of the registry
// `notify.template`. Each has an English and a German catalogue; the layout, the instance name, the
// logo, the contact address and the escaping come from core.notifications. A template holds no
// address or token logic: the service passes ready links, and `sensitive` marks the two that carry a
// credential, so their rendered bodies are deleted once they are sent (ADR 0019).
import { z } from '@scorpion/contracts';
import { defineTemplate } from '@scorpion/core-notifications/public';

const CATEGORY_ACCOUNT = {
  en: 'Messages about your account: welcome, approval and confirmation of your address.',
  de: 'Nachrichten zu Ihrem Konto: Willkommen, Freischaltung und Bestätigung Ihrer Adresse.',
};
const CATEGORY_ADMINISTRATION = {
  en: 'Tasks for administrators, such as registrations that wait for review.',
  de: 'Aufgaben für Administratoren, etwa Registrierungen, die auf Prüfung warten.',
};
const CATEGORY_SECURITY = {
  en: 'Security messages about your sign-in. These cannot be switched off.',
  de: 'Sicherheitsnachrichten zu Ihrer Anmeldung. Sie lassen sich nicht abschalten.',
};

const url = z.url().max(2048);
const name = z.string().min(1).max(200);

export const welcome = defineTemplate({
  key: 'identity.welcome',
  // To the person who registered: the account exists; it waits for review unless a policy activated it.
  schema: z.strictObject({ username: name, pendingReview: z.boolean(), signInUrl: url }),
  category: 'account',
  categoryDescription: CATEGORY_ACCOUNT,
  catalogue: {
    en: {
      subject: 'Welcome to {instance}',
      heading: 'Welcome, {username}',
      created: 'Your account on {instance} was created.',
      pending:
        'An administrator reviews new accounts, usually within 1 to 2 business days. We will write to you as soon as it is decided.',
      ready: 'You can sign in now.',
      action: 'Sign in',
    },
    de: {
      subject: 'Willkommen bei {instance}',
      heading: 'Willkommen, {username}',
      created: 'Ihr Konto bei {instance} wurde angelegt.',
      pending:
        'Ein Administrator prüft neue Konten, in der Regel innerhalb von 1 bis 2 Werktagen. Wir schreiben Ihnen, sobald entschieden ist.',
      ready: 'Sie können sich jetzt anmelden.',
      action: 'Anmelden',
    },
  },
  content: (data, { t, branding }) => {
    const vars = { instance: branding.instanceName, username: data.username };
    return {
      subject: t('subject', vars),
      heading: t('heading', vars),
      blocks: data.pendingReview
        ? [
            { kind: 'text', text: t('created', vars) },
            { kind: 'text', text: t('pending') },
          ]
        : [
            { kind: 'text', text: `${t('created', vars)} ${t('ready')}` },
            { kind: 'action', label: t('action'), url: data.signInUrl },
          ],
    };
  },
});

export const registrationRequest = defineTemplate({
  key: 'identity.registration-request',
  // To every administrator: somebody registered and waits for a decision.
  schema: z.strictObject({
    applicantUsername: name,
    applicantEmail: z.string().min(1).max(254),
    reviewUrl: url,
  }),
  category: 'administration',
  categoryDescription: CATEGORY_ADMINISTRATION,
  catalogue: {
    en: {
      subject: 'Registration request from {username}',
      heading: 'A registration waits for review',
      body: '{username} ({email}) registered on {instance} and waits for approval.',
      action: 'Review registrations',
    },
    de: {
      subject: 'Registrierungsanfrage von {username}',
      heading: 'Eine Registrierung wartet auf Prüfung',
      body: '{username} ({email}) hat sich bei {instance} registriert und wartet auf Freigabe.',
      action: 'Registrierungen prüfen',
    },
  },
  content: (data, { t, branding }) => {
    const vars = {
      instance: branding.instanceName,
      username: data.applicantUsername,
      email: data.applicantEmail,
    };
    return {
      subject: t('subject', vars),
      heading: t('heading'),
      blocks: [
        { kind: 'text', text: t('body', vars) },
        { kind: 'action', label: t('action'), url: data.reviewUrl },
      ],
    };
  },
});

export const approved = defineTemplate({
  key: 'identity.approved',
  schema: z.strictObject({ username: name, signInUrl: url }),
  category: 'account',
  categoryDescription: CATEGORY_ACCOUNT,
  catalogue: {
    en: {
      subject: 'Your account on {instance} was approved',
      heading: 'Your account is approved',
      body: 'Hello {username}, an administrator approved your account on {instance}. You can sign in now.',
      action: 'Sign in',
    },
    de: {
      subject: 'Ihr Konto bei {instance} wurde freigegeben',
      heading: 'Ihr Konto ist freigegeben',
      body: 'Hallo {username}, ein Administrator hat Ihr Konto bei {instance} freigegeben. Sie können sich jetzt anmelden.',
      action: 'Anmelden',
    },
  },
  content: (data, { t, branding }) => {
    const vars = { instance: branding.instanceName, username: data.username };
    return {
      subject: t('subject', vars),
      heading: t('heading'),
      blocks: [
        { kind: 'text', text: t('body', vars) },
        { kind: 'action', label: t('action'), url: data.signInUrl },
      ],
    };
  },
});

export const rejected = defineTemplate({
  key: 'identity.rejected',
  schema: z.strictObject({ username: name }),
  category: 'account',
  categoryDescription: CATEGORY_ACCOUNT,
  catalogue: {
    en: {
      subject: 'Your registration on {instance} was not approved',
      heading: 'Your registration was not approved',
      body: 'Hello {username}, an administrator did not approve your registration on {instance}.',
      contact: 'If you think this is a mistake, write to {email}.',
      contactNone: 'If you think this is a mistake, contact the administrators of {instance}.',
    },
    de: {
      subject: 'Ihre Registrierung bei {instance} wurde nicht freigegeben',
      heading: 'Ihre Registrierung wurde nicht freigegeben',
      body: 'Hallo {username}, ein Administrator hat Ihre Registrierung bei {instance} nicht freigegeben.',
      contact: 'Wenn Sie das für einen Irrtum halten, schreiben Sie an {email}.',
      contactNone:
        'Wenn Sie das für einen Irrtum halten, wenden Sie sich an die Administratoren von {instance}.',
    },
  },
  content: (data, { t, branding }) => {
    const vars = { instance: branding.instanceName, username: data.username };
    return {
      subject: t('subject', vars),
      heading: t('heading'),
      blocks: [
        { kind: 'text', text: t('body', vars) },
        {
          kind: 'text',
          text: branding.contactEmail
            ? t('contact', { email: branding.contactEmail })
            : t('contactNone', vars),
        },
      ],
    };
  },
});

export const passwordReset = defineTemplate({
  key: 'identity.password-reset',
  // Carries the link with the token: the rendered body is deleted once the mail is sent or dead.
  schema: z.strictObject({ resetUrl: url, validForMinutes: z.number().int().min(1).max(10_080) }),
  sensitive: true,
  mandatory: true,
  category: 'security',
  categoryDescription: CATEGORY_SECURITY,
  catalogue: {
    en: {
      subject: 'Reset your {instance} password',
      heading: 'Reset your password',
      body: 'Someone asked to reset the password of your account on {instance}.',
      link: 'To choose a new password, open this link within {minutes} minutes. It works once.',
      action: 'Choose a new password',
      ignore: 'If you did not ask for this, ignore this email. Your password stays as it is.',
    },
    de: {
      subject: 'Passwort für {instance} zurücksetzen',
      heading: 'Passwort zurücksetzen',
      body: 'Jemand hat darum gebeten, das Passwort Ihres Kontos bei {instance} zurückzusetzen.',
      link: 'Um ein neues Passwort zu wählen, öffnen Sie diesen Link innerhalb von {minutes} Minuten. Er funktioniert nur einmal.',
      action: 'Neues Passwort wählen',
      ignore:
        'Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt unverändert.',
    },
  },
  content: (data, { t, branding }) => ({
    subject: t('subject', { instance: branding.instanceName }),
    heading: t('heading'),
    blocks: [
      { kind: 'text', text: t('body', { instance: branding.instanceName }) },
      { kind: 'text', text: t('link', { minutes: data.validForMinutes }) },
      { kind: 'action', label: t('action'), url: data.resetUrl },
      { kind: 'note', text: t('ignore') },
    ],
  }),
});

export const emailVerification = defineTemplate({
  key: 'identity.email-verification',
  schema: z.strictObject({ verifyUrl: url, validForHours: z.number().int().min(1).max(720) }),
  sensitive: true,
  mandatory: true,
  category: 'security',
  categoryDescription: CATEGORY_SECURITY,
  catalogue: {
    en: {
      subject: 'Confirm your email address for {instance}',
      heading: 'Confirm your email address',
      body: 'Please confirm that this email address belongs to your account on {instance}.',
      link: 'Open this link within {hours} hours. It works once.',
      action: 'Confirm email address',
      ignore: 'If you did not ask for this, ignore this email.',
    },
    de: {
      subject: 'E-Mail-Adresse für {instance} bestätigen',
      heading: 'E-Mail-Adresse bestätigen',
      body: 'Bitte bestätigen Sie, dass diese E-Mail-Adresse zu Ihrem Konto bei {instance} gehört.',
      link: 'Öffnen Sie diesen Link innerhalb von {hours} Stunden. Er funktioniert nur einmal.',
      action: 'E-Mail-Adresse bestätigen',
      ignore: 'Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.',
    },
  },
  content: (data, { t, branding }) => ({
    subject: t('subject', { instance: branding.instanceName }),
    heading: t('heading'),
    blocks: [
      { kind: 'text', text: t('body', { instance: branding.instanceName }) },
      { kind: 'text', text: t('link', { hours: data.validForHours }) },
      { kind: 'action', label: t('action'), url: data.verifyUrl },
      { kind: 'note', text: t('ignore') },
    ],
  }),
});

export const registerAttempt = defineTemplate({
  key: 'identity.register-attempt',
  // To the owner of an address that somebody tried to register again (M4 decision 4). Holds no
  // token: the links are the sign-in page and the page where a password is asked for.
  schema: z.strictObject({ signInUrl: url, forgotPasswordUrl: url }),
  mandatory: true,
  category: 'security',
  categoryDescription: CATEGORY_SECURITY,
  catalogue: {
    en: {
      subject: 'Someone tried to register on {instance} with your address',
      heading: 'A registration used your address',
      body: 'Someone tried to register an account on {instance} with this email address. An account with this address already exists, so nothing was changed.',
      you: 'If this was you, sign in, or ask for a new password if you forgot it:',
      signIn: 'Sign in',
      forgot: 'I forgot my password',
      ignore: 'If it was not you, ignore this email. Nobody gets access to your account this way.',
    },
    de: {
      subject: 'Jemand hat versucht, sich bei {instance} mit Ihrer Adresse zu registrieren',
      heading: 'Eine Registrierung hat Ihre Adresse benutzt',
      body: 'Jemand hat versucht, bei {instance} ein Konto mit dieser E-Mail-Adresse anzulegen. Ein Konto mit dieser Adresse gibt es bereits, daher wurde nichts geändert.',
      you: 'Wenn Sie das waren, melden Sie sich an oder fordern Sie ein neues Passwort an, falls Sie es vergessen haben:',
      signIn: 'Anmelden',
      forgot: 'Passwort vergessen',
      ignore:
        'Wenn Sie das nicht waren, ignorieren Sie diese E-Mail. Niemand erhält auf diese Weise Zugang zu Ihrem Konto.',
    },
  },
  content: (data, { t, branding }) => ({
    subject: t('subject', { instance: branding.instanceName }),
    heading: t('heading'),
    blocks: [
      { kind: 'text', text: t('body', { instance: branding.instanceName }) },
      { kind: 'text', text: t('you') },
      { kind: 'action', label: t('signIn'), url: data.signInUrl },
      { kind: 'action', label: t('forgot'), url: data.forgotPasswordUrl },
      { kind: 'note', text: t('ignore') },
    ],
  }),
});

export const IDENTITY_TEMPLATES = [
  welcome,
  registrationRequest,
  approved,
  rejected,
  passwordReset,
  emailVerification,
  registerAttempt,
];

/** The data each template takes, by key: what `IdentityMail.send` checks at compile time. */
export interface IdentityMailData {
  'identity.welcome': z.input<typeof welcome.schema>;
  'identity.registration-request': z.input<typeof registrationRequest.schema>;
  'identity.approved': z.input<typeof approved.schema>;
  'identity.rejected': z.input<typeof rejected.schema>;
  'identity.password-reset': z.input<typeof passwordReset.schema>;
  'identity.email-verification': z.input<typeof emailVerification.schema>;
  'identity.register-attempt': z.input<typeof registerAttempt.schema>;
}
