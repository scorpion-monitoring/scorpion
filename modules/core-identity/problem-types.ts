// Stable problem types (RFC 9457) of the refusals that a screen has to tell apart from another answer
// with the same status. The sign-in page shows the pending-approval page for the first and says that
// password sign-in is off for the second; both are a 403. Plain constants, so the browser half of the
// module can import them without the services.
/** The right password, but an administrator has not approved the account yet. */
export const ACCOUNT_PENDING = 'account-pending';
/** The instance does not take passwords (the setting `localAccounts` is off). */
export const LOCAL_ACCOUNTS_OFF = 'local-accounts-disabled';
