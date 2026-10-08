// The permissions of the role `user`: every self-service permission of this module. A plain file, so a
// test can read it without loading the manifest. (The token form no longer uses it: it offers what
// `GET /account/permissions` says the caller holds.)
/** What the role `user` holds: every self-service permission of this module (README, "Roles"). */
export const USER_PERMISSIONS = [
  'core.identity.me.read',
  'core.identity.session.manage',
  'core.identity.profile.read',
  'core.identity.profile.update',
  'core.identity.avatar.update',
  'core.identity.password.change',
  'core.identity.email.verify',
  'core.identity.auth-method.link',
  'core.identity.token.read',
  'core.identity.token.manage',
];
