CREATE TABLE "identity_login_throttle" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"last_failure_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "identity_mail_token" DROP CONSTRAINT "identity_mail_token_purpose_known";--> statement-breakpoint
ALTER TABLE "identity_mail_token" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "identity_mail_token" ADD COLUMN "subject" text;--> statement-breakpoint
CREATE INDEX "identity_login_throttle_last_failure_idx" ON "identity_login_throttle" USING btree ("last_failure_at");--> statement-breakpoint
ALTER TABLE "identity_mail_token" ADD CONSTRAINT "identity_mail_token_link_has_identity" CHECK (("identity_mail_token"."purpose" = 'oidc-link') = ("identity_mail_token"."provider" is not null and "identity_mail_token"."subject" is not null));--> statement-breakpoint
ALTER TABLE "identity_mail_token" ADD CONSTRAINT "identity_mail_token_purpose_known" CHECK ("identity_mail_token"."purpose" in ('password-reset', 'email-verification', 'oidc-link'));