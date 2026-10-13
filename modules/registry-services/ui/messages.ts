import type { UiMessages } from '@scorpion/contracts';

// The texts of the pages of registry.services. The label of a stage, of a facet and of a facet value comes
// from the vocabulary, the registry or the organisation, never from here; and no text names a role
// ("provider", "consortium"): a column says who runs the service and which groups it belongs to. A text that
// depends on a number has one key per plural form (`.one`, `.other`).
export const messages: UiMessages = {
  en: {
    'nav.services': 'Services',

    'services.title': 'Services',
    'services.new': 'New service',
    'services.search': 'Search by name or short name',
    'services.searchSubmit': 'Search',
    'services.name': 'Service',
    'services.owner': 'Operated by',
    'services.group': 'Part of',
    'services.stage': 'Stage',
    'services.empty': 'No service matches.',
    'services.icon.alt': 'Icon of {name}',
    'services.filters.active': 'Chosen filters',
    'services.filters.remove': 'Remove the filter {facet}: {value}',

    'services.new.intro':
      'Answer the questions step by step. Nothing is saved until you create the service.',

    'services.wizard.fixFields': 'Some answers need attention before you can go on.',
    'services.wizard.create': 'Create service',
    'services.wizard.noWidget':
      'The field "{field}" cannot be shown here (no control for "{widget}"), so this step cannot be completed.',
    'services.error.slugTaken':
      'This short name is already taken, or a service used it once. Choose another one.',
    'services.error.forbidden':
      'You can only create a service for an organisation you are an approved member of. Nothing was saved; what you entered is still here.',

    'services.check.required': 'This field is required.',
    'services.check.maxLength': 'Use at most {limit} characters.',
    'services.check.maxItems': 'Give at most {limit} entries.',
    'services.check.pattern': 'This value contains characters that are not allowed.',
    'services.check.pattern.slug':
      'Use letters, digits, ".", "_" and "-", starting with a letter or a digit.',
    'services.check.pattern.url': 'Give a web address that starts with http:// or https://.',
    'services.check.pattern.email': 'Give an e-mail address such as support@example.org.',
    'services.check.uniqueItems': 'Each entry may appear once.',
    'services.check.dependentRequired': 'Give both an address and a kind of contact, or neither.',
    'services.check.unknown': 'This field is not known.',
    'services.check.enum': 'This is not one of the choices.',
    'services.check.unsupported': 'This field has a rule this page cannot check; the server will.',
    'services.check.invalid': 'This value is not valid.',

    'services.choice.none': 'None',
    'services.choice.choose': 'Choose…',
    'services.organisations.none':
      'There is no organisation to choose from. Ask a manager of an organisation to approve your membership first.',
    'services.organisations.more': 'More organisations exist than are listed here.',

    'services.license.placeholder': 'Search by licence name or SPDX id',
    'services.license.found.one': '{count} licence found.',
    'services.license.found.other': '{count} licences found.',
    'services.license.none': 'No licence matches.',
    'services.license.failed': 'The licence list could not be loaded. Try again.',
    'services.license.chosen': 'Chosen licence: {name}',
    'services.license.clear': 'Remove the licence',
    'services.license.osi': 'OSI approved',
    'services.license.deprecated': 'deprecated',

    'services.icon.afterCreate':
      'You can add the icon on the next screen, once the service exists.',
    'services.icon.title': 'Icon',
    'services.icon.none': 'No icon yet.',
    'services.icon.choose': 'Upload an icon',
    'services.icon.hint': 'PNG, JPEG, WebP, GIF or SVG, at most {count} MB.',
    'services.icon.remove': 'Remove the icon',
    'services.icon.saved': 'The icon was saved.',
    'services.icon.removed': 'The icon was removed.',
    'services.icon.tooBig': 'The file is larger than {count} MB.',
    'services.icon.invalid': 'The file is empty, damaged or not a supported image.',
    'services.icon.forbidden': 'You are not allowed to change this icon.',

    'services.console.title': 'JSON console (development only)',
    'services.console.help':
      'The form as JSON, in both directions: what you type in a field appears here, and what you edit here appears in the fields. It is checked like any other edit. This console is not part of a production server.',
    'services.console.label': 'The form as JSON',
    'services.console.invalid': 'The text is not valid JSON.',
    'services.console.notObject': 'The text must be one JSON object.',

    'services.done.title': 'Service created',
    'services.done.toast': '{name} was created.',
    'services.done.body': '{name} was created. You can add its icon now.',
    'services.done.open': 'Open {name}',
    'services.done.catalogue': 'Back to the services',

    'services.step.basics.title': 'Basics',
    'services.step.basics.intro':
      'Give the service a short name for its address and a name people will recognise. The licence is searched in the SPDX list.',
    'services.step.provision.title': 'Who runs it',
    'services.step.provision.intro':
      'Choose the organisation that runs this service and, if it belongs to groups, those groups.',
    'services.step.contact.title': 'Contact',
    'services.step.contact.intro':
      'A contact point is a role address of the organisation, such as a helpdesk, never a personal one. Leave both empty to give none.',
    'services.field.slug.label': 'Short name (used in the address)',
    'services.field.slug.help':
      'Letters, digits, ".", "_" and "-". It cannot be changed later by a member.',
    'services.field.name.label': 'Name',
    'services.field.license.label': 'Licence',
    'services.field.license.help': 'The licence of the service, from the SPDX list.',
    'services.field.stage.label': 'Stage',
    'services.field.icon.label': 'Icon',
    'services.field.icon.help': 'A small image shown next to the name.',
    'services.field.description.label': 'Description',
    'services.field.url.label': 'Web address of the service',
    'services.field.sameAs.label': 'Further links',
    'services.field.sameAs.help':
      'Other pages that describe the same service, such as a registry entry.',
    'services.field.provider.label': 'Operated by',
    'services.field.provider.help':
      'You can only choose an organisation you are an approved member of.',
    'services.field.consortia.label': 'Part of',
    'services.field.consortia.help': 'The groups this service belongs to. Optional.',
    'services.field.contactEmail.label': 'Contact address',
    'services.field.contactEmail.help':
      'A role address such as helpdesk@example.org, not a personal one.',
    'services.field.contactType.label': 'Kind of contact',

    'services.detail.public': 'Public',
    'services.detail.private': 'Private',
    'services.detail.publicHelp': 'Anyone, signed in or not, can read this service.',
    'services.detail.privateHelp': 'Only signed-in people can read this service.',
    'services.detail.shortName': 'Short name',
    'services.detail.stage': 'Stage',
    'services.detail.license': 'Licence',
    'services.detail.licenseDeprecated': '(deprecated)',
    'services.detail.url': 'Web address',
    'services.detail.sameAs': 'Further links',
    'services.detail.contact': 'Contact',
    'services.detail.publicPage': 'Open the public page',
    'services.detail.actions': 'Actions for this service',

    'services.edit': 'Edit',
    'services.edit.title': 'Edit {name}',
    'services.edit.save': 'Save changes',
    'services.edit.cancel': 'Cancel',
    'services.edit.nothing': 'Nothing has changed yet.',
    'services.edit.saved': 'Your changes were saved.',
    'services.edit.renamed': '{name} now has the short name {slug}. The old address still works.',
    'services.edit.fixFields': 'Some answers need attention before you can save.',
    'services.edit.forbidden':
      'You are not allowed to make this change. This page may be out of date; nothing was saved and what you entered is still here.',
    'services.edit.identity': 'Only a manager of the {owner} or an administrator can change these.',
    'services.edit.fixed': 'Fixed values',
    'services.edit.noWidget':
      'The field "{field}" cannot be shown here (no control for "{widget}"), so it cannot be changed on this page.',

    'services.publish': 'Make public',
    'services.publish.title': 'Make {name} public?',
    'services.publish.message':
      "Anyone, signed in or not, can then read this service's name, description, links, who operates it and what it is part of. The contact point is never public.",
    'services.publish.confirm': 'Make public',
    'services.publish.done': '{name} is now public.',
    'services.publish.off':
      'Making services public is switched off on this instance, so this service cannot be made public now.',
    'services.publish.offHint': 'Switched off on this instance.',
    'services.unpublish': 'Make private',
    'services.unpublish.title': 'Make {name} private?',
    'services.unpublish.message':
      'Only signed-in people can then read this service. Its public address answers as if the service did not exist, within a minute.',
    'services.unpublish.confirm': 'Make private',
    'services.unpublish.done': '{name} is now private.',
    'services.publish.forbidden':
      'You are not allowed to change this. This page may be out of date; nothing was changed.',
  },
  de: {
    'nav.services': 'Dienste',

    'services.title': 'Dienste',
    'services.new': 'Neuer Dienst',
    'services.search': 'Nach Name oder Kurzname suchen',
    'services.searchSubmit': 'Suchen',
    'services.name': 'Dienst',
    'services.owner': 'Betrieben von',
    'services.group': 'Gehört zu',
    'services.stage': 'Stufe',
    'services.empty': 'Kein Dienst passt.',
    'services.icon.alt': 'Symbol von {name}',
    'services.filters.active': 'Gewählte Filter',
    'services.filters.remove': 'Filter entfernen: {facet}: {value}',

    'services.new.intro':
      'Beantworten Sie die Fragen Schritt für Schritt. Erst mit „Dienst anlegen“ wird etwas gespeichert.',

    'services.wizard.fixFields': 'Einige Angaben müssen korrigiert werden, bevor es weitergeht.',
    'services.wizard.create': 'Dienst anlegen',
    'services.wizard.noWidget':
      'Das Feld „{field}“ kann hier nicht dargestellt werden (kein Bedienelement für „{widget}“); dieser Schritt kann nicht abgeschlossen werden.',
    'services.error.slugTaken':
      'Dieser Kurzname ist schon vergeben oder wurde einmal von einem Dienst genutzt. Wählen Sie einen anderen.',
    'services.error.forbidden':
      'Sie können einen Dienst nur für eine Organisation anlegen, in der Sie bestätigtes Mitglied sind. Es wurde nichts gespeichert; Ihre Eingaben sind noch da.',

    'services.check.required': 'Dieses Feld ist erforderlich.',
    'services.check.maxLength': 'Höchstens {limit} Zeichen.',
    'services.check.maxItems': 'Höchstens {limit} Einträge.',
    'services.check.pattern': 'Dieser Wert enthält nicht erlaubte Zeichen.',
    'services.check.pattern.slug':
      'Erlaubt sind Buchstaben, Ziffern, „.“, „_“ und „-“; am Anfang ein Buchstabe oder eine Ziffer.',
    'services.check.pattern.url':
      'Geben Sie eine Webadresse an, die mit http:// oder https:// beginnt.',
    'services.check.pattern.email': 'Geben Sie eine E-Mail-Adresse an, etwa support@example.org.',
    'services.check.uniqueItems': 'Jeder Eintrag darf nur einmal vorkommen.',
    'services.check.dependentRequired':
      'Geben Sie Adresse und Art des Kontakts an, oder keines von beiden.',
    'services.check.unknown': 'Dieses Feld ist nicht bekannt.',
    'services.check.enum': 'Das ist keine der Auswahlmöglichkeiten.',
    'services.check.unsupported':
      'Für dieses Feld gibt es eine Regel, die diese Seite nicht prüfen kann; der Server prüft sie.',
    'services.check.invalid': 'Dieser Wert ist nicht gültig.',

    'services.choice.none': 'Keine',
    'services.choice.choose': 'Auswählen…',
    'services.organisations.none':
      'Es gibt keine Organisation zur Auswahl. Lassen Sie sich zuerst von einer Verwalterin oder einem Verwalter einer Organisation als Mitglied bestätigen.',
    'services.organisations.more': 'Es gibt mehr Organisationen, als hier aufgelistet sind.',

    'services.license.placeholder': 'Nach Lizenzname oder SPDX-Kennung suchen',
    'services.license.found.one': '{count} Lizenz gefunden.',
    'services.license.found.other': '{count} Lizenzen gefunden.',
    'services.license.none': 'Keine Lizenz passt.',
    'services.license.failed':
      'Die Lizenzliste konnte nicht geladen werden. Versuchen Sie es erneut.',
    'services.license.chosen': 'Gewählte Lizenz: {name}',
    'services.license.clear': 'Lizenz entfernen',
    'services.license.osi': 'OSI-anerkannt',
    'services.license.deprecated': 'veraltet',

    'services.icon.afterCreate':
      'Das Symbol können Sie auf der nächsten Seite hinzufügen, sobald der Dienst angelegt ist.',
    'services.icon.title': 'Symbol',
    'services.icon.none': 'Noch kein Symbol.',
    'services.icon.choose': 'Symbol hochladen',
    'services.icon.hint': 'PNG, JPEG, WebP, GIF oder SVG, höchstens {count} MB.',
    'services.icon.remove': 'Symbol entfernen',
    'services.icon.saved': 'Das Symbol wurde gespeichert.',
    'services.icon.removed': 'Das Symbol wurde entfernt.',
    'services.icon.tooBig': 'Die Datei ist größer als {count} MB.',
    'services.icon.invalid': 'Die Datei ist leer, beschädigt oder kein unterstütztes Bild.',
    'services.icon.forbidden': 'Sie dürfen dieses Symbol nicht ändern.',

    'services.console.title': 'JSON-Konsole (nur Entwicklung)',
    'services.console.help':
      'Das Formular als JSON, in beide Richtungen: Was Sie in einem Feld eingeben, erscheint hier, und was Sie hier ändern, erscheint in den Feldern. Es wird wie jede andere Änderung geprüft. Diese Konsole gibt es auf einem Produktionsserver nicht.',
    'services.console.label': 'Das Formular als JSON',
    'services.console.invalid': 'Der Text ist kein gültiges JSON.',
    'services.console.notObject': 'Der Text muss ein einzelnes JSON-Objekt sein.',

    'services.done.title': 'Dienst angelegt',
    'services.done.toast': '{name} wurde angelegt.',
    'services.done.body': '{name} wurde angelegt. Sie können jetzt das Symbol hinzufügen.',
    'services.done.open': '{name} öffnen',
    'services.done.catalogue': 'Zurück zu den Diensten',

    'services.step.basics.title': 'Grunddaten',
    'services.step.basics.intro':
      'Geben Sie dem Dienst einen Kurznamen für seine Adresse und einen Namen, den man wiedererkennt. Die Lizenz wird in der SPDX-Liste gesucht.',
    'services.step.provision.title': 'Wer ihn betreibt',
    'services.step.provision.intro':
      'Wählen Sie die Organisation, die diesen Dienst betreibt, und gegebenenfalls die Gruppen, zu denen er gehört.',
    'services.step.contact.title': 'Kontakt',
    'services.step.contact.intro':
      'Ein Kontaktpunkt ist eine Funktionsadresse der Organisation, etwa ein Helpdesk, nie eine persönliche. Lassen Sie beides leer, um keinen anzugeben.',
    'services.field.slug.label': 'Kurzname (Teil der Adresse)',
    'services.field.slug.help':
      'Buchstaben, Ziffern, „.“, „_“ und „-“. Ein Mitglied kann ihn später nicht ändern.',
    'services.field.name.label': 'Name',
    'services.field.license.label': 'Lizenz',
    'services.field.license.help': 'Die Lizenz des Dienstes aus der SPDX-Liste.',
    'services.field.stage.label': 'Stufe',
    'services.field.icon.label': 'Symbol',
    'services.field.icon.help': 'Ein kleines Bild neben dem Namen.',
    'services.field.description.label': 'Beschreibung',
    'services.field.url.label': 'Webadresse des Dienstes',
    'services.field.sameAs.label': 'Weitere Links',
    'services.field.sameAs.help':
      'Andere Seiten, die denselben Dienst beschreiben, etwa ein Registereintrag.',
    'services.field.provider.label': 'Betrieben von',
    'services.field.provider.help':
      'Sie können nur eine Organisation wählen, in der Sie bestätigtes Mitglied sind.',
    'services.field.consortia.label': 'Gehört zu',
    'services.field.consortia.help': 'Die Gruppen, zu denen dieser Dienst gehört. Freiwillig.',
    'services.field.contactEmail.label': 'Kontaktadresse',
    'services.field.contactEmail.help':
      'Eine Funktionsadresse wie helpdesk@example.org, keine persönliche.',
    'services.field.contactType.label': 'Art des Kontakts',

    'services.detail.public': 'Öffentlich',
    'services.detail.private': 'Nicht öffentlich',
    'services.detail.publicHelp': 'Jeder, angemeldet oder nicht, kann diesen Dienst lesen.',
    'services.detail.privateHelp': 'Nur angemeldete Personen können diesen Dienst lesen.',
    'services.detail.shortName': 'Kurzname',
    'services.detail.stage': 'Stufe',
    'services.detail.license': 'Lizenz',
    'services.detail.licenseDeprecated': '(veraltet)',
    'services.detail.url': 'Webadresse',
    'services.detail.sameAs': 'Weitere Links',
    'services.detail.contact': 'Kontakt',
    'services.detail.publicPage': 'Öffentliche Seite öffnen',
    'services.detail.actions': 'Aktionen für diesen Dienst',

    'services.edit': 'Bearbeiten',
    'services.edit.title': '{name} bearbeiten',
    'services.edit.save': 'Änderungen speichern',
    'services.edit.cancel': 'Abbrechen',
    'services.edit.nothing': 'Noch nichts geändert.',
    'services.edit.saved': 'Ihre Änderungen wurden gespeichert.',
    'services.edit.renamed':
      '{name} hat jetzt den Kurznamen {slug}. Die alte Adresse funktioniert weiterhin.',
    'services.edit.fixFields':
      'Einige Angaben brauchen Aufmerksamkeit, bevor Sie speichern können.',
    'services.edit.forbidden':
      'Sie dürfen diese Änderung nicht vornehmen. Die Seite ist möglicherweise veraltet; nichts wurde gespeichert, Ihre Eingaben sind noch da.',
    'services.edit.identity':
      'Nur wer den {owner} verwaltet, oder ein Administrator kann diese Angaben ändern.',
    'services.edit.fixed': 'Feste Angaben',
    'services.edit.noWidget':
      'Das Feld „{field}“ kann hier nicht angezeigt werden (kein Eingabeelement für „{widget}“); es lässt sich auf dieser Seite nicht ändern.',

    'services.publish': 'Öffentlich machen',
    'services.publish.title': '{name} öffentlich machen?',
    'services.publish.message':
      'Jeder, angemeldet oder nicht, kann dann Name, Beschreibung und Links dieses Dienstes lesen, wer ihn betreibt und wozu er gehört. Die Kontaktstelle ist nie öffentlich.',
    'services.publish.confirm': 'Öffentlich machen',
    'services.publish.done': '{name} ist jetzt öffentlich.',
    'services.publish.off':
      'Dienste öffentlich zu machen ist auf dieser Instanz abgeschaltet; dieser Dienst kann jetzt nicht öffentlich gemacht werden.',
    'services.publish.offHint': 'Auf dieser Instanz abgeschaltet.',
    'services.unpublish': 'Nicht öffentlich machen',
    'services.unpublish.title': '{name} nicht mehr öffentlich machen?',
    'services.unpublish.message':
      'Nur angemeldete Personen können diesen Dienst dann lesen. Seine öffentliche Adresse antwortet binnen einer Minute, als gäbe es den Dienst nicht.',
    'services.unpublish.confirm': 'Nicht öffentlich machen',
    'services.unpublish.done': '{name} ist jetzt nicht mehr öffentlich.',
    'services.publish.forbidden':
      'Sie dürfen das nicht ändern. Die Seite ist möglicherweise veraltet; nichts wurde geändert.',
  },
};
