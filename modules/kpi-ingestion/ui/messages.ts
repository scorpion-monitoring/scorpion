import type { UiMessages } from '@scorpion/contracts';

// The texts of the Data Submission page. Labels of units, necessities (the groups Mandatory, Recommended, Optional) and value types come from
// their vocabularies and the registry, never from here; the names of the ways to report (Form, CSV, XLSX) come from the adapters. No text names
// the instance or a role. A problem of a file is a code from the server; `problem.<code>` is the sentence for it (the test `ui.test.ts` fails
// when a code of the server's closed list has no sentence in a language). {count}-style plurals are avoided: every sentence is a number and a noun
// that reads right for one and for many.
export const messages: UiMessages = {
  en: {
    'nav.submit': 'Data Submission',

    'submit.title': 'Data Submission',
    'submit.intro':
      'Report the values of a service for a month: fill in the form, or upload a CSV or XLSX file. A value you report for a month that already has one replaces it.',
    'submit.none.title': 'There is no service you can report for',
    'submit.none.body':
      'Values are reported by people who belong to the organisation that runs a service. You do not belong to such an organisation yet, so there is nobody to report for.',
    'submit.none.link': 'Your organisations',
    'submit.noMatch': 'No service you can report for matches this search.',
    'submit.choose': 'Choose a service to start.',
    'submit.reporting': 'Reporting for {name}',
    'submit.service.link': 'Open the service page',
    'submit.loadFailed': 'The page could not be loaded.',

    'submit.picker.search': 'Search services',
    'submit.picker.search.hint': 'By name or short name',
    'submit.picker.search.submit': 'Search',
    'submit.picker.select': 'Service',
    'submit.picker.open': 'Open',
    'submit.picker.more':
      'Only the first {count} services are listed. Narrow the search to see others.',

    'submit.tabs.label': 'Ways to report',
    'submit.tabs.form': 'Form',
    'submit.tabs.file': 'File',
    'submit.tabs.history': 'History',

    'submit.month.label': 'Month',
    'submit.month.show': 'Show month',
    'submit.month.help': 'Only the current and past months can be reported.',

    'submit.form.intro':
      'Enter the value of each indicator for the month. Values already stored are filled in; save again to correct them.',
    'submit.form.noKpis':
      'This service has no KPIs yet, so there is nothing to report. Choose a KPI set on the service page first.',
    'submit.form.required': 'required',
    'submit.form.unit': 'Unit: {unit}',
    'submit.form.bounds.both': 'From {min} to {max}',
    'submit.form.bounds.min': 'At least {min}',
    'submit.form.bounds.max': 'At most {max}',
    'submit.form.hint': 'Format: {hint}',
    'submit.form.submit': 'Save values',
    'submit.form.missing': 'Fill in every mandatory indicator to save.',
    'submit.form.saving': 'Saving ...',
    'submit.form.saved':
      'Saved {month}: {inserted} added, {updated} changed, {unchanged} unchanged.',
    'submit.form.summary': 'Some values need attention before they can be saved.',
    'submit.form.failed': 'The values could not be saved.',
    'submit.form.empty': 'Enter at least one value.',
    'submit.form.unsaved': 'There are unsaved values.',
    'submit.form.error.number': 'Enter a number, for example 12 or 12.5.',
    'submit.form.error.integer': 'Enter a whole number.',
    'submit.form.error.min': 'Enter a value of at least {bound}.',
    'submit.form.error.max': 'Enter a value of at most {bound}.',
    'submit.form.error.pattern': 'The value does not have the expected format.',
    'submit.form.error.patternHint': 'Use the format {hint}.',
    'submit.form.error.long': 'The value is too long.',
    'submit.form.error.required': 'A value is needed here.',

    'submit.file.intro':
      'Upload a file with one row per month and one column per indicator. The page shows how the columns are read before anything is recorded.',
    'submit.file.drop': 'Drop a file here',
    'submit.file.group': 'Upload a file',
    'submit.file.choose': 'Choose a file',
    'submit.file.chooseAnother': 'Choose another file',
    'submit.file.accepts': 'Accepted: {types}. At most {size} MiB.',
    'submit.file.name': 'File: {name}',
    'submit.file.error.empty': 'The file is empty.',
    'submit.file.error.tooLarge': 'The file is larger than {size} MiB.',
    'submit.file.reading': 'Reading the file ...',
    'submit.file.checking': 'Checking the values ...',
    'submit.file.recording': 'Recording the values ...',
    'submit.file.failed': 'The file could not be read.',
    'submit.file.template.title': 'Template',
    'submit.file.template.help':
      'A header row with the indicators of this service (a star marks a mandatory one) and an example row. Fill it in and upload it again.',
    'submit.file.template.download': 'Download the {format} template',
    'submit.file.template.failed': 'The template could not be downloaded.',
    'submit.file.adapter': 'The file was read as {adapter}.',
    'submit.file.preview.caption': 'First rows of the file and how its columns are read',
    'submit.file.preview.showing': 'Showing the first {shown} of {total} rows.',
    'submit.file.preview.row': 'Row',
    'submit.file.preview.cut': 'Long cells are cut in this view.',

    'submit.mapping.title': 'What each column holds',
    'submit.mapping.label': 'What column {n} ({header}) holds',
    'submit.mapping.none': 'Not used',
    'submit.mapping.period': 'Period (month)',
    'submit.mapping.taken': '{name} (used by column {n})',
    'submit.mapping.proposed':
      'The columns were matched to the indicators by their headings. Check the choices below.',
    'submit.mapping.changed': 'You changed the mapping. Check the file again to see the result.',
    'submit.mapping.missing': 'Still to map: {list}.',
    'submit.mapping.missing.period': 'the period',
    'submit.mapping.check': 'Check the file',

    'submit.check.summary':
      '{insert} to add, {update} to change, {unchanged} unchanged, {reject} rejected.',
    'submit.check.ok': 'Nothing is rejected. You can record the values.',
    'submit.check.blocked':
      'Nothing is recorded while any value is rejected. Correct the file and choose it again.',
    'submit.check.needed': 'Check the file to see what would be recorded.',
    'submit.commit.submit': 'Record the values',
    'submit.commit.done': 'Recorded: {inserted} added, {updated} changed, {unchanged} unchanged.',
    'submit.commit.refused':
      'The file was refused and nothing was recorded. The problems are listed below.',
    'submit.commit.failed': 'The values could not be recorded.',

    'submit.verdict.insert': 'will be added',
    'submit.verdict.update': 'will be changed',
    'submit.verdict.unchanged': 'unchanged',
    'submit.verdict.reject': 'cannot be recorded',
    'submit.cell.invalid': 'Invalid: {message}',

    'submit.problems.title': 'What needs to be fixed',
    'submit.problems.file': 'File: {message}',
    'submit.problems.row': 'Row {row}: {message}',
    'submit.problems.cell': 'Row {row}, column {column}: {message}',
    'submit.problems.truncated': 'Only the first {count} problems are listed.',

    'submit.error.serviceId':
      'This service has no KPIs yet. Choose a KPI set on the service page, then try again.',
    'submit.error.noValues':
      'The file holds no values to record. Fill in the values and upload it again.',
    'submit.error.file': 'The file could not be used. Choose another file.',
    'submit.error.adapter': 'This kind of file is not accepted.',
    'submit.error.mapping': 'The column mapping is not valid. Check the choices and try again.',
    'submit.error.other': 'The request was not accepted. Check the file and try again.',
    'submit.error.throttled': 'Too many requests. Wait a moment and try again.',

    'submit.history.runs': 'Recent reports',
    'submit.history.runs.empty': 'Nothing has been reported for this service yet.',
    'submit.history.col.when': 'When',
    'submit.history.col.who': 'Who',
    'submit.history.col.source': 'Way',
    'submit.history.col.file': 'File',
    'submit.history.col.added': 'Added',
    'submit.history.col.changed': 'Changed',
    'submit.history.col.unchanged': 'Unchanged',
    'submit.history.col.rejected': 'Rejected',
    'submit.history.col.result': 'Result',
    'submit.history.status.committed': 'Recorded',
    'submit.history.status.rejected': 'Refused',
    'submit.history.actor.you': 'You',
    'submit.history.actor.other': 'A colleague',
    'submit.history.actor.unknown': 'Not recorded',
    'submit.history.coverage': 'The last 12 months',
    'submit.history.coverage.col.month': 'Month',
    'submit.history.coverage.col.reported': 'Values',
    'submit.history.coverage.col.mandatory': 'Mandatory',
    'submit.history.coverage.col.status': 'Status',
    'submit.history.coverage.reported': '{reported} of {total}',
    'submit.history.coverage.mandatory': '{reported} of {total}',
    'submit.history.coverage.complete': 'Complete',
    'submit.history.coverage.incomplete': 'Mandatory values missing',
    'submit.history.coverage.empty': 'No months to show.',

    'submit.problem.unknown': 'The file has a problem that this page has no words for.',
    'submit.problem.empty-file': 'The file has no rows.',
    'submit.problem.format': 'The file could not be read as a table.',
    'submit.problem.encoding': 'The file is not UTF-8 text. Save it as UTF-8 and upload it again.',
    'submit.problem.not-text': 'The file is not a text file.',
    'submit.problem.not-a-zip':
      'The file is not an XLSX workbook. It may be cut short, or be another kind of file.',
    'submit.problem.encrypted':
      'The workbook is password-protected or encrypted. Save it without a password and upload it again.',
    'submit.problem.zip64': 'The workbook uses an archive format that is not accepted here.',
    'submit.problem.corrupt': 'The workbook is damaged and cannot be read.',
    'submit.problem.too-many-entries':
      'The workbook holds too many parts to be a normal spreadsheet.',
    'submit.problem.declared-too-large':
      'The workbook is too large when unpacked (at most 20 MiB).',
    'submit.problem.inflated-too-large':
      'The workbook is too large when unpacked (at most 20 MiB).',
    'submit.problem.sheet-not-found': 'The workbook has no such sheet.',
    'submit.problem.unterminated-quote': 'A quoted field is not closed.',
    'submit.problem.quote-in-field': 'A quote appears inside a field that does not start with one.',
    'submit.problem.text-after-quote':
      'There is text between the closing quote and the next separator.',
    'submit.problem.field-too-long': 'A field is longer than 4000 characters.',
    'submit.problem.too-many-rows': 'The file has more than 5000 data rows.',
    'submit.problem.too-many-columns': 'The file has more than 200 columns.',
    'submit.problem.mapping-invalid':
      'The column mapping names a column or an indicator that does not exist, or uses a target twice.',
    'submit.problem.duplicate-column':
      'Two columns hold the same indicator or the period. Only the first is used.',
    'submit.problem.missing-column':
      'A required column is not mapped: the period, or a mandatory indicator.',
    'submit.problem.period-missing': 'The row has values but no period.',
    'submit.problem.required-value': 'A mandatory indicator has no value here.',
    'submit.problem.cell-type': 'The cell is not text, a number or a date.',
    'submit.problem.indicator-invalid':
      'The indicator is not one of the indicators of this service.',
    'submit.problem.period-invalid': 'The period is not a month in the form YYYY-MM or YYYY-MM-DD.',
    'submit.problem.value-invalid': 'The value is not valid for this indicator.',
    'submit.problem.duplicate-row': 'The same indicator and month appear twice in the file.',
  },
  de: {
    'nav.submit': 'Datenmeldung',

    'submit.title': 'Datenmeldung',
    'submit.intro':
      'Melden Sie die Werte eines Dienstes für einen Monat: im Formular oder mit einer CSV- oder XLSX-Datei. Ein Wert für einen Monat, der schon einen hat, ersetzt diesen.',
    'submit.none.title': 'Es gibt keinen Dienst, für den Sie melden können',
    'submit.none.body':
      'Werte melden Personen, die zu der Organisation gehören, die einen Dienst betreibt. Sie gehören noch zu keiner solchen Organisation, daher gibt es niemanden, für den Sie melden könnten.',
    'submit.none.link': 'Ihre Organisationen',
    'submit.noMatch': 'Kein Dienst, für den Sie melden können, passt zu dieser Suche.',
    'submit.choose': 'Wählen Sie einen Dienst, um zu beginnen.',
    'submit.reporting': 'Meldung für {name}',
    'submit.service.link': 'Zur Seite des Dienstes',
    'submit.loadFailed': 'Die Seite konnte nicht geladen werden.',

    'submit.picker.search': 'Dienste suchen',
    'submit.picker.search.hint': 'Nach Name oder Kurzname',
    'submit.picker.search.submit': 'Suchen',
    'submit.picker.select': 'Dienst',
    'submit.picker.open': 'Öffnen',
    'submit.picker.more':
      'Es werden nur die ersten {count} Dienste angezeigt. Grenzen Sie die Suche ein, um andere zu sehen.',

    'submit.tabs.label': 'Wege der Meldung',
    'submit.tabs.form': 'Formular',
    'submit.tabs.file': 'Datei',
    'submit.tabs.history': 'Verlauf',

    'submit.month.label': 'Monat',
    'submit.month.show': 'Monat anzeigen',
    'submit.month.help': 'Gemeldet werden können nur der aktuelle und vergangene Monate.',

    'submit.form.intro':
      'Geben Sie für den Monat den Wert jedes Indikators ein. Bereits gespeicherte Werte sind eingetragen; speichern Sie erneut, um sie zu korrigieren.',
    'submit.form.noKpis':
      'Dieser Dienst hat noch keine KPIs, es gibt also nichts zu melden. Wählen Sie zuerst auf der Seite des Dienstes ein KPI-Set.',
    'submit.form.required': 'Pflicht',
    'submit.form.unit': 'Einheit: {unit}',
    'submit.form.bounds.both': 'Von {min} bis {max}',
    'submit.form.bounds.min': 'Mindestens {min}',
    'submit.form.bounds.max': 'Höchstens {max}',
    'submit.form.hint': 'Format: {hint}',
    'submit.form.submit': 'Werte speichern',
    'submit.form.missing': 'Füllen Sie jeden Pflichtindikator aus, um zu speichern.',
    'submit.form.saving': 'Wird gespeichert ...',
    'submit.form.saved':
      'Gespeichert, {month}: {inserted} neu, {updated} geändert, {unchanged} unverändert.',
    'submit.form.summary':
      'Einige Werte müssen geprüft werden, bevor sie gespeichert werden können.',
    'submit.form.failed': 'Die Werte konnten nicht gespeichert werden.',
    'submit.form.empty': 'Geben Sie mindestens einen Wert ein.',
    'submit.form.unsaved': 'Es gibt ungespeicherte Werte.',
    'submit.form.error.number': 'Geben Sie eine Zahl ein, zum Beispiel 12 oder 12.5.',
    'submit.form.error.integer': 'Geben Sie eine ganze Zahl ein.',
    'submit.form.error.min': 'Geben Sie einen Wert von mindestens {bound} ein.',
    'submit.form.error.max': 'Geben Sie einen Wert von höchstens {bound} ein.',
    'submit.form.error.pattern': 'Der Wert hat nicht das erwartete Format.',
    'submit.form.error.patternHint': 'Verwenden Sie das Format {hint}.',
    'submit.form.error.long': 'Der Wert ist zu lang.',
    'submit.form.error.required': 'Hier wird ein Wert benötigt.',

    'submit.file.intro':
      'Laden Sie eine Datei mit einer Zeile je Monat und einer Spalte je Indikator hoch. Die Seite zeigt, wie die Spalten gelesen werden, bevor etwas gespeichert wird.',
    'submit.file.drop': 'Datei hier ablegen',
    'submit.file.group': 'Datei hochladen',
    'submit.file.choose': 'Datei auswählen',
    'submit.file.chooseAnother': 'Andere Datei auswählen',
    'submit.file.accepts': 'Erlaubt: {types}. Höchstens {size} MiB.',
    'submit.file.name': 'Datei: {name}',
    'submit.file.error.empty': 'Die Datei ist leer.',
    'submit.file.error.tooLarge': 'Die Datei ist größer als {size} MiB.',
    'submit.file.reading': 'Die Datei wird gelesen ...',
    'submit.file.checking': 'Die Werte werden geprüft ...',
    'submit.file.recording': 'Die Werte werden gespeichert ...',
    'submit.file.failed': 'Die Datei konnte nicht gelesen werden.',
    'submit.file.template.title': 'Vorlage',
    'submit.file.template.help':
      'Eine Kopfzeile mit den Indikatoren dieses Dienstes (ein Stern kennzeichnet einen Pflichtindikator) und eine Beispielzeile. Füllen Sie sie aus und laden Sie sie wieder hoch.',
    'submit.file.template.download': 'Vorlage als {format} herunterladen',
    'submit.file.template.failed': 'Die Vorlage konnte nicht heruntergeladen werden.',
    'submit.file.adapter': 'Die Datei wurde als {adapter} gelesen.',
    'submit.file.preview.caption': 'Erste Zeilen der Datei und wie ihre Spalten gelesen werden',
    'submit.file.preview.showing': 'Angezeigt werden die ersten {shown} von {total} Zeilen.',
    'submit.file.preview.row': 'Zeile',
    'submit.file.preview.cut': 'Lange Zellen sind in dieser Ansicht gekürzt.',

    'submit.mapping.title': 'Was jede Spalte enthält',
    'submit.mapping.label': 'Was Spalte {n} ({header}) enthält',
    'submit.mapping.none': 'Nicht verwendet',
    'submit.mapping.period': 'Zeitraum (Monat)',
    'submit.mapping.taken': '{name} (von Spalte {n} verwendet)',
    'submit.mapping.proposed':
      'Die Spalten wurden anhand ihrer Überschriften den Indikatoren zugeordnet. Prüfen Sie die Auswahl unten.',
    'submit.mapping.changed':
      'Sie haben die Zuordnung geändert. Prüfen Sie die Datei erneut, um das Ergebnis zu sehen.',
    'submit.mapping.missing': 'Noch zuzuordnen: {list}.',
    'submit.mapping.missing.period': 'der Zeitraum',
    'submit.mapping.check': 'Datei prüfen',

    'submit.check.summary':
      '{insert} neu, {update} zu ändern, {unchanged} unverändert, {reject} abgelehnt.',
    'submit.check.ok': 'Nichts wird abgelehnt. Sie können die Werte speichern.',
    'submit.check.blocked':
      'Solange ein Wert abgelehnt wird, wird nichts gespeichert. Korrigieren Sie die Datei und wählen Sie sie erneut aus.',
    'submit.check.needed': 'Prüfen Sie die Datei, um zu sehen, was gespeichert würde.',
    'submit.commit.submit': 'Werte speichern',
    'submit.commit.done':
      'Gespeichert: {inserted} neu, {updated} geändert, {unchanged} unverändert.',
    'submit.commit.refused':
      'Die Datei wurde abgelehnt und nichts wurde gespeichert. Die Probleme stehen unten.',
    'submit.commit.failed': 'Die Werte konnten nicht gespeichert werden.',

    'submit.verdict.insert': 'wird neu angelegt',
    'submit.verdict.update': 'wird geändert',
    'submit.verdict.unchanged': 'unverändert',
    'submit.verdict.reject': 'kann nicht gespeichert werden',
    'submit.cell.invalid': 'Ungültig: {message}',

    'submit.problems.title': 'Was korrigiert werden muss',
    'submit.problems.file': 'Datei: {message}',
    'submit.problems.row': 'Zeile {row}: {message}',
    'submit.problems.cell': 'Zeile {row}, Spalte {column}: {message}',
    'submit.problems.truncated': 'Es werden nur die ersten {count} Probleme aufgeführt.',

    'submit.error.serviceId':
      'Dieser Dienst hat noch keine KPIs. Wählen Sie auf der Seite des Dienstes ein KPI-Set und versuchen Sie es dann erneut.',
    'submit.error.noValues':
      'Die Datei enthält keine Werte zum Speichern. Tragen Sie Werte ein und laden Sie sie erneut hoch.',
    'submit.error.file': 'Die Datei konnte nicht verwendet werden. Wählen Sie eine andere Datei.',
    'submit.error.adapter': 'Diese Art von Datei wird nicht angenommen.',
    'submit.error.mapping':
      'Die Spaltenzuordnung ist nicht gültig. Prüfen Sie die Auswahl und versuchen Sie es erneut.',
    'submit.error.other':
      'Die Anfrage wurde nicht angenommen. Prüfen Sie die Datei und versuchen Sie es erneut.',
    'submit.error.throttled':
      'Zu viele Anfragen. Warten Sie einen Moment und versuchen Sie es erneut.',

    'submit.history.runs': 'Letzte Meldungen',
    'submit.history.runs.empty': 'Für diesen Dienst wurde noch nichts gemeldet.',
    'submit.history.col.when': 'Wann',
    'submit.history.col.who': 'Wer',
    'submit.history.col.source': 'Weg',
    'submit.history.col.file': 'Datei',
    'submit.history.col.added': 'Neu',
    'submit.history.col.changed': 'Geändert',
    'submit.history.col.unchanged': 'Unverändert',
    'submit.history.col.rejected': 'Abgelehnt',
    'submit.history.col.result': 'Ergebnis',
    'submit.history.status.committed': 'Gespeichert',
    'submit.history.status.rejected': 'Abgelehnt',
    'submit.history.actor.you': 'Sie',
    'submit.history.actor.other': 'Ein Kollege',
    'submit.history.actor.unknown': 'Nicht erfasst',
    'submit.history.coverage': 'Die letzten 12 Monate',
    'submit.history.coverage.col.month': 'Monat',
    'submit.history.coverage.col.reported': 'Werte',
    'submit.history.coverage.col.mandatory': 'Pflicht',
    'submit.history.coverage.col.status': 'Stand',
    'submit.history.coverage.reported': '{reported} von {total}',
    'submit.history.coverage.mandatory': '{reported} von {total}',
    'submit.history.coverage.complete': 'Vollständig',
    'submit.history.coverage.incomplete': 'Pflichtwerte fehlen',
    'submit.history.coverage.empty': 'Keine Monate anzuzeigen.',

    'submit.problem.unknown': 'Die Datei hat ein Problem, für das diese Seite keine Worte hat.',
    'submit.problem.empty-file': 'Die Datei enthält keine Zeilen.',
    'submit.problem.format': 'Die Datei konnte nicht als Tabelle gelesen werden.',
    'submit.problem.encoding':
      'Die Datei ist kein UTF-8-Text. Speichern Sie sie als UTF-8 und laden Sie sie erneut hoch.',
    'submit.problem.not-text': 'Die Datei ist keine Textdatei.',
    'submit.problem.not-a-zip':
      'Die Datei ist keine XLSX-Arbeitsmappe. Sie kann abgeschnitten oder eine andere Art von Datei sein.',
    'submit.problem.encrypted':
      'Die Arbeitsmappe ist passwortgeschützt oder verschlüsselt. Speichern Sie sie ohne Passwort und laden Sie sie erneut hoch.',
    'submit.problem.zip64':
      'Die Arbeitsmappe verwendet ein Archivformat, das hier nicht angenommen wird.',
    'submit.problem.corrupt': 'Die Arbeitsmappe ist beschädigt und kann nicht gelesen werden.',
    'submit.problem.too-many-entries':
      'Die Arbeitsmappe besteht aus zu vielen Teilen für eine normale Tabelle.',
    'submit.problem.declared-too-large':
      'Die Arbeitsmappe ist entpackt zu groß (höchstens 20 MiB).',
    'submit.problem.inflated-too-large':
      'Die Arbeitsmappe ist entpackt zu groß (höchstens 20 MiB).',
    'submit.problem.sheet-not-found': 'Die Arbeitsmappe hat kein solches Blatt.',
    'submit.problem.unterminated-quote': 'Ein Feld in Anführungszeichen ist nicht geschlossen.',
    'submit.problem.quote-in-field':
      'Ein Anführungszeichen steht in einem Feld, das nicht mit einem beginnt.',
    'submit.problem.text-after-quote':
      'Zwischen dem schließenden Anführungszeichen und dem nächsten Trennzeichen steht Text.',
    'submit.problem.field-too-long': 'Ein Feld ist länger als 4000 Zeichen.',
    'submit.problem.too-many-rows': 'Die Datei hat mehr als 5000 Datenzeilen.',
    'submit.problem.too-many-columns': 'Die Datei hat mehr als 200 Spalten.',
    'submit.problem.mapping-invalid':
      'Die Spaltenzuordnung nennt eine Spalte oder einen Indikator, die es nicht gibt, oder verwendet ein Ziel doppelt.',
    'submit.problem.duplicate-column':
      'Zwei Spalten enthalten denselben Indikator oder den Zeitraum. Nur die erste wird verwendet.',
    'submit.problem.missing-column':
      'Eine erforderliche Spalte ist nicht zugeordnet: der Zeitraum oder ein Pflichtindikator.',
    'submit.problem.period-missing': 'Die Zeile hat Werte, aber keinen Zeitraum.',
    'submit.problem.required-value': 'Ein Pflichtindikator hat hier keinen Wert.',
    'submit.problem.cell-type': 'Die Zelle enthält weder Text noch eine Zahl noch ein Datum.',
    'submit.problem.indicator-invalid':
      'Der Indikator gehört nicht zu den Indikatoren dieses Dienstes.',
    'submit.problem.period-invalid':
      'Der Zeitraum ist kein Monat in der Form JJJJ-MM oder JJJJ-MM-TT.',
    'submit.problem.value-invalid': 'Der Wert ist für diesen Indikator nicht gültig.',
    'submit.problem.duplicate-row': 'Derselbe Indikator und Monat kommen in der Datei doppelt vor.',
  },
};
