---
'scorpion': minor
---

The legacy migration no longer needs a file of OIDC subjects. `pnpm migrate-legacy run` creates each legacy user as an account that its owner claims at their first sign-in at the configured provider: when the provider sends the same verified address and the legacy username as `preferred_username`, the sign-in is linked to the account and the person keeps their memberships, without registering again. A claim is open for 90 days (`claimDays` in the mapping). Every migrated user gets the role `user`; legacy administrators are listed by `pnpm migrate-legacy users` (which now also shows whether each account was claimed) so an administrator can grant Admin by hand. Run `scorpion create-admin` before the migration. The `--subjects` option is gone. Nothing changes for instances that do not run the migration; a sign-in whose address belongs to an existing account still links nothing without the mailed confirmation.
