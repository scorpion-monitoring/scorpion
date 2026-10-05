-- M3 (ADR-0006, ADR-0014 "The bootstrap exception"): the temporary marker becomes a role assignment.
-- This is the ONE place in the repository that touches a table of another module (rule 3 of
-- CLAUDE.md): it runs after core.authz's migrations because core.identity depends on core.authz.
-- The migration of a module runs in one transaction, so the copy and the drop commit together.
--
-- core.authz seeds the Admin role row when its service starts, which is after the migrations, so
-- the row is created here when it is missing (same key, label and flag as the seed, which is
-- idempotent and finds it). With no marked user nothing is inserted and the instance stays as it
-- was: `scorpion create-admin` and the first-run token still work. The ids are UUIDv7, as in the
-- service (48-bit millisecond timestamp, version nibble 7).
INSERT INTO "authz_role" ("id", "key", "label", "system")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid, 'admin', 'Admin', true
WHERE EXISTS (SELECT 1 FROM "identity_user" WHERE "is_bootstrap_admin")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "authz_role_assignment" ("id", "user_id", "role_id", "assigned_by")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid, u."id", r."id", NULL
FROM "identity_user" u
CROSS JOIN "authz_role" r
WHERE u."is_bootstrap_admin" AND r."key" = 'admin'
ON CONFLICT ("user_id", "role_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "identity_user" DROP COLUMN "is_bootstrap_admin";
