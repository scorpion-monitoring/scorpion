import type { UiMessages } from '@scorpion/contracts';

// The texts of the pages of core.notifications. A text that depends on a number has one key per plural
// form (`.one`, `.other`).
export const messages: UiMessages = {
  en: {
    'nav.admin.notifications': 'Notification status',
    'nav.inbox': 'Inbox',
    'nav.notificationSettings': 'Notification settings',

    'inbox.title': 'Inbox',
    'inbox.lead':
      'Messages for you from the application. Mail you get is kept here too, unless you switched that off in the notification settings.',
    'inbox.bell.label': 'Inbox',
    'inbox.bell.labelCount.one': 'Inbox, {count} unread item',
    'inbox.bell.labelCount.other': 'Inbox, {count} unread items',
    'inbox.bell.announce.one': 'You have {count} unread item.',
    'inbox.bell.announce.other': 'You have {count} unread items.',
    'inbox.unread.one': '{count} unread item',
    'inbox.unread.other': '{count} unread items',
    'inbox.markAll': 'Mark all read',
    'inbox.markRead': 'Mark read',
    'inbox.markReadNamed': 'Mark "{title}" read',
    'inbox.delete': 'Delete',
    'inbox.deleteNamed': 'Delete "{title}"',
    'inbox.open': 'Open',
    'inbox.seeAll': 'See all messages',
    'inbox.settings': 'Notification settings',
    'inbox.new': 'new',
    'inbox.empty': 'No messages.',
    'inbox.loading': 'Loading…',
    'inbox.loadFailed': 'The messages could not be loaded.',
    'inbox.allRead': 'All messages are marked read.',
    'inbox.deleted': 'The message was deleted.',
    'inbox.col.item': 'Message',
    'inbox.col.when': 'Received',
    'inbox.col.actions': 'Actions',

    'prefs.title': 'Notification settings',
    'prefs.lead':
      'Choose which messages reach you by mail and in your inbox. Security messages cannot be switched off.',
    'prefs.email': 'By mail',
    'prefs.inApp': 'In the inbox',
    'prefs.locked': 'These messages are always sent: they keep your account safe.',
    'prefs.none': 'This instance sends no messages that you can switch.',
    'prefs.save': 'Save',
    'prefs.reset': 'Undo changes',
    'prefs.saved': 'Your notification settings were saved.',
    'prefs.category.account': 'Your account',
    'prefs.category.administration': 'Administration tasks',
    'prefs.category.security': 'Security',

    'dash.loading': 'Loading…',
    'dash.loadFailed': 'This could not be loaded.',
    'dash.dead.title': 'Mail that could not be delivered',
    'dash.dead.none': 'Nothing failed for good.',
    'dash.dead.some.one': '{count} message ran out of attempts.',
    'dash.dead.some.other': '{count} messages ran out of attempts.',
    'dash.dead.transportNone': 'Mail is not being sent at all: the transport is "none".',
    'dash.dead.link': 'Open the notification status',

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
    'nav.inbox': 'Posteingang',
    'nav.notificationSettings': 'Benachrichtigungen',

    'inbox.title': 'Posteingang',
    'inbox.lead':
      'Nachrichten der Anwendung für Sie. Auch Mails, die Sie bekommen, stehen hier, außer Sie haben das in den Benachrichtigungseinstellungen abgeschaltet.',
    'inbox.bell.label': 'Posteingang',
    'inbox.bell.labelCount.one': 'Posteingang, {count} ungelesener Eintrag',
    'inbox.bell.labelCount.other': 'Posteingang, {count} ungelesene Einträge',
    'inbox.bell.announce.one': 'Sie haben {count} ungelesenen Eintrag.',
    'inbox.bell.announce.other': 'Sie haben {count} ungelesene Einträge.',
    'inbox.unread.one': '{count} ungelesener Eintrag',
    'inbox.unread.other': '{count} ungelesene Einträge',
    'inbox.markAll': 'Alle als gelesen markieren',
    'inbox.markRead': 'Als gelesen markieren',
    'inbox.markReadNamed': '„{title}“ als gelesen markieren',
    'inbox.delete': 'Löschen',
    'inbox.deleteNamed': '„{title}“ löschen',
    'inbox.open': 'Öffnen',
    'inbox.seeAll': 'Alle Nachrichten ansehen',
    'inbox.settings': 'Benachrichtigungen einstellen',
    'inbox.new': 'neu',
    'inbox.empty': 'Keine Nachrichten.',
    'inbox.loading': 'Lädt …',
    'inbox.loadFailed': 'Die Nachrichten konnten nicht geladen werden.',
    'inbox.allRead': 'Alle Nachrichten sind als gelesen markiert.',
    'inbox.deleted': 'Die Nachricht wurde gelöscht.',
    'inbox.col.item': 'Nachricht',
    'inbox.col.when': 'Eingegangen',
    'inbox.col.actions': 'Aktionen',

    'prefs.title': 'Benachrichtigungen',
    'prefs.lead':
      'Legen Sie fest, welche Nachrichten Sie per Mail und im Posteingang erreichen. Sicherheitsnachrichten lassen sich nicht abschalten.',
    'prefs.email': 'Per Mail',
    'prefs.inApp': 'Im Posteingang',
    'prefs.locked': 'Diese Nachrichten werden immer gesendet: Sie schützen Ihr Konto.',
    'prefs.none': 'Diese Instanz sendet keine Nachrichten, die Sie einstellen können.',
    'prefs.save': 'Speichern',
    'prefs.reset': 'Änderungen verwerfen',
    'prefs.saved': 'Ihre Benachrichtigungseinstellungen wurden gespeichert.',
    'prefs.category.account': 'Ihr Konto',
    'prefs.category.administration': 'Aufgaben der Administration',
    'prefs.category.security': 'Sicherheit',

    'dash.loading': 'Lädt …',
    'dash.loadFailed': 'Das konnte nicht geladen werden.',
    'dash.dead.title': 'Nicht zustellbare Mails',
    'dash.dead.none': 'Nichts ist endgültig gescheitert.',
    'dash.dead.some.one': '{count} Nachricht hat alle Versuche verbraucht.',
    'dash.dead.some.other': '{count} Nachrichten haben alle Versuche verbraucht.',
    'dash.dead.transportNone':
      'Es werden gar keine Mails gesendet: Der Transport steht auf „none“.',
    'dash.dead.link': 'Benachrichtigungsstatus öffnen',

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
