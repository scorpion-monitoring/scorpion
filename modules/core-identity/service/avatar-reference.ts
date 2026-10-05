/** The reference that keeps a user's avatar in the blob store (`core.blob`): one file per user. */
export const avatarReference = (userId: string): string => `core.identity:avatar:${userId}`;
