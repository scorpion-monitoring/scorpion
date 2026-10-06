ALTER TABLE "identity_login_state" ADD COLUMN "purpose" text DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD COLUMN "reauth_session_id" uuid;--> statement-breakpoint
-- ADR-0025. Existing sessions get an absolute end at their creation plus the default of 30 days (a
-- session older than that ends at its next use), and count as authenticated when they were created.
ALTER TABLE "identity_session" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity_session" ADD COLUMN "authenticated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "identity_session" SET "absolute_expires_at" = "created_at" + interval '30 days', "authenticated_at" = "created_at";--> statement-breakpoint
ALTER TABLE "identity_session" ALTER COLUMN "absolute_expires_at" SET NOT NULL;--> statement-breakpoint
-- A login in progress that was started to link a provider keeps that meaning.
UPDATE "identity_login_state" SET "purpose" = 'link' WHERE "link_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD CONSTRAINT "identity_login_state_reauth_session_id_identity_session_id_fk" FOREIGN KEY ("reauth_session_id") REFERENCES "public"."identity_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD CONSTRAINT "identity_login_state_purpose_known" CHECK ("identity_login_state"."purpose" in ('login', 'link', 'reauth'));--> statement-breakpoint
ALTER TABLE "identity_login_state" ADD CONSTRAINT "identity_login_state_purpose_fields" CHECK (("identity_login_state"."purpose" = 'login' and "identity_login_state"."link_user_id" is null and "identity_login_state"."reauth_session_id" is null)
        or ("identity_login_state"."purpose" = 'link' and "identity_login_state"."link_user_id" is not null and "identity_login_state"."reauth_session_id" is null)
        or ("identity_login_state"."purpose" = 'reauth' and "identity_login_state"."link_user_id" is not null and "identity_login_state"."reauth_session_id" is not null));