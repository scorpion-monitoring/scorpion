-- Nothing has written a login state before this migration (the OIDC flow arrives with it), and a
-- state lives 10 minutes, so dropping the rows makes the NOT NULL columns safe.
DELETE FROM "identity_login_state";--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD COLUMN "nonce_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD COLUMN "binding_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD COLUMN "link_user_id" uuid;--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD CONSTRAINT "identity_login_state_link_user_id_identity_user_id_fk" FOREIGN KEY ("link_user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;