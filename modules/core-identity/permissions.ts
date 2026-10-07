// The permissions of the role `user`: every self-service permission of this module. A plain file, so the
// browser half of the module can offer them as the scopes of an access token without loading the manifest.
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
