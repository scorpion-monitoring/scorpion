# ADR-0053: Migrated accounts are claimed at the owner's first sign-in

- Status: Accepted (M13, after sprint 2)
- Date: 2026-11-18
- Amends: [ADR-0026](0026-credential-rules-throttling-and-mail-confirmed-linking.md) (one exception to "an address links
  nothing"), [ADR-0052](0052-legacy-migration-snapshot-and-actor.md) (the natural key of a user), decisions 4 and 12 of
  the [M13 plan](../m13-sprint-plan.md) §13

## Context

Sprint 2 migrated a legacy user only with their OIDC subject, read once outside the legacy API into a subjects file
(decision 12): `GET /aai/users` returns no subject, so the operator had to query Neo4j or Keycloak by hand and keep one more
file of personal data. A user without a line in that file was not migrated. The maintainer asked for a migration that
needs no such file and in which nobody has to register again.

The legacy data does hold what the provider sends at a sign-in: the address (which the legacy application took from the
provider) and the username (the legacy username is the provider's `preferred_username`, decision 12's answer). So the
identity can be attached at the first sign-in instead of at the migration. ADR-0026 forbids exactly that in general (ASVS
6.8.1): a provider's word for an address is not enough to enter the account that holds it, and the mail confirmation it
offers instead needs a session of that account, which a migrated account without a way to sign in can never have.

## Decision

1. **A claimable account.** `UserService.createClaimableAsSystem` (trusted, no route) creates an active account with no way
   to sign in, an unverified address and a row in `identity_account_claim`: the provider id, the `preferred_username` that
   provider must send (lower-cased), and an end (`claimDays` of the mapping, default 90 days).
2. **The claim.** A sign-in at a provider with a subject no account knows, whose verified address an account holds, claims
   that account when **every** one of these holds; otherwise it takes the mail path of ADR-0026 as before:
   - the provider is the claim's (another listed provider cannot claim it; ASVS 6.8.1);
   - the provider sent `email_verified: true` and the same address (without case);
   - the provider's `preferred_username` equals the claim's (without case);
   - the claim has not expired;
   - the account is active, not deleted, and has no way to sign in at all (nobody has ever entered it).

   The identity is added (`identity.authMethod.linked@1` with `via: 'claim'`), the address marked verified and the claim
   deleted in one transaction that locks the claim, so two sign-ins claim once; then the person is signed in. Afterwards the
   account is an ordinary one, found by `(provider, sub)`.

3. **Nobody gets Admin from the migration.** Every migrated account gets the role `user`. A legacy administrator is reported
   (`user.admin-by-hand`, and a column of `migrate-legacy users`); an administrator of the instance (the one `create-admin`
   made) grants Admin by hand after the claim. This replaces decision 4 ("admin from `is_admin`") and makes a wrong claim
   reach at most a user's account, never an administrator's.
4. **The tool.** No subjects file. A user is found by their address (the natural key); the account is the migration's when
   it holds the claim that user would get, or, once claimed, has the username the migration gave it. An address another
   account holds is reported, as before. The provider need not be configured when the tool runs: claims wait until it is.
   `findByIdentityAsSystem` (sprint 2) is removed; nothing else called it.

## Consequences

- **What the claim trusts.** For these accounts only, and once each, the configured provider's word for the address and the
  username. Whoever holds an identity at that provider with the owner's verified address **and** the legacy username before
  the owner signs in gets the account, with the role `user` and the owner's provider memberships. With LS Login as the one
  provider, that is the trust the legacy application placed in it for every sign-in. The 90 days bound the window; the
  migration's announcement mail asks people to sign in soon.
- **When it does not match.** An owner whose provider sends another address or username gets the mail of ADR-0026, which
  cannot help an account without a way to sign in; an administrator has to resolve it (backlog: an administrator view of the
  open claims and a way to attach an identity). An expired claim is left in place and never matches.
- **No new route, no new page.** The claim happens inside the existing callback. The answer to a browser is unchanged in
  every case that does not claim, so the callback still tells nothing about the accounts.
- **ASVS.** 6.8.1 and 10.5.2 name the exception and its tests (`service/account-claim.test.ts`).
