import type { UiMessages } from '@scorpion/contracts';

// The texts of bibliometrics: the section "Publications" of the service page and the indicator picker of its settings. The name
// of a citation source comes from the API (`citations.source`, a registry label), never from here. No word names the instance or a
// role. A text that depends on a number has one key per plural form (`.one`, `.other`).
export const messages: UiMessages = {
  en: {
    'admin.settings.module.bibliometrics': 'Publications and citations',

    'biblio.section.title': 'Publications',
    'biblio.section.loading': 'Loading the publications …',
    'biblio.section.loadFailed': 'The publications could not be loaded.',
    'biblio.section.retry': 'Try again',
    'biblio.section.empty': 'No publications yet.',
    'biblio.section.caption': 'Publications of {name}',
    'biblio.totalNone': 'No citation counts yet.',
    'biblio.total.one': '{total} citation, {found} of {of} publications found',
    'biblio.total.other': '{total} citations, {found} of {of} publications found',
    'biblio.col.publication': 'Publication',
    'biblio.col.citations': 'Citations',
    'biblio.authors.etAl': '{first} et al.',
    'biblio.title.unknown': 'Title not yet known',
    'biblio.title.notFound': 'doi.org does not know this DOI',
    'biblio.doi': 'DOI {doi}',
    'biblio.count.asOf': 'as of {date}',
    'biblio.count.notFound': 'not found in {source}',
    'biblio.count.unknown': 'not counted yet',
    'biblio.history.show': 'Citation history of {title}',
    'biblio.history.showShort': 'History',
    'biblio.history.hide': 'Hide the history',
    'biblio.history.label': 'Citations of {title} over time',
    'biblio.history.loading': 'Loading the history …',
    'biblio.history.failed': 'The history could not be loaded.',
    'biblio.history.empty': 'No counts yet.',
    'biblio.history.series': 'Citations',

    'biblio.add.title': 'Add a publication',
    'biblio.add.doi': 'DOI',
    'biblio.add.hint': 'For example 10.1234/abc or https://doi.org/10.1234/abc.',
    'biblio.add.submit': 'Add publication',
    'biblio.add.added': '{title} was added.',
    'biblio.add.duplicate': 'This service lists this DOI already.',
    'biblio.add.invalid': 'This is not a DOI.',
    'biblio.remove': 'Remove {title}',
    'biblio.remove.short': 'Remove',
    'biblio.remove.confirmTitle': 'Remove {title}?',
    'biblio.remove.confirmMessage':
      'The publication is removed from this service. Its citation history stays with the DOI.',
    'biblio.remove.confirm': 'Remove',
    'biblio.remove.done': '{title} was removed.',
    'biblio.forbidden': 'You may not change the publications of this service.',
    'biblio.gone': 'This publication or service no longer exists.',

    'biblio.check.submit': 'Check citations now',
    'biblio.check.queued':
      'The check is queued. The counts appear here when it has run; reload the page in a minute.',
    'biblio.check.wait.one': 'The citations were checked recently. Try again in {count} minute.',
    'biblio.check.wait.other': 'The citations were checked recently. Try again in {count} minutes.',
    'biblio.check.off': 'Citation lookups are turned off on this instance.',

    'biblio.picker.loading': 'Loading the indicators …',
    'biblio.picker.failed': 'The indicators could not be loaded.',
    'biblio.picker.none': 'No KPI',
    'biblio.picker.empty':
      'There is no numeric indicator in the category Bibliographic yet. Create one under Indicators first.',
    'biblio.picker.missing': 'The saved indicator is not numeric and Bibliographic any more',
  },
  de: {
    'admin.settings.module.bibliometrics': 'Publikationen und Zitationen',

    'biblio.section.title': 'Publikationen',
    'biblio.section.loading': 'Publikationen werden geladen …',
    'biblio.section.loadFailed': 'Die Publikationen konnten nicht geladen werden.',
    'biblio.section.retry': 'Erneut versuchen',
    'biblio.section.empty': 'Noch keine Publikationen.',
    'biblio.section.caption': 'Publikationen von {name}',
    'biblio.totalNone': 'Noch keine Zitationszahlen.',
    'biblio.total.one': '{total} Zitation, {found} von {of} Publikationen gefunden',
    'biblio.total.other': '{total} Zitationen, {found} von {of} Publikationen gefunden',
    'biblio.col.publication': 'Publikation',
    'biblio.col.citations': 'Zitationen',
    'biblio.authors.etAl': '{first} et al.',
    'biblio.title.unknown': 'Titel noch nicht bekannt',
    'biblio.title.notFound': 'doi.org kennt diesen DOI nicht',
    'biblio.doi': 'DOI {doi}',
    'biblio.count.asOf': 'Stand {date}',
    'biblio.count.notFound': 'nicht in {source} gefunden',
    'biblio.count.unknown': 'noch nicht gezählt',
    'biblio.history.show': 'Zitationsverlauf von {title}',
    'biblio.history.showShort': 'Verlauf',
    'biblio.history.hide': 'Verlauf ausblenden',
    'biblio.history.label': 'Zitationen von {title} im Zeitverlauf',
    'biblio.history.loading': 'Verlauf wird geladen …',
    'biblio.history.failed': 'Der Verlauf konnte nicht geladen werden.',
    'biblio.history.empty': 'Noch keine Zählungen.',
    'biblio.history.series': 'Zitationen',

    'biblio.add.title': 'Publikation hinzufügen',
    'biblio.add.doi': 'DOI',
    'biblio.add.hint': 'Zum Beispiel 10.1234/abc oder https://doi.org/10.1234/abc.',
    'biblio.add.submit': 'Publikation hinzufügen',
    'biblio.add.added': '{title} wurde hinzugefügt.',
    'biblio.add.duplicate': 'Dieser Dienst führt diesen DOI bereits.',
    'biblio.add.invalid': 'Das ist kein DOI.',
    'biblio.remove': '{title} entfernen',
    'biblio.remove.short': 'Entfernen',
    'biblio.remove.confirmTitle': '{title} entfernen?',
    'biblio.remove.confirmMessage':
      'Die Publikation wird von diesem Dienst entfernt. Ihr Zitationsverlauf bleibt beim DOI.',
    'biblio.remove.confirm': 'Entfernen',
    'biblio.remove.done': '{title} wurde entfernt.',
    'biblio.forbidden': 'Sie dürfen die Publikationen dieses Dienstes nicht ändern.',
    'biblio.gone': 'Diese Publikation oder dieser Dienst existiert nicht mehr.',

    'biblio.check.submit': 'Zitationen jetzt prüfen',
    'biblio.check.queued':
      'Die Prüfung ist eingereiht. Die Zahlen erscheinen hier, sobald sie gelaufen ist; laden Sie die Seite in einer Minute neu.',
    'biblio.check.wait.one':
      'Die Zitationen wurden gerade geprüft. Versuchen Sie es in {count} Minute erneut.',
    'biblio.check.wait.other':
      'Die Zitationen wurden gerade geprüft. Versuchen Sie es in {count} Minuten erneut.',
    'biblio.check.off': 'Die Abfrage von Zitationen ist auf dieser Instanz ausgeschaltet.',

    'biblio.picker.loading': 'Indikatoren werden geladen …',
    'biblio.picker.failed': 'Die Indikatoren konnten nicht geladen werden.',
    'biblio.picker.none': 'Kein KPI',
    'biblio.picker.empty':
      'Es gibt noch keinen numerischen Indikator in der Kategorie Bibliographic. Legen Sie zuerst unter Indikatoren einen an.',
    'biblio.picker.missing':
      'Der gespeicherte Indikator ist nicht mehr numerisch und bibliographisch',
  },
};
