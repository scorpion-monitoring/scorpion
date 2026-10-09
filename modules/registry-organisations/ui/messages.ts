import type { UiMessages } from '@scorpion/contracts';

// The texts of the pages of registry.organisations: the organisation page and the administrator's editor.
// The label of an organisation type comes from its registry entry, never from here. A text that depends on
// a number has one key per plural form (`.one`, `.other`).
export const messages: UiMessages = {
  en: {
    'nav.admin.organisations': 'Organisations',

    'admin.organisations.title': 'Organisations',
    'admin.organisations.new': 'New organisation',
    'admin.organisations.view': 'View the organisation page',
    'admin.organisations.search': 'Search by abbreviation or name',
    'admin.organisations.searchSubmit': 'Search',
    'admin.organisations.type': 'Type',
    'admin.organisations.type.all': 'All types',
    'admin.organisations.abbreviation': 'Abbreviation',
    'admin.organisations.name': 'Name',
    'admin.organisations.members': 'Members',
    'admin.organisations.empty': 'No organisation matches.',

    'organisation.crumb': 'Organisation',
    'organisation.edit': 'Edit this organisation',
    'organisation.website': 'Website',
    'organisation.rorId': 'ROR id',
    'organisation.sameAs': 'Also known as',
    'organisation.contact': 'Contact',
    'organisation.members': 'Members',
    'organisation.members.count.one': '{count} member',
    'organisation.members.count.other': '{count} members',
    'organisation.type.unknown': '{id} (not registered)',

    'organisation.membership.title': 'Your membership',
    'organisation.membership.lead': 'You can ask to become a member of this organisation.',
    'organisation.membership.request': 'Ask to become a member',
    'organisation.membership.requested': 'Your request was sent.',
    'organisation.membership.pending': 'Your request is waiting for a decision.',
    'organisation.membership.withdraw': 'Withdraw the request',
    'organisation.membership.withdrawn': 'Your request was withdrawn.',
    'organisation.membership.isMember': 'You are a member of this organisation.',
    'organisation.membership.isManager': 'You are a manager of this organisation.',
    'organisation.membership.leave': 'Leave the organisation',
    'organisation.membership.leaveTitle': 'Leave {name}?',
    'organisation.membership.leaveMessage':
      'You stop being a member. You can ask again later, and a request is decided again.',
    'organisation.membership.left': 'You left the organisation.',
    'organisation.membership.none': 'People cannot become members of this kind of organisation.',
    'organisation.membership.tooMany':
      'You already have the most open requests allowed. Wait for a decision or withdraw one first.',
    'organisation.membership.notSupported':
      'People cannot become members of this kind of organisation.',
    'organisation.membership.state.requested': 'Pending',
    'organisation.membership.state.member': 'Member',
    'organisation.membership.state.manager': 'Manager',

    'organisation.memberList.title': 'Members',
    'organisation.memberList.empty': 'Nobody is a member yet.',
    'organisation.memberList.since': 'since',

    'organisation.form.title': 'Details',
    'organisation.form.group.identity': 'Identity',
    'organisation.form.group.profile': 'Profile',
    'organisation.form.group.contact': 'Contact point',
    'organisation.form.type': 'Type',
    'organisation.form.type.help':
      'The kind of organisation. Services and memberships depend on it; it can only change while nothing refers to the organisation.',
    'organisation.form.type.choose': 'Choose a type',
    'organisation.form.abbreviation': 'Abbreviation',
    'organisation.form.abbreviation.help':
      'Up to {max} characters, no spaces or "/". It is the short key other parts of the system use, and it is unique among organisations of the same type.',
    'organisation.form.name': 'Name',
    'organisation.form.name.help':
      'Up to {max} characters, unique among organisations of the same type.',
    'organisation.form.description': 'Description',
    'organisation.form.description.help': 'Plain text, up to {max} characters.',
    'organisation.form.website': 'Website',
    'organisation.form.website.help':
      'The organisation’s own site, starting with http:// or https://.',
    'organisation.form.rorId': 'ROR id',
    'organisation.form.rorId.help':
      'The id from ror.org, for example {example}. You can paste the whole ror.org link.',
    'organisation.form.rorId.preview': 'Will be saved as',
    'organisation.form.sameAs': 'Other pages about the organisation',
    'organisation.form.sameAs.help':
      'Links to the same organisation elsewhere (Wikidata, a registry). At most {max}, each starting with http:// or https://.',
    'organisation.form.contactEmail': 'Contact address',
    'organisation.form.contactEmail.help':
      'Use a shared address, not a person’s (for example info@…). It belongs to the organisation, not to an account; no mail is ever sent to it by this system. Up to {max} characters.',
    'organisation.form.contactType': 'Contact type',
    'organisation.form.contactType.help':
      'What the address is for, for example “customer support”. Needed with the address. Up to {max} characters.',
    'organisation.form.create': 'Create the organisation',
    'organisation.form.save': 'Save changes',
    'organisation.form.created': '{name} was created.',
    'organisation.form.saved': 'The organisation was saved.',
    'organisation.form.nothingChanged': 'Nothing was changed.',
    'organisation.form.forbidden':
      'You are not allowed to change this. Only an administrator can change the type, abbreviation and name.',

    'organisation.type.inUse':
      'The type cannot change while something refers to the organisation. Still in use by: {modules}.',
    'organisation.type.inUse.unnamed':
      'The type cannot change while something refers to the organisation.',

    'organisation.logo.title': 'Logo',
    'organisation.logo.alt': 'Logo of {name}',
    'organisation.logo.none': 'No logo yet.',
    'organisation.logo.afterCreate': 'You can add a logo once the organisation exists.',
    'organisation.logo.choose': 'Upload a logo',
    'organisation.logo.hint':
      'PNG, JPEG, WebP, GIF or SVG, up to {count} MB. The file is checked and rewritten before it is stored.',
    'organisation.logo.remove': 'Remove the logo',
    'organisation.logo.saved': 'The logo was saved.',
    'organisation.logo.removed': 'The logo was removed.',
    'organisation.logo.tooBig': 'The file is larger than {count} MB.',
    'organisation.logo.invalid': 'The file is empty, damaged or not a supported image.',
    'organisation.logo.forbidden': 'You are not allowed to change this logo.',

    'organisation.delete.title': 'Delete the organisation',
    'organisation.delete.lead':
      'Deleting removes the organisation, its memberships and its logo. It cannot be undone.',
    'organisation.delete.button': 'Delete…',
    'organisation.delete.confirmTitle': 'Delete {name}?',
    'organisation.delete.confirmMessage':
      'The organisation, all its memberships and its logo are removed. This cannot be undone.',
    'organisation.delete.confirm': 'Delete the organisation',
    'organisation.delete.done': '{name} was deleted.',
    'organisation.delete.gone': 'The organisation no longer exists.',
    'organisation.delete.inUse':
      'The organisation cannot be deleted while something refers to it. Still in use by: {modules}.',
    'organisation.delete.inUse.unnamed':
      'The organisation cannot be deleted while something refers to it.',
  },
  de: {
    'nav.admin.organisations': 'Organisationen',

    'admin.organisations.title': 'Organisationen',
    'admin.organisations.new': 'Neue Organisation',
    'admin.organisations.view': 'Seite der Organisation ansehen',
    'admin.organisations.search': 'Nach Kürzel oder Name suchen',
    'admin.organisations.searchSubmit': 'Suchen',
    'admin.organisations.type': 'Art',
    'admin.organisations.type.all': 'Alle Arten',
    'admin.organisations.abbreviation': 'Kürzel',
    'admin.organisations.name': 'Name',
    'admin.organisations.members': 'Mitglieder',
    'admin.organisations.empty': 'Keine Organisation passt.',

    'organisation.crumb': 'Organisation',
    'organisation.edit': 'Diese Organisation bearbeiten',
    'organisation.website': 'Webseite',
    'organisation.rorId': 'ROR-ID',
    'organisation.sameAs': 'Auch bekannt als',
    'organisation.contact': 'Kontakt',
    'organisation.members': 'Mitglieder',
    'organisation.members.count.one': '{count} Mitglied',
    'organisation.members.count.other': '{count} Mitglieder',
    'organisation.type.unknown': '{id} (nicht registriert)',

    'organisation.membership.title': 'Ihre Mitgliedschaft',
    'organisation.membership.lead':
      'Sie können die Mitgliedschaft in dieser Organisation beantragen.',
    'organisation.membership.request': 'Mitgliedschaft beantragen',
    'organisation.membership.requested': 'Ihr Antrag wurde gesendet.',
    'organisation.membership.pending': 'Ihr Antrag wartet auf eine Entscheidung.',
    'organisation.membership.withdraw': 'Antrag zurückziehen',
    'organisation.membership.withdrawn': 'Ihr Antrag wurde zurückgezogen.',
    'organisation.membership.isMember': 'Sie sind Mitglied dieser Organisation.',
    'organisation.membership.isManager': 'Sie verwalten diese Organisation.',
    'organisation.membership.leave': 'Organisation verlassen',
    'organisation.membership.leaveTitle': '{name} verlassen?',
    'organisation.membership.leaveMessage':
      'Sie sind dann kein Mitglied mehr. Sie können später erneut anfragen; über einen Antrag wird neu entschieden.',
    'organisation.membership.left': 'Sie haben die Organisation verlassen.',
    'organisation.membership.none':
      'Bei dieser Art von Organisation kann man nicht Mitglied werden.',
    'organisation.membership.tooMany':
      'Sie haben bereits die höchste Zahl offener Anträge. Warten Sie auf eine Entscheidung oder ziehen Sie einen zurück.',
    'organisation.membership.notSupported':
      'Bei dieser Art von Organisation kann man nicht Mitglied werden.',
    'organisation.membership.state.requested': 'Offen',
    'organisation.membership.state.member': 'Mitglied',
    'organisation.membership.state.manager': 'Verwaltung',

    'organisation.memberList.title': 'Mitglieder',
    'organisation.memberList.empty': 'Noch niemand ist Mitglied.',
    'organisation.memberList.since': 'seit',

    'organisation.form.title': 'Angaben',
    'organisation.form.group.identity': 'Identität',
    'organisation.form.group.profile': 'Profil',
    'organisation.form.group.contact': 'Kontaktstelle',
    'organisation.form.type': 'Art',
    'organisation.form.type.help':
      'Die Art der Organisation. Dienste und Mitgliedschaften hängen davon ab; sie lässt sich nur ändern, solange nichts auf die Organisation verweist.',
    'organisation.form.type.choose': 'Art wählen',
    'organisation.form.abbreviation': 'Kürzel',
    'organisation.form.abbreviation.help':
      'Bis zu {max} Zeichen, keine Leerzeichen und kein „/“. Andere Teile des Systems benutzen es als Schlüssel; es ist unter Organisationen derselben Art eindeutig.',
    'organisation.form.name': 'Name',
    'organisation.form.name.help':
      'Bis zu {max} Zeichen, unter Organisationen derselben Art eindeutig.',
    'organisation.form.description': 'Beschreibung',
    'organisation.form.description.help': 'Reiner Text, bis zu {max} Zeichen.',
    'organisation.form.website': 'Webseite',
    'organisation.form.website.help':
      'Die eigene Seite der Organisation, beginnend mit http:// oder https://.',
    'organisation.form.rorId': 'ROR-ID',
    'organisation.form.rorId.help':
      'Die ID von ror.org, zum Beispiel {example}. Sie können auch den ganzen ror.org-Link einfügen.',
    'organisation.form.rorId.preview': 'Wird gespeichert als',
    'organisation.form.sameAs': 'Weitere Seiten über die Organisation',
    'organisation.form.sameAs.help':
      'Links auf dieselbe Organisation anderswo (Wikidata, ein Register). Höchstens {max}, jeder beginnt mit http:// oder https://.',
    'organisation.form.contactEmail': 'Kontaktadresse',
    'organisation.form.contactEmail.help':
      'Bitte eine gemeinsame Adresse, keine persönliche (zum Beispiel info@…). Sie gehört der Organisation, keinem Konto; dieses System schreibt nie an sie. Bis zu {max} Zeichen.',
    'organisation.form.contactType': 'Art des Kontakts',
    'organisation.form.contactType.help':
      'Wofür die Adresse ist, zum Beispiel „customer support“. Zusammen mit der Adresse nötig. Bis zu {max} Zeichen.',
    'organisation.form.create': 'Organisation anlegen',
    'organisation.form.save': 'Änderungen speichern',
    'organisation.form.created': '{name} wurde angelegt.',
    'organisation.form.saved': 'Die Organisation wurde gespeichert.',
    'organisation.form.nothingChanged': 'Es wurde nichts geändert.',
    'organisation.form.forbidden':
      'Das dürfen Sie nicht ändern. Art, Kürzel und Name kann nur eine Administratorin oder ein Administrator ändern.',

    'organisation.type.inUse':
      'Die Art lässt sich nicht ändern, solange etwas auf die Organisation verweist. Noch in Gebrauch von: {modules}.',
    'organisation.type.inUse.unnamed':
      'Die Art lässt sich nicht ändern, solange etwas auf die Organisation verweist.',

    'organisation.logo.title': 'Logo',
    'organisation.logo.alt': 'Logo von {name}',
    'organisation.logo.none': 'Noch kein Logo.',
    'organisation.logo.afterCreate':
      'Ein Logo lässt sich hinzufügen, sobald die Organisation angelegt ist.',
    'organisation.logo.choose': 'Logo hochladen',
    'organisation.logo.hint':
      'PNG, JPEG, WebP, GIF oder SVG, bis zu {count} MB. Die Datei wird vor dem Speichern geprüft und neu geschrieben.',
    'organisation.logo.remove': 'Logo entfernen',
    'organisation.logo.saved': 'Das Logo wurde gespeichert.',
    'organisation.logo.removed': 'Das Logo wurde entfernt.',
    'organisation.logo.tooBig': 'Die Datei ist größer als {count} MB.',
    'organisation.logo.invalid': 'Die Datei ist leer, beschädigt oder kein unterstütztes Bild.',
    'organisation.logo.forbidden': 'Sie dürfen dieses Logo nicht ändern.',

    'organisation.delete.title': 'Organisation löschen',
    'organisation.delete.lead':
      'Beim Löschen verschwinden die Organisation, ihre Mitgliedschaften und ihr Logo. Das lässt sich nicht rückgängig machen.',
    'organisation.delete.button': 'Löschen …',
    'organisation.delete.confirmTitle': '{name} löschen?',
    'organisation.delete.confirmMessage':
      'Die Organisation, alle ihre Mitgliedschaften und ihr Logo werden entfernt. Das lässt sich nicht rückgängig machen.',
    'organisation.delete.confirm': 'Organisation löschen',
    'organisation.delete.done': '{name} wurde gelöscht.',
    'organisation.delete.gone': 'Die Organisation gibt es nicht mehr.',
    'organisation.delete.inUse':
      'Die Organisation lässt sich nicht löschen, solange etwas auf sie verweist. Noch in Gebrauch von: {modules}.',
    'organisation.delete.inUse.unnamed':
      'Die Organisation lässt sich nicht löschen, solange etwas auf sie verweist.',
  },
};
