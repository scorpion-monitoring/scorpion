import type { UiMessages } from '@scorpion/contracts';

export const messages: UiMessages = {
  en: {
    'nav.home': 'Home',
    'nav.docs': 'API documentation',
    'nav.section.main': 'Main',
    'home.lead': 'The service registry and KPI tracker of {name}.',
    'home.signedIn': 'You are signed in as {name}.',
    'legal.terms': 'Terms of use',
    'legal.privacy': 'Privacy policy',
    'legal.imprint': 'Imprint',
    'legal.imprintExternal': 'Imprint',
    'docs.title': 'API documentation',
    'docs.lead':
      'The public API is versioned and stays compatible within a version. Every list answers with the same envelope: a metadata block and a result list, with pages counted from 0.',
    'docs.empty': 'The public API of this instance has no routes yet.',
    'docs.method': 'Method',
    'docs.path': 'Path',
    'docs.summary': 'Summary',
    'docs.access': 'Access',
    'docs.public': 'Public',
  },
};
