import type { UiMessages } from '@scorpion/contracts';

// The texts of the widgets of kpi.analytics. The names of units, KPIs and thematic categories are the data's own and never come from here; no text
// names a role or the instance. A text that depends on a number has one key per plural form (`.one`, `.other`).
export const messages: UiMessages = {
  en: {
    'analytics.cards.title': 'KPI cards',
    'analytics.cards.about':
      'The latest value of each KPI of a service with its change, and a small chart of the months.',
    'analytics.cards.count.one': '{count} KPI',
    'analytics.cards.count.other': '{count} KPIs',
    'analytics.cards.noValue': 'No value in this range.',

    'analytics.trends.title': 'Trends',
    'analytics.trends.about':
      'One line per KPI of a service over a range, with a running total, hiding and a second axis for each.',
    'analytics.trends.chart': 'Trends of the KPIs of the service, month by month',
    'analytics.trends.noNumbers': 'None of the KPIs in this range has a number to draw.',
    'analytics.trends.allHidden': 'Every KPI is hidden. Show one in the series options below.',
    'analytics.trends.controls': 'Series options',
    'analytics.trends.controls.caption': 'Which KPIs the chart shows, and how',
    'analytics.trends.show': 'Show',
    'analytics.trends.cumulative': 'Running total',
    'analytics.trends.secondary': 'Second axis',
    'analytics.trends.show.named': 'Show {name}',
    'analytics.trends.cumulative.named': 'Running total of {name}',
    'analytics.trends.secondary.named': 'Second axis for {name}',
    'analytics.trends.full': 'A chart keeps at most {count} options. Switch one off first.',

    'analytics.averages.title': 'Averages',
    'analytics.averages.about': 'The average of each KPI of a service over a range, as a list.',
    'analytics.averages.caption': 'The average of each KPI over the range',

    'analytics.volatility.title': 'Volatility',
    'analytics.volatility.about':
      'Volatility says how far the monthly values of a KPI stray from their own average: the mean of the differences, as a share of that average. A bar is low, medium or high by two limits that an administrator sets. A KPI with fewer than two values has none.',
    'analytics.volatility.whatIs': 'What is volatility?',
    'analytics.volatility.bar': '{name}: volatility {value}, {band}',

    'analytics.actions.title': 'Quick actions',
    'analytics.actions.about':
      'Links to report data, to the services and to your notification settings, and your dashboard defaults.',
    'analytics.actions.report': 'Report data',
    'analytics.actions.services': 'Services',
    'analytics.actions.notifications': 'Notification preferences',
    'analytics.actions.defaults': 'Dashboard defaults',

    'analytics.state.loading': 'Loading…',
    'analytics.state.chooseService': 'Choose a service.',
    'analytics.state.chooseService.how':
      'Customise the dashboard, then open the settings of this widget.',
    'analytics.state.failed': 'The numbers could not be loaded.',
    'analytics.state.retry': 'Try again',
    'analytics.state.badSettings':
      'The settings of this widget are no longer valid. Customise the dashboard and open its settings to choose again.',
    'analytics.state.noKpis': 'This service has no KPIs.',
    'analytics.state.noValues': 'No values for this range.',
    'analytics.state.more':
      'Showing the first {shown} of {total} KPIs. Choose a category to see others.',
    'analytics.state.defaultsFailed': 'Your dashboard defaults could not be loaded.',

    'analytics.change.up': 'up',
    'analytics.change.down': 'down',
    'analytics.change.flat': 'unchanged',
    'analytics.change.none': 'change n/a',

    'analytics.band.low': 'low',
    'analytics.band.medium': 'medium',
    'analytics.band.high': 'high',
    'analytics.band.none': 'n/a',

    'analytics.na': 'n/a',
    'analytics.col.kpi': 'KPI',
    'analytics.col.average': 'Average',
    'analytics.spark.alt': '{name}: {count} values, from {first} to {last}',
  },
  de: {
    'analytics.cards.title': 'KPI-Karten',
    'analytics.cards.about':
      'Der letzte Wert jedes KPI eines Dienstes mit seiner Veränderung und ein kleines Diagramm der Monate.',
    'analytics.cards.count.one': '{count} KPI',
    'analytics.cards.count.other': '{count} KPIs',
    'analytics.cards.noValue': 'Kein Wert in diesem Zeitraum.',

    'analytics.trends.title': 'Trends',
    'analytics.trends.about':
      'Eine Linie je KPI eines Dienstes über einen Zeitraum, mit laufender Summe, Ausblenden und zweiter Achse für jede.',
    'analytics.trends.chart': 'Trends der KPIs des Dienstes, Monat für Monat',
    'analytics.trends.noNumbers': 'Keiner der KPIs hat in diesem Zeitraum eine Zahl zum Zeichnen.',
    'analytics.trends.allHidden':
      'Alle KPIs sind ausgeblendet. Blenden Sie unten in den Reihenoptionen einen ein.',
    'analytics.trends.controls': 'Reihenoptionen',
    'analytics.trends.controls.caption': 'Welche KPIs das Diagramm zeigt und wie',
    'analytics.trends.show': 'Anzeigen',
    'analytics.trends.cumulative': 'Laufende Summe',
    'analytics.trends.secondary': 'Zweite Achse',
    'analytics.trends.show.named': '{name} anzeigen',
    'analytics.trends.cumulative.named': 'Laufende Summe von {name}',
    'analytics.trends.secondary.named': 'Zweite Achse für {name}',
    'analytics.trends.full':
      'Ein Diagramm merkt sich höchstens {count} Optionen. Schalten Sie zuerst eine aus.',

    'analytics.averages.title': 'Durchschnitte',
    'analytics.averages.about':
      'Der Durchschnitt jedes KPI eines Dienstes über einen Zeitraum, als Liste.',
    'analytics.averages.caption': 'Der Durchschnitt jedes KPI über den Zeitraum',

    'analytics.volatility.title': 'Volatilität',
    'analytics.volatility.about':
      'Die Volatilität sagt, wie weit die Monatswerte eines KPI von ihrem eigenen Durchschnitt abweichen: der Mittelwert der Abweichungen, als Anteil dieses Durchschnitts. Ein Balken ist niedrig, mittel oder hoch nach zwei Grenzen, die eine Administratorin oder ein Administrator festlegt. Ein KPI mit weniger als zwei Werten hat keine.',
    'analytics.volatility.whatIs': 'Was ist Volatilität?',
    'analytics.volatility.bar': '{name}: Volatilität {value}, {band}',

    'analytics.actions.title': 'Schnellzugriffe',
    'analytics.actions.about':
      'Links zum Melden von Daten, zu den Diensten und zu Ihren Benachrichtigungseinstellungen sowie Ihre Dashboard-Voreinstellungen.',
    'analytics.actions.report': 'Daten melden',
    'analytics.actions.services': 'Dienste',
    'analytics.actions.notifications': 'Benachrichtigungseinstellungen',
    'analytics.actions.defaults': 'Dashboard-Voreinstellungen',

    'analytics.state.loading': 'Wird geladen …',
    'analytics.state.chooseService': 'Wählen Sie einen Dienst.',
    'analytics.state.chooseService.how':
      'Passen Sie das Dashboard an und öffnen Sie dann die Einstellungen dieses Widgets.',
    'analytics.state.failed': 'Die Zahlen konnten nicht geladen werden.',
    'analytics.state.retry': 'Erneut versuchen',
    'analytics.state.badSettings':
      'Die Einstellungen dieses Widgets sind nicht mehr gültig. Passen Sie das Dashboard an und öffnen Sie die Einstellungen, um neu zu wählen.',
    'analytics.state.noKpis': 'Dieser Dienst hat keine KPIs.',
    'analytics.state.noValues': 'Keine Werte für diesen Zeitraum.',
    'analytics.state.more':
      'Die ersten {shown} von {total} KPIs werden angezeigt. Wählen Sie eine Kategorie, um andere zu sehen.',
    'analytics.state.defaultsFailed':
      'Ihre Dashboard-Voreinstellungen konnten nicht geladen werden.',

    'analytics.change.up': 'gestiegen',
    'analytics.change.down': 'gesunken',
    'analytics.change.flat': 'unverändert',
    'analytics.change.none': 'Veränderung n. v.',

    'analytics.band.low': 'niedrig',
    'analytics.band.medium': 'mittel',
    'analytics.band.high': 'hoch',
    'analytics.band.none': 'n. v.',

    'analytics.na': 'n. v.',
    'analytics.col.kpi': 'KPI',
    'analytics.col.average': 'Durchschnitt',
    'analytics.spark.alt': '{name}: {count} Werte, von {first} bis {last}',
  },
};
