import type { UiMessages } from '@scorpion/contracts';
import { mergeBundles } from '@scorpion/ui-kit/i18n';
import { adminMessages } from './admin/messages.ts';

const shellMessages: UiMessages = {
  en: {
    'nav.home': 'Home',
    'nav.docs': 'API documentation',
    'nav.about': 'About',
    'nav.section.main': 'Main',
    'home.lead': 'The service registry and KPI tracker of {name}.',
    'home.signedIn': 'You are signed in as {name}.',
    'home.dashboard': 'What needs your attention',
    'dashboard.customise': 'Customise dashboard',
    'dashboard.menu': 'Add a widget',
    'dashboard.addWidget': 'Add {name}',
    'dashboard.alreadyThere': '{name} (already on your dashboard)',
    'dashboard.full': '{name} (your dashboard is full)',
    'dashboard.nothingToAdd': 'There is nothing else to add.',
    'dashboard.reset': 'Reset to default',
    'dashboard.done': 'Done',
    'dashboard.editing': 'You are customising your dashboard. Changes are saved automatically.',
    'dashboard.empty': 'Your dashboard is empty. Use “Customise dashboard” to add widgets.',
    'dashboard.added': '{name} added at row {row}, column {column}.',
    'dashboard.resetDone': 'The default dashboard is shown and will be saved.',
    'dashboard.pending': 'Changes will be saved in a moment.',
    'dashboard.saving': 'Saving…',
    'dashboard.saved': 'Saved',
    'dashboard.retry': 'Try again',
    'dashboard.error.failed':
      'Your dashboard could not be saved. Your changes are kept on this page.',
    'dashboard.error.forbidden':
      'Your dashboard cannot be saved with your account. Your changes are kept on this page until you leave it.',
    'dashboard.error.tooLarge':
      'Your dashboard is too large to save. Remove a widget or simplify its settings, then try again.',
    'dashboard.error.repaired':
      'Some of your widgets are no longer available. The dashboard was reloaded without them.',
    'dashboard.notice.dropped.one': '{count} widget is no longer available and is not shown.',
    'dashboard.notice.dropped.other': '{count} widgets are no longer available and are not shown.',
    'dashboard.notice.reset':
      'Your saved dashboard could not be read, so the default dashboard is shown.',
    'dashboard.notice.missing.one': '{count} widget could not be shown on this page.',
    'dashboard.notice.missing.other': '{count} widgets could not be shown on this page.',
    'legal.terms': 'Terms of use',
    'legal.privacy': 'Privacy policy',
    'legal.imprint': 'Imprint',
    'legal.imprintExternal': 'Imprint',
    'docs.title': 'API documentation',
    'docs.lead':
      'The public API is versioned and stays compatible within a version. Every list answers with the same envelope: a metadata block and a result list, with pages counted from 0.',
    'docs.empty': 'The public API of this instance has no routes yet.',
    'docs.reference.open': 'Open the API reference',
    'docs.reference.note':
      'The reference lists every route with its parameters and answers, and sends a call with your token. It is written in English.',
    'docs.token.title': 'Get a token',
    'docs.token.profile': 'Open your profile',
    'docs.token.profileRest': 'and find the section “Access tokens”.',
    'docs.token.scopes':
      'Make a token and tick the permissions of the routes you want to call: the last column of the table below names the permission of each route. The token is shown once.',
    'docs.token.send': 'Send the token with every request, either as',
    'docs.routes.title': 'Routes and the permission each needs',
    'docs.method': 'Method',
    'docs.path': 'Path',
    'docs.summary': 'Summary',
    'docs.access': 'Permission',
    'docs.public': 'Public',
    'about.title': 'About this instance',
    'about.lead':
      'The profile this instance was built for, the product version and the modules it runs.',
    'about.profile': 'Profile',
    'about.version': 'Version',
    'about.core': 'Core modules',
    'about.optional': 'Optional modules',
    'about.none': 'This profile has no module of this kind.',
    'about.module': 'Module',
    'about.id': 'Id',
    'about.moduleVersion': 'Version',
    'docs.more.title': 'More',
    'docs.more.document': 'The description of the API for programs (OpenAPI 3.1) is at',
    'docs.more.cors':
      'A web application that runs in a browser can call the API only if its address is on the list of allowed origins in the settings of the public API; a script or a server needs no entry.',
  },
  de: {
    'nav.home': 'Start',
    'nav.docs': 'API-Dokumentation',
    'nav.about': 'Über diese Instanz',
    'nav.section.main': 'Allgemein',
    'home.lead': 'Das Dienstregister und der KPI-Tracker von {name}.',
    'home.signedIn': 'Sie sind angemeldet als {name}.',
    'home.dashboard': 'Was Ihre Aufmerksamkeit braucht',
    'dashboard.customise': 'Dashboard anpassen',
    'dashboard.menu': 'Widget hinzufügen',
    'dashboard.addWidget': '{name} hinzufügen',
    'dashboard.alreadyThere': '{name} (bereits auf Ihrem Dashboard)',
    'dashboard.full': '{name} (Ihr Dashboard ist voll)',
    'dashboard.nothingToAdd': 'Es gibt nichts weiter hinzuzufügen.',
    'dashboard.reset': 'Auf Standard zurücksetzen',
    'dashboard.done': 'Fertig',
    'dashboard.editing': 'Sie passen Ihr Dashboard an. Änderungen werden automatisch gespeichert.',
    'dashboard.empty':
      'Ihr Dashboard ist leer. Mit „Dashboard anpassen“ können Sie Widgets hinzufügen.',
    'dashboard.added': '{name} hinzugefügt: Zeile {row}, Spalte {column}.',
    'dashboard.resetDone': 'Das Standard-Dashboard wird angezeigt und gleich gespeichert.',
    'dashboard.pending': 'Änderungen werden gleich gespeichert.',
    'dashboard.saving': 'Wird gespeichert …',
    'dashboard.saved': 'Gespeichert',
    'dashboard.retry': 'Erneut versuchen',
    'dashboard.error.failed':
      'Ihr Dashboard konnte nicht gespeichert werden. Ihre Änderungen bleiben auf dieser Seite erhalten.',
    'dashboard.error.forbidden':
      'Ihr Dashboard kann mit Ihrem Konto nicht gespeichert werden. Ihre Änderungen bleiben erhalten, bis Sie die Seite verlassen.',
    'dashboard.error.tooLarge':
      'Ihr Dashboard ist zu groß zum Speichern. Entfernen Sie ein Widget oder vereinfachen Sie dessen Einstellungen und versuchen Sie es erneut.',
    'dashboard.error.repaired':
      'Einige Ihrer Widgets sind nicht mehr verfügbar. Das Dashboard wurde ohne sie neu geladen.',
    'dashboard.notice.dropped.one':
      '{count} Widget ist nicht mehr verfügbar und wird nicht angezeigt.',
    'dashboard.notice.dropped.other':
      '{count} Widgets sind nicht mehr verfügbar und werden nicht angezeigt.',
    'dashboard.notice.reset':
      'Ihr gespeichertes Dashboard konnte nicht gelesen werden, deshalb wird das Standard-Dashboard angezeigt.',
    'dashboard.notice.missing.one':
      '{count} Widget konnte auf dieser Seite nicht angezeigt werden.',
    'dashboard.notice.missing.other':
      '{count} Widgets konnten auf dieser Seite nicht angezeigt werden.',
    'legal.terms': 'Nutzungsbedingungen',
    'legal.privacy': 'Datenschutzerklärung',
    'legal.imprint': 'Impressum',
    'legal.imprintExternal': 'Impressum',
    'docs.title': 'API-Dokumentation',
    'docs.lead':
      'Die öffentliche API ist versioniert und bleibt innerhalb einer Version kompatibel. Jede Liste antwortet mit demselben Umschlag: einem Metadatenblock und einer Ergebnisliste, deren Seiten bei 0 beginnen.',
    'docs.empty': 'Die öffentliche API dieser Instanz hat noch keine Routen.',
    'docs.reference.open': 'API-Referenz öffnen',
    'docs.reference.note':
      'Die Referenz listet jede Route mit ihren Parametern und Antworten auf und sendet einen Aufruf mit Ihrem Token. Sie ist auf Englisch.',
    'docs.token.title': 'Ein Token erhalten',
    'docs.token.profile': 'Öffnen Sie Ihr Profil',
    'docs.token.profileRest': 'und suchen Sie den Abschnitt „Zugriffstoken“.',
    'docs.token.scopes':
      'Erstellen Sie ein Token und wählen Sie die Berechtigungen der Routen, die Sie aufrufen möchten: Die letzte Spalte der Tabelle nennt die Berechtigung jeder Route. Das Token wird nur einmal angezeigt.',
    'docs.token.send': 'Senden Sie das Token mit jeder Anfrage, entweder als',
    'docs.routes.title': 'Routen und die jeweils nötige Berechtigung',
    'docs.method': 'Methode',
    'docs.path': 'Pfad',
    'docs.summary': 'Beschreibung',
    'docs.access': 'Berechtigung',
    'docs.public': 'Öffentlich',
    'about.title': 'Über diese Instanz',
    'about.lead': 'Das Profil dieser Instanz, die Produktversion und die laufenden Module.',
    'about.profile': 'Profil',
    'about.version': 'Version',
    'about.core': 'Kernmodule',
    'about.optional': 'Optionale Module',
    'about.none': 'Dieses Profil hat kein Modul dieser Art.',
    'about.module': 'Modul',
    'about.id': 'Kennung',
    'about.moduleVersion': 'Version',
    'docs.more.title': 'Weiteres',
    'docs.more.document': 'Die Beschreibung der API für Programme (OpenAPI 3.1) liegt unter',
    'docs.more.cors':
      'Eine Webanwendung im Browser kann die API nur aufrufen, wenn ihre Adresse in den Einstellungen der öffentlichen API in der Liste der erlaubten Ursprünge steht; ein Skript oder ein Server braucht keinen Eintrag.',
  },
};

/** The shell's own texts and those of its administration pages. */
export const messages: UiMessages = mergeBundles([shellMessages, adminMessages]);
