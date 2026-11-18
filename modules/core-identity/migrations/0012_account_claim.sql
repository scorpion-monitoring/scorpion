CREATE TABLE "identity_account_claim" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_account_claim_provider_format" CHECK ("identity_account_claim"."provider" ~ '^[a-z][a-z0-9-]{0,62}$' and "identity_account_claim"."provider" <> 'local'),
	CONSTRAINT "identity_account_claim_username_lower" CHECK ("identity_account_claim"."username" = lower("identity_account_claim"."username"))
);
--> statement-breakpoint
ALTER TABLE "identity_account_claim" ADD CONSTRAINT "identity_account_claim_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_account_claim_expires_idx" ON "identity_account_claim" USING btree ("expires_at");