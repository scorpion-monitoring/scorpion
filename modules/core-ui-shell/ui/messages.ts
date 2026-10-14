import type { UiMessages } from '@scorpion/contracts';
import { mergeBundles } from '@scorpion/ui-kit/i18n';
import { adminMessages } from './admin/messages.ts';

const shellMessages: UiMessages = {
  en: {
    'nav.home': 'Home',
    'nav.docs': 'API documentation',
    'nav.section.main': 'Main',
    'home.lead': 'The service registry and KPI tracker of {name}.',
    'home.signedIn': 'You are signed in as {name}.',
    'home.dashboard': 'What needs your attention',
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
    'docs.more.title': 'More',
    'docs.more.document': 'The description of the API for programs (OpenAPI 3.1) is at',
    'docs.more.cors':
      'A web application that runs in a browser can call the API only if its address is on the list of allowed origins in the settings of the public API; a script or a server needs no entry.',
  },
  de: {
    'nav.home': 'Start',
    'nav.docs': 'API-Dokumentation',
    'nav.section.main': 'Allgemein',
    'home.lead': 'Das Dienstregister und der KPI-Tracker von {name}.',
    'home.signedIn': 'Sie sind angemeldet als {name}.',
    'home.dashboard': 'Was Ihre Aufmerksamkeit braucht',
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
    'docs.more.title': 'Weiteres',
    'docs.more.document': 'Die Beschreibung der API für Programme (OpenAPI 3.1) liegt unter',
    'docs.more.cors':
      'Eine Webanwendung im Browser kann die API nur aufrufen, wenn ihre Adresse in den Einstellungen der öffentlichen API in der Liste der erlaubten Ursprünge steht; ein Skript oder ein Server braucht keinen Eintrag.',
  },
};

/** The shell's own texts and those of its administration pages. */
export const messages: UiMessages = mergeBundles([shellMessages, adminMessages]);
