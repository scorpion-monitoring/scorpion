import type { UiMessages } from '@scorpion/contracts';

// The texts of the pages of core.notifications. A text that depends on a number has one key per plural
// form (`.one`, `.other`).
export const messages: UiMessages = {
  en: {
    'nav.admin.notifications': 'Notification status',

    'admin.notifications.title': 'Notification status',
    'admin.notifications.any': 'Any',
    'admin.notifications.on': 'on',
    'admin.notifications.off': 'off',
    'admin.notifications.actions': 'Actions',
    'admin.notifications.status.queued': 'Queued',
    'admin.notifications.status.sending': 'Sending',
    'admin.notifications.status.sent': 'Sent',
    'admin.notifications.status.dead': 'Dead',
    'admin.notifications.channel.email': 'Email',
    'admin.notifications.channel.webhook': 'Webhook',

    'admin.notifications.none.title': 'Email is not being sent',
    'admin.notifications.none.text.one':
      'The mail transport is set to "none": messages are recorded as sent and go nowhere. {count} message has been dropped this way.',
    'admin.notifications.none.text.other':
      'The mail transport is set to "none": messages are recorded as sent and go nowhere. {count} messages have been dropped this way.',
    'admin.notifications.none.link': 'Set up a mail relay in the settings',

    'admin.notifications.counts.title': 'Deliveries',
    'admin.notifications.transport': 'Email transport: {transport}. Webhook: {webhook}.',

    'admin.notifications.errors.title': 'Errors of the last 7 days',
    'admin.notifications.errors.lead':
      'Only the error codes are kept here, never a message text, an address or a link.',
    'admin.notifications.errors.code': 'Error code',
    'admin.notifications.errors.count': 'Times',
    'admin.notifications.errors.last': 'Last time',
    'admin.notifications.errors.empty': 'No error in the last 7 days.',

    'admin.notifications.test.title': 'Test mail',
    'admin.notifications.test.lead':
      'Sends a short mail to the address of your own account to check the transport.',
    'admin.notifications.test.send': 'Send a test mail',
    'admin.notifications.test.queued': 'The test mail is queued for your address.',
    'admin.notifications.test.queuedNone':
      'The test mail is queued, but the transport is "none", so it goes nowhere.',
    'admin.notifications.test.noAddress': 'Your account has no email address to send to.',
    'admin.notifications.test.tooMany': 'Too many test mails. Try again later.',

    'admin.notifications.deliveries.title': 'Delivery list',
    'admin.notifications.deliveries.lead':
      'Newest first. The list shows what was sent and how it went, never the content or the address.',
    'admin.notifications.deliveries.filters': 'Filter the deliveries',
    'admin.notifications.deliveries.status': 'Status',
    'admin.notifications.deliveries.channel': 'Channel',
    'admin.notifications.deliveries.template': 'Template',
    'admin.notifications.deliveries.apply': 'Apply',
    'admin.notifications.deliveries.attempts': 'Attempts',
    'admin.notifications.deliveries.error': 'Last error',
    'admin.notifications.deliveries.created': 'Created',
    'admin.notifications.deliveries.empty': 'No delivery matches.',
    'admin.notifications.requeue': 'Requeue',
    'admin.notifications.requeueNamed': 'Requeue the delivery of {template}',
    'admin.notifications.requeueTitle': 'Requeue this delivery?',
    'admin.notifications.requeueMessage':
      'The message is sent again with its attempts reset. The repair is recorded in the logs.',
    'admin.notifications.requeued': 'The delivery is queued again.',
    'admin.notifications.forbidden': 'You may look at the deliveries but not repair them.',
    'admin.notifications.cannotRequeue':
      'That delivery cannot be requeued: it is not dead, or its content was removed when it ended.',
  },
  de: {
    'nav.admin.notifications': 'Benachrichtigungsstatus',

    'admin.notifications.title': 'Benachrichtigungsstatus',
    'admin.notifications.any': 'Beliebig',
    'admin.notifications.on': 'an',
    'admin.notifications.off': 'aus',
    'admin.notifications.actions': 'Aktionen',
    'admin.notifications.status.queued': 'In der Warteschlange',
    'admin.notifications.status.sending': 'Wird gesendet',
    'admin.notifications.status.sent': 'Gesendet',
    'admin.notifications.status.dead': 'Gescheitert',
    'admin.notifications.channel.email': 'E-Mail',
    'admin.notifications.channel.webhook': 'Webhook',

    'admin.notifications.none.title': 'E-Mails werden nicht versendet',
    'admin.notifications.none.text.one':
      'Der Mail-Transport steht auf „none“: Nachrichten werden als gesendet vermerkt und gehen nirgendwohin. {count} Nachricht wurde so verworfen.',
    'admin.notifications.none.text.other':
      'Der Mail-Transport steht auf „none“: Nachrichten werden als gesendet vermerkt und gehen nirgendwohin. {count} Nachrichten wurden so verworfen.',
    'admin.notifications.none.link': 'Mail-Relay in den Einstellungen einrichten',

    'admin.notifications.counts.title': 'Zustellungen',
    'admin.notifications.transport': 'E-Mail-Transport: {transport}. Webhook: {webhook}.',

    'admin.notifications.errors.title': 'Fehler der letzten 7 Tage',
    'admin.notifications.errors.lead':
      'Hier werden nur Fehlercodes gespeichert, nie ein Nachrichtentext, eine Adresse oder ein Link.',
    'admin.notifications.errors.code': 'Fehlercode',
    'admin.notifications.errors.count': 'Anzahl',
    'admin.notifications.errors.last': 'Zuletzt',
    'admin.notifications.errors.empty': 'Kein Fehler in den letzten 7 Tagen.',

    'admin.notifications.test.title': 'Test-Mail',
    'admin.notifications.test.lead':
      'Sendet eine kurze Mail an die Adresse Ihres eigenen Kontos, um den Transport zu prüfen.',
    'admin.notifications.test.send': 'Test-Mail senden',
    'admin.notifications.test.queued': 'Die Test-Mail ist für Ihre Adresse eingereiht.',
    'admin.notifications.test.queuedNone':
      'Die Test-Mail ist eingereiht, aber der Transport steht auf „none“; sie geht nirgendwohin.',
    'admin.notifications.test.noAddress':
      'Ihr Konto hat keine E-Mail-Adresse, an die gesendet werden kann.',
    'admin.notifications.test.tooMany': 'Zu viele Test-Mails. Versuchen Sie es später erneut.',

    'admin.notifications.deliveries.title': 'Liste der Zustellungen',
    'admin.notifications.deliveries.lead':
      'Neueste zuerst. Die Liste zeigt, was gesendet wurde und wie es lief, nie den Inhalt oder die Adresse.',
    'admin.notifications.deliveries.filters': 'Zustellungen filtern',
    'admin.notifications.deliveries.status': 'Status',
    'admin.notifications.deliveries.channel': 'Kanal',
    'admin.notifications.deliveries.template': 'Vorlage',
    'admin.notifications.deliveries.apply': 'Anwenden',
    'admin.notifications.deliveries.attempts': 'Versuche',
    'admin.notifications.deliveries.error': 'Letzter Fehler',
    'admin.notifications.deliveries.created': 'Erstellt',
    'admin.notifications.deliveries.empty': 'Keine Zustellung passt.',
    'admin.notifications.requeue': 'Erneut einreihen',
    'admin.notifications.requeueNamed': 'Zustellung von {template} erneut einreihen',
    'admin.notifications.requeueTitle': 'Diese Zustellung erneut einreihen?',
    'admin.notifications.requeueMessage':
      'Die Nachricht wird erneut gesendet, die Versuche beginnen von vorn. Die Reparatur wird im Protokoll vermerkt.',
    'admin.notifications.requeued': 'Die Zustellung ist wieder eingereiht.',
    'admin.notifications.forbidden': 'Sie dürfen die Zustellungen ansehen, aber nicht reparieren.',
    'admin.notifications.cannotRequeue':
      'Diese Zustellung kann nicht erneut eingereiht werden: Sie ist nicht gescheitert, oder ihr Inhalt wurde beim Ende entfernt.',
  },
};
