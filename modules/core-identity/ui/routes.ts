// The server half of the pages of core.identity: who may open them. Plain data, so the manifest can use
// it without loading Svelte. The browser half (`./index.ts`) lists the same paths with their components,
// and `ui.test.ts` checks that the two agree. Every public page is also listed in `PUBLIC_PAGES` of
// core.ui-shell, which is what makes a page public on purpose.
import type { NavEntry, RouteEntry, WidgetEntry } from '@scorpion/core-ui-shell/public';

export const IDENTITY_ROUTES: RouteEntry[] = [
  {
    path: '/login',
    public: true,
    publicReason:
      'Signing in is what makes a visitor known. The page only calls the sign-in routes, which are rate limited and throttled.',
  },
  {
    path: '/register',
    public: true,
    publicReason:
      'Anyone may ask for an account; it waits for approval. The page says the same for a new and a taken address.',
  },
  {
    path: '/forgot-password',
    public: true,
    publicReason:
      'Someone who forgot their password has no session. The answer is the same for every address.',
  },
  {
    path: '/reset-password',
    public: true,
    publicReason:
      'The link in the mail is the credential and its token is in the address fragment, which the server never sees; the person has no session.',
  },
  {
    path: '/verify-email',
    public: true,
    publicReason:
      'The link in the mail is the credential; it may be opened on another device than the one signed in.',
  },
  {
    path: '/link-sign-in',
    public: true,
    publicReason:
      'The mailed link is opened before the person is signed in and its token is in the address fragment, which only the browser sees, so the page asks for the sign-in itself. Confirming needs a session and a recent authentication.',
  },
  {
    path: '/setup',
    public: true,
    publicReason:
      'The first administrator of a fresh install has no account yet; the page exists only while there is no administrator (it is a 404 afterwards) and the single-use token from the server console is the credential.',
  },
  { path: '/profile', permission: 'core.identity.profile.read' },
  // Administration of users (M5 sprint 3). A page needs the permission of the routes it calls first.
  { path: '/admin/users', permission: 'core.identity.user.read' },
  { path: '/admin/users/pending', permission: 'core.identity.user.list-pending' },
  { path: '/admin/users/:id', permission: 'core.identity.user.read' },
];

export const IDENTITY_NAV: NavEntry[] = [
  {
    id: 'account.profile',
    label: 'nav.profile',
    path: '/profile',
    icon: 'user',
    section: 'account',
    order: 10,
    permission: 'core.identity.profile.read',
  },
  // The administration section is contributed by the modules themselves, never listed in the shell. An entry
  // shows only for a caller who holds its permission, so a plain User's navigation holds none of it.
  {
    id: 'admin.users',
    label: 'nav.admin.users',
    path: '/admin/users',
    icon: 'users',
    section: 'admin',
    order: 10,
    permission: 'core.identity.user.read',
  },
  {
    id: 'admin.users.pending',
    label: 'nav.admin.pending',
    path: '/admin/users/pending',
    icon: 'list',
    section: 'admin',
    order: 20,
    permission: 'core.identity.user.list-pending',
  },
];

export const IDENTITY_WIDGETS: WidgetEntry[] = [
  {
    id: 'identity.pending-approvals',
    slot: 'dashboard',
    component: 'pending-approvals',
    order: 10,
    permission: 'core.identity.user.list-pending',
  },
];
