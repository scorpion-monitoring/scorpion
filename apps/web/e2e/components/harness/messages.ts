import type { MessageBundles } from '@scorpion/ui-kit';

// The scenes write their own English text; only the components' texts are translated. The count line of the
// facet-search scene is the one text a scene hands to a component by key.
export const harnessMessages: MessageBundles = {
  en: {
    'harness.matches.one': '1 service matches',
    'harness.matches.other': '{count} services match',
    'harness.matches.none': 'No services match',
    'harness.matches.noName': 'No services match the name',
  },
  de: {
    'harness.matches.one': '1 Dienst passt',
    'harness.matches.other': '{count} Dienste passen',
    'harness.matches.none': 'Kein Dienst passt',
    'harness.matches.noName': 'Kein Dienstname passt',
  },
};
