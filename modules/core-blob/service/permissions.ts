/** The service method `put`: what a module that offers an upload route (the avatar) needs its callers to hold. */
export const PERMISSION_UPLOAD = 'core.blob.upload';
/** The generic upload route (`POST /files`): logos and other files an administrator manages. */
export const PERMISSION_MANAGE = 'core.blob.manage';

/** What the role `user` holds from this module: to upload through routes that other modules own. */
export const USER_PERMISSIONS = [PERMISSION_UPLOAD];
