// The texts of the shared components (forms, tables, wizard, facets, charts, toasts). Every key is in both
// languages; `catalogueProblems()` fails the build for one that is not.
import type { MessageBundles } from './i18n.ts';

export const componentMessages: MessageBundles = {
  en: {
    'kit.toast.region': 'Notifications',
    'kit.toast.dismiss': 'Dismiss this notification',

    'kit.confirm.cancel': 'Cancel',

    'kit.error.network': 'The service could not be reached. Check your connection and try again.',
    'kit.error.signedOut': 'You are signed out. Sign in again and repeat this.',
    'kit.error.forbidden': 'You are not allowed to do this.',
    'kit.error.notFound': 'That no longer exists. The list has been refreshed.',
    'kit.error.conflict': 'That conflicts with the current state. Reload the page and try again.',
    'kit.error.invalid': 'The service did not accept that.',
    'kit.error.throttled': 'Too many requests. Wait a moment and try again.',
    'kit.error.generic': 'That did not work. Try again.',

    'kit.breadcrumb.label': 'Breadcrumb',

    'kit.pagination.label': 'Pages',
    'kit.pagination.previous': 'Previous',
    'kit.pagination.next': 'Next',
    'kit.pagination.page': 'Page {page}',
    'kit.pagination.pageSize': 'Rows per page',
    'kit.pagination.range': '{from}–{to} of {total}',

    'kit.table.loading': 'Loading…',
    'kit.table.empty': 'Nothing to show.',
    'kit.table.retry': 'Try again',
    'kit.table.actions': 'Actions',

    'kit.form.save': 'Save',
    'kit.form.required': 'required',
    'kit.form.add': 'Add',
    'kit.form.remove': 'Remove',
    'kit.form.none': 'Nothing added yet.',
    'kit.form.choose': 'Choose…',
    'kit.form.option': 'Option {n}',
    'kit.form.item': 'Item {index}',
    'kit.form.itemOf': '{label}, item {index}',
    'kit.form.removeItem': 'Remove {label}, item {index}',
    'kit.form.removeTitle': 'Remove this item?',
    'kit.form.removeMessage':
      '{label}, item {index}, is taken out of the form. Nothing is saved until you save the form.',
    'kit.form.moveUp': 'Move {label}, item {index}, up',
    'kit.form.moveDown': 'Move {label}, item {index}, down',
    'kit.form.itemAdded': '{label}: item {index} added.',
    'kit.form.itemRemoved': '{label}: item {index} removed.',
    'kit.form.itemMoved': '{label}: item {index} moved to position {position}.',
    'kit.form.secretHint':
      'A stored value is never shown. Type a new one to replace it, or leave this empty.',
    'kit.form.opaque': 'This value cannot be edited in this form. It is kept as it is.',
    'kit.form.errors': 'The changes were not saved. Please correct the following:',
    'kit.form.conflict':
      'Somebody else changed this while you were editing. Your changes were not saved.',
    'kit.form.reload': 'Load the current values',

    'kit.wizard.progress': 'Progress',
    'kit.wizard.step': 'Step {current} of {total}: {label}',
    'kit.wizard.back': 'Back',
    'kit.wizard.next': 'Next',
    'kit.wizard.finish': 'Finish',
    'kit.wizard.leave': 'You have unsaved changes. Leave this page anyway?',

    'kit.facets.label': 'Filters',
    'kit.facets.min': 'From',
    'kit.facets.max': 'To',
    'kit.facets.count': '({count})',
    'kit.facets.clear': 'Clear all filters',
    'kit.facets.clearOne': 'Clear {label}',

    'kit.chart.category': 'Category',
    'kit.chart.showTable': 'Show the data as a table',
    'kit.chart.hideTable': 'Hide the table',
    'kit.chart.failed': 'The chart could not be drawn. The table has the same data.',
    'kit.chart.invalid': 'The chart data is not valid. The table has what there is.',
  },
  de: {
    'kit.toast.region': 'Benachrichtigungen',
    'kit.toast.dismiss': 'Diese Benachrichtigung schließen',

    'kit.confirm.cancel': 'Abbrechen',

    'kit.error.network':
      'Der Dienst ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    'kit.error.signedOut':
      'Sie sind abgemeldet. Melden Sie sich erneut an und wiederholen Sie das.',
    'kit.error.forbidden': 'Dazu haben Sie keine Berechtigung.',
    'kit.error.notFound': 'Das gibt es nicht mehr. Die Liste wurde aktualisiert.',
    'kit.error.conflict':
      'Das widerspricht dem aktuellen Stand. Laden Sie die Seite neu und versuchen Sie es erneut.',
    'kit.error.invalid': 'Der Dienst hat das nicht akzeptiert.',
    'kit.error.throttled':
      'Zu viele Anfragen. Warten Sie einen Moment und versuchen Sie es erneut.',
    'kit.error.generic': 'Das hat nicht funktioniert. Bitte versuchen Sie es erneut.',

    'kit.breadcrumb.label': 'Brotkrumennavigation',

    'kit.pagination.label': 'Seiten',
    'kit.pagination.previous': 'Zurück',
    'kit.pagination.next': 'Weiter',
    'kit.pagination.page': 'Seite {page}',
    'kit.pagination.pageSize': 'Zeilen pro Seite',
    'kit.pagination.range': '{from}–{to} von {total}',

    'kit.table.loading': 'Wird geladen…',
    'kit.table.empty': 'Nichts anzuzeigen.',
    'kit.table.retry': 'Erneut versuchen',
    'kit.table.actions': 'Aktionen',

    'kit.form.save': 'Speichern',
    'kit.form.required': 'Pflichtfeld',
    'kit.form.add': 'Hinzufügen',
    'kit.form.remove': 'Entfernen',
    'kit.form.none': 'Noch nichts hinzugefügt.',
    'kit.form.choose': 'Auswählen…',
    'kit.form.option': 'Option {n}',
    'kit.form.item': 'Eintrag {index}',
    'kit.form.itemOf': '{label}, Eintrag {index}',
    'kit.form.removeItem': '{label}, Eintrag {index} entfernen',
    'kit.form.removeTitle': 'Diesen Eintrag entfernen?',
    'kit.form.removeMessage':
      '{label}, Eintrag {index}, wird aus dem Formular genommen. Gespeichert wird erst, wenn Sie das Formular speichern.',
    'kit.form.moveUp': '{label}, Eintrag {index} nach oben',
    'kit.form.moveDown': '{label}, Eintrag {index} nach unten',
    'kit.form.itemAdded': '{label}: Eintrag {index} hinzugefügt.',
    'kit.form.itemRemoved': '{label}: Eintrag {index} entfernt.',
    'kit.form.itemMoved': '{label}: Eintrag {index} an Position {position} verschoben.',
    'kit.form.secretHint':
      'Ein gespeicherter Wert wird nie angezeigt. Geben Sie einen neuen ein, um ihn zu ersetzen, oder lassen Sie das Feld leer.',
    'kit.form.opaque':
      'Dieser Wert lässt sich in diesem Formular nicht bearbeiten. Er bleibt unverändert.',
    'kit.form.errors': 'Die Änderungen wurden nicht gespeichert. Bitte korrigieren Sie Folgendes:',
    'kit.form.conflict':
      'Jemand anderes hat dies geändert, während Sie es bearbeitet haben. Ihre Änderungen wurden nicht gespeichert.',
    'kit.form.reload': 'Aktuelle Werte laden',

    'kit.wizard.progress': 'Fortschritt',
    'kit.wizard.step': 'Schritt {current} von {total}: {label}',
    'kit.wizard.back': 'Zurück',
    'kit.wizard.next': 'Weiter',
    'kit.wizard.finish': 'Abschließen',
    'kit.wizard.leave': 'Sie haben ungespeicherte Änderungen. Die Seite trotzdem verlassen?',

    'kit.facets.label': 'Filter',
    'kit.facets.min': 'Von',
    'kit.facets.max': 'Bis',
    'kit.facets.count': '({count})',
    'kit.facets.clear': 'Alle Filter zurücksetzen',
    'kit.facets.clearOne': '{label} zurücksetzen',

    'kit.chart.category': 'Kategorie',
    'kit.chart.showTable': 'Daten als Tabelle anzeigen',
    'kit.chart.hideTable': 'Tabelle ausblenden',
    'kit.chart.failed':
      'Das Diagramm konnte nicht gezeichnet werden. Die Tabelle enthält dieselben Daten.',
    'kit.chart.invalid': 'Die Diagrammdaten sind ungültig. Die Tabelle zeigt, was vorhanden ist.',
  },
};
