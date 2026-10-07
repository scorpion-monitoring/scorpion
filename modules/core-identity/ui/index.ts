// The browser half of the pages of core.identity. Only the web app imports this file (ADR-0027); the
// server half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two agree.
import type { UiRoute } from '@scorpion/contracts';
import { loadUser, loadPending, loadUsers } from './admin/loaders.ts';
import { loadFirstAdmin, loadLogin, loadProfile } from './loaders.ts';

export { messages } from './messages.ts';

const routes: UiRoute[] = [
  { path: '/login', load: loadLogin, component: () => import('./Login.svelte') },
  { path: '/register', component: () => import('./Register.svelte') },
  { path: '/forgot-password', component: () => import('./ForgotPassword.svelte') },
  { path: '/reset-password', component: () => import('./ResetPassword.svelte') },
  { path: '/verify-email', component: () => import('./VerifyEmail.svelte') },
  { path: '/link-sign-in', component: () => import('./LinkSignIn.svelte') },
  { path: '/setup', load: loadFirstAdmin, component: () => import('./FirstAdmin.svelte') },
  { path: '/profile', load: loadProfile, component: () => import('./Profile.svelte') },
  { path: '/admin/users', load: loadUsers, component: () => import('./admin/Users.svelte') },
  {
    path: '/admin/users/pending',
    load: loadPending,
    component: () => import('./admin/Pending.svelte'),
  },
  {
    path: '/admin/users/:id',
    load: loadUser,
    component: () => import('./admin/UserDetail.svelte'),
  },
];

export default routes;
