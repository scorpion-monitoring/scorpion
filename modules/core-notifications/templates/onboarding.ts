// Templates of the onboarding module (M15), registered here so M15 only enqueues them.
import { z } from '@scorpion/contracts';
import { defineTemplate } from '../service/templates/define.ts';

export const applicationSubmitted = defineTemplate({
  key: 'onboarding.application-submitted',
  // To the applicant, right after submitting: we have it.
  schema: z.strictObject({
    service: z.string().min(1).max(200),
  }),
  category: 'onboarding',
  catalogue: {
    en: {
      subject: 'We received your application for {service}',
      heading: 'Your application is in',
      body: 'Thank you. We received your onboarding application for {service}. We will write to you when it has been reviewed.',
    },
    de: {
      subject: 'Wir haben Ihre Bewerbung für {service} erhalten',
      heading: 'Ihre Bewerbung ist eingegangen',
      body: 'Vielen Dank. Wir haben Ihre Onboarding-Bewerbung für {service} erhalten. Wir melden uns, sobald sie geprüft wurde.',
    },
  },
  content: (data, { t }) => ({
    subject: t('subject', { service: data.service }),
    heading: t('heading'),
    blocks: [{ kind: 'text', text: t('body', { service: data.service }) }],
  }),
});

export const applicationDecided = defineTemplate({
  key: 'onboarding.application-decided',
  // To the applicant: the decision.
  schema: z.strictObject({
    service: z.string().min(1).max(200),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(1000).optional(),
  }),
  category: 'onboarding',
  catalogue: {
    en: {
      'subject.approved': 'Your application for {service} was approved',
      'subject.rejected': 'Your application for {service} was not approved',
      'heading.approved': 'Your application was approved',
      'heading.rejected': 'Your application was not approved',
      'body.approved':
        'The review of your onboarding application for {service} is complete: it was approved.',
      'body.rejected':
        'The review of your onboarding application for {service} is complete: it was not approved.',
      noteLabel: 'Note from the reviewer:',
    },
    de: {
      'subject.approved': 'Ihre Bewerbung für {service} wurde angenommen',
      'subject.rejected': 'Ihre Bewerbung für {service} wurde nicht angenommen',
      'heading.approved': 'Ihre Bewerbung wurde angenommen',
      'heading.rejected': 'Ihre Bewerbung wurde nicht angenommen',
      'body.approved':
        'Die Prüfung Ihrer Onboarding-Bewerbung für {service} ist abgeschlossen: Sie wurde angenommen.',
      'body.rejected':
        'Die Prüfung Ihrer Onboarding-Bewerbung für {service} ist abgeschlossen: Sie wurde nicht angenommen.',
      noteLabel: 'Hinweis der Prüfung:',
    },
  },
  content: (data, { t }) => {
    const vars = { service: data.service };
    return {
      subject: t(`subject.${data.decision}`, vars),
      heading: t(`heading.${data.decision}`),
      blocks: [
        { kind: 'text', text: t(`body.${data.decision}`, vars) },
        ...(data.note ? [{ kind: 'text' as const, text: `${t('noteLabel')}\n${data.note}` }] : []),
      ],
    };
  },
});
