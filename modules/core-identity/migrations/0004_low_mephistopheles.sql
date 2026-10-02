CREATE TABLE "identity_mail_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"secret_hash" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "identity_mail_token_purpose_known" CHECK ("identity_mail_token"."purpose" in ('password-reset', 'email-verification')),
	CONSTRAINT "identity_mail_token_verification_has_email" CHECK (("identity_mail_token"."purpose" = 'email-verification') = ("identity_mail_token"."email" is not null))
);
--> statement-breakpoint
ALTER TABLE "identity_mail_token" ADD CONSTRAINT "identity_mail_token_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_mail_token_hash_uidx" ON "identity_mail_token" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "identity_mail_token_user_idx" ON "identity_mail_token" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "identity_mail_token_expires_idx" ON "identity_mail_token" USING btree ("expires_at");