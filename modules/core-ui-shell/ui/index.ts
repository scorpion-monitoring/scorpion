// The browser half of the shell's own pages. Only the web app imports this file (ADR-0027); the server
// half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two agree.
import type { UiRoute } from '@scorpion/contracts';
import {
  loadBranding,
  loadRoles,
  loadSecrets,
  loadSettingsIndex,
  loadSettingsModule,
  loadVocabularies,
} from './admin/loaders.ts';
import { loadDocs } from './docs.ts';
import { loadLegal } from './legal.ts';

export { messages } from './messages.ts';

const routes: UiRoute[] = [
  { path: '/', component: () => import('./Home.svelte') },
  { path: '/legal/:page', load: loadLegal, component: () => import('./Legal.svelte') },
  { path: '/docs', load: loadDocs, component: () => import('./Docs.svelte') },
  { path: '/admin/roles', load: loadRoles, component: () => import('./admin/Roles.svelte') },
  {
    path: '/admin/settings',
    load: loadSettingsIndex,
    component: () => import('./admin/SettingsIndex.svelte'),
  },
  {
    path: '/admin/settings/branding',
    load: loadBranding,
    component: () => import('./admin/Branding.svelte'),
  },
  {
    path: '/admin/settings/secrets',
    load: loadSecrets,
    component: () => import('./admin/Secrets.svelte'),
  },
  {
    path: '/admin/settings/vocabularies',
    load: loadVocabularies,
    component: () => import('./admin/Vocabularies.svelte'),
  },
  {
    path: '/admin/settings/:module',
    load: loadSettingsModule,
    component: () => import('./admin/SettingsModule.svelte'),
  },
];

export default routes;
