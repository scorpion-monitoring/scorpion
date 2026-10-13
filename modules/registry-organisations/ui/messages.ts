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
    'organisation.public.services': 'Services',
    'organisation.public.noServices': 'No public service is listed.',
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

    'nav.account.organisations': 'Organisations',
    'nav.admin.memberships': 'Membership requests',

    'organisation.membership.state.rejected': 'Rejected',
    'organisation.membership.state.left': 'Left',
    'organisation.requests.admin': 'Membership requests',
    'organisation.requests.manager': 'Requests and members',
    'organisation.edit.manager': 'Edit this organisation’s details',

    'account.organisations.title': 'Organisations',
    'account.organisations.own': 'Your memberships',
    'account.organisations.ownEmpty': 'You are not a member of any organisation yet.',
    'account.organisations.find': 'Find an organisation',
    'account.organisations.status': 'Your status',
    'account.organisations.manage': 'My organisations',
    'account.organisations.withdrawLabel': 'Withdraw the request for {name}',
    'account.organisations.leaveLabel': 'Leave {name}',
    'account.organisations.joinLabel': 'Ask to become a member of {name}',

    'organisation.manager.editTitle': 'Edit organisation',
    'organisation.manager.readOnly': 'Only an administrator can change these; ask one.',

    'membership.unknownPerson': '(account removed)',
    'membership.column.person': 'Person',
    'membership.column.role': 'Role',
    'membership.column.since': 'Member since',
    'membership.column.requested': 'Requested',
    'membership.column.decided': 'Decided',
    'membership.column.actions': 'Actions',
    'membership.list.more': 'Showing {shown} of {total}.',
    'membership.requests.title': 'Requests',
    'membership.requests.caption': 'Requests to join {name}',
    'membership.requests.empty': 'No request is waiting.',
    'membership.decided.title': 'Decided on this page',
    'membership.members.title': 'Members',
    'membership.members.caption': 'Members of {name}',
    'membership.members.empty': 'Nobody is a member yet.',
    'membership.noManager': 'No manager: administrators decide.',
    'membership.onlyManager':
      'You are the only manager. If you leave or are demoted, administrators decide on requests.',

    'membership.action.approve': 'Approve',
    'membership.action.reject': 'Reject',
    'membership.action.promote': 'Make manager',
    'membership.action.demote': 'Make member',
    'membership.action.remove': 'Remove',
    'membership.aria.approve': 'Approve the request of {name}',
    'membership.aria.reject': 'Reject the request of {name}',
    'membership.aria.promote': 'Make {name} a manager',
    'membership.aria.demote': 'Make {name} a member',
    'membership.aria.remove': 'Remove {name} from the organisation',
    'membership.done.approve': '{name} was approved.',
    'membership.done.reject': 'The request of {name} was rejected.',
    'membership.done.promote': '{name} is now a manager.',
    'membership.done.demote': '{name} is now a member.',
    'membership.done.remove': '{name} was removed.',
    'membership.confirm.reject.title': 'Reject the request of {name}?',
    'membership.confirm.reject.message':
      'The person is told that the request was rejected. They can ask again.',
    'membership.confirm.remove.title': 'Remove {name}?',
    'membership.confirm.remove.message':
      'The membership ends. The person can ask to become a member again, and a decider can approve it.',
    'membership.error.forbidden':
      'You are not allowed to do this. The page may be out of date; it was reloaded.',
    'membership.error.gone': 'This membership no longer exists.',
    'membership.error.state': 'Somebody else changed this row first. The list was reloaded.',
    'membership.error.tooManyManagers':
      'The organisation already has as many managers as the settings allow.',
    'membership.note.ownRequest': 'This is your own request. Somebody else decides on it.',
    'membership.note.ownMember': 'This is you. To end your membership, leave the organisation.',
    'membership.note.ownManager':
      'This is you. You cannot change your own role; another manager or an administrator does.',
    'membership.note.managerRemoval': 'Only an administrator can remove a manager.',

    'admin.memberships.title': 'Membership requests',
    'admin.memberships.state': 'State',
    'admin.memberships.state.requested': 'Pending requests',
    'admin.memberships.state.approved': 'Members',
    'admin.memberships.state.rejected': 'Rejected',
    'admin.memberships.state.left': 'Left',
    'admin.memberships.organisation': 'Organisation',
    'admin.memberships.organisation.all': 'All organisations',
    'admin.memberships.organisation.more':
      'The filter lists the first {shown} of {total} organisations.',
    'admin.memberships.column.organisation': 'Organisation',
    'admin.memberships.empty': 'Nothing matches.',

    'dash.membership.title': 'Membership requests',
    'dash.membership.some.one': '{count} request is waiting for a decision.',
    'dash.membership.some.other': '{count} requests are waiting for a decision.',
    'dash.membership.link': 'Decide on the requests',
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
    'organisation.public.services': 'Dienste',
    'organisation.public.noServices': 'Es ist kein öffentlicher Dienst aufgeführt.',
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

    'nav.account.organisations': 'Organisationen',
    'nav.admin.memberships': 'Mitgliedschaftsanträge',

    'organisation.membership.state.rejected': 'Abgelehnt',
    'organisation.membership.state.left': 'Ausgetreten',
    'organisation.requests.admin': 'Mitgliedschaftsanträge',
    'organisation.requests.manager': 'Anträge und Mitglieder',
    'organisation.edit.manager': 'Angaben dieser Organisation bearbeiten',

    'account.organisations.title': 'Organisationen',
    'account.organisations.own': 'Ihre Mitgliedschaften',
    'account.organisations.ownEmpty': 'Sie sind noch in keiner Organisation Mitglied.',
    'account.organisations.find': 'Organisation suchen',
    'account.organisations.status': 'Ihr Status',
    'account.organisations.manage': 'Meine Organisationen',
    'account.organisations.withdrawLabel': 'Antrag für {name} zurückziehen',
    'account.organisations.leaveLabel': '{name} verlassen',
    'account.organisations.joinLabel': 'Mitgliedschaft bei {name} beantragen',

    'organisation.manager.editTitle': 'Organisation bearbeiten',
    'organisation.manager.readOnly':
      'Das kann nur eine Administratorin oder ein Administrator ändern; bitten Sie darum.',

    'membership.unknownPerson': '(Konto entfernt)',
    'membership.column.person': 'Person',
    'membership.column.role': 'Rolle',
    'membership.column.since': 'Mitglied seit',
    'membership.column.requested': 'Beantragt',
    'membership.column.decided': 'Entschieden',
    'membership.column.actions': 'Aktionen',
    'membership.list.more': '{shown} von {total} werden angezeigt.',
    'membership.requests.title': 'Anträge',
    'membership.requests.caption': 'Anträge auf Mitgliedschaft bei {name}',
    'membership.requests.empty': 'Es wartet kein Antrag.',
    'membership.decided.title': 'Auf dieser Seite entschieden',
    'membership.members.title': 'Mitglieder',
    'membership.members.caption': 'Mitglieder von {name}',
    'membership.members.empty': 'Noch niemand ist Mitglied.',
    'membership.noManager': 'Keine Verwaltung: Die Administration entscheidet.',
    'membership.onlyManager':
      'Sie sind die einzige Verwaltung. Wenn Sie austreten oder herabgestuft werden, entscheidet die Administration über Anträge.',

    'membership.action.approve': 'Genehmigen',
    'membership.action.reject': 'Ablehnen',
    'membership.action.promote': 'Zur Verwaltung machen',
    'membership.action.demote': 'Zum Mitglied machen',
    'membership.action.remove': 'Entfernen',
    'membership.aria.approve': 'Antrag von {name} genehmigen',
    'membership.aria.reject': 'Antrag von {name} ablehnen',
    'membership.aria.promote': '{name} zur Verwaltung machen',
    'membership.aria.demote': '{name} zum Mitglied machen',
    'membership.aria.remove': '{name} aus der Organisation entfernen',
    'membership.done.approve': '{name} wurde genehmigt.',
    'membership.done.reject': 'Der Antrag von {name} wurde abgelehnt.',
    'membership.done.promote': '{name} gehört jetzt zur Verwaltung.',
    'membership.done.demote': '{name} ist jetzt Mitglied.',
    'membership.done.remove': '{name} wurde entfernt.',
    'membership.confirm.reject.title': 'Antrag von {name} ablehnen?',
    'membership.confirm.reject.message':
      'Die Person erfährt, dass der Antrag abgelehnt wurde. Sie kann erneut fragen.',
    'membership.confirm.remove.title': '{name} entfernen?',
    'membership.confirm.remove.message':
      'Die Mitgliedschaft endet. Die Person kann sie erneut beantragen, und eine entscheidende Stelle kann sie genehmigen.',
    'membership.error.forbidden':
      'Das dürfen Sie nicht. Die Seite war möglicherweise veraltet und wurde neu geladen.',
    'membership.error.gone': 'Diese Mitgliedschaft gibt es nicht mehr.',
    'membership.error.state':
      'Jemand anderes hat diese Zeile zuerst geändert. Die Liste wurde neu geladen.',
    'membership.error.tooManyManagers':
      'Die Organisation hat bereits so viele Verwaltende, wie die Einstellungen erlauben.',
    'membership.note.ownRequest': 'Das ist Ihr eigener Antrag. Jemand anderes entscheidet darüber.',
    'membership.note.ownMember':
      'Das sind Sie. Um Ihre Mitgliedschaft zu beenden, verlassen Sie die Organisation.',
    'membership.note.ownManager':
      'Das sind Sie. Ihre eigene Rolle können Sie nicht ändern; das tut eine andere Verwaltung oder die Administration.',
    'membership.note.managerRemoval': 'Nur die Administration kann eine Verwaltung entfernen.',

    'admin.memberships.title': 'Mitgliedschaftsanträge',
    'admin.memberships.state': 'Zustand',
    'admin.memberships.state.requested': 'Offene Anträge',
    'admin.memberships.state.approved': 'Mitglieder',
    'admin.memberships.state.rejected': 'Abgelehnt',
    'admin.memberships.state.left': 'Ausgetreten',
    'admin.memberships.organisation': 'Organisation',
    'admin.memberships.organisation.all': 'Alle Organisationen',
    'admin.memberships.organisation.more':
      'Der Filter listet die ersten {shown} von {total} Organisationen.',
    'admin.memberships.column.organisation': 'Organisation',
    'admin.memberships.empty': 'Nichts passt.',

    'dash.membership.title': 'Mitgliedschaftsanträge',
    'dash.membership.some.one': '{count} Antrag wartet auf eine Entscheidung.',
    'dash.membership.some.other': '{count} Anträge warten auf eine Entscheidung.',
    'dash.membership.link': 'Über die Anträge entscheiden',
  },
};
