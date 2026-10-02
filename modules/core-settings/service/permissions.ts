export const PERMISSION_SETTINGS_READ = 'core.settings.read';
export const PERMISSION_SETTINGS_WRITE = 'core.settings.write';
export const PERMISSION_SECRET_WRITE = 'core.settings.secret.write';
export const PERMISSION_PREFERENCE_READ = 'core.settings.preference.read';
export const PERMISSION_PREFERENCE_WRITE = 'core.settings.preference.write';

/** What the role `user` holds from this module: your own preferences. Everything else is Admin's. */
export const USER_PERMISSIONS = [PERMISSION_PREFERENCE_READ, PERMISSION_PREFERENCE_WRITE];
