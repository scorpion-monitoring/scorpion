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
  },
};
