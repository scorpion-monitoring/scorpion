CREATE TABLE "identity_auth_method" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "identity_auth_method_provider_format" CHECK ("identity_auth_method"."provider" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "identity_auth_method_password_only_local" CHECK (("identity_auth_method"."provider" = 'local') = ("identity_auth_method"."password_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "identity_login_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_token_prefix_format" CHECK ("identity_token"."prefix" ~ '^[A-Za-z0-9]{8}$')
);
--> statement-breakpoint
CREATE TABLE "identity_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"avatar_blob_id" uuid,
	"is_bootstrap_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_user_username_format" CHECK ("identity_user"."username" ~ '^[a-z0-9_-]{3,31}$'),
	CONSTRAINT "identity_user_status_known" CHECK ("identity_user"."status" in ('pending', 'active', 'rejected')),
	CONSTRAINT "identity_user_verified_has_email" CHECK ("identity_user"."email_verified_at" is null or "identity_user"."email" is not null)
);
--> statement-breakpoint
ALTER TABLE "identity_auth_method" ADD CONSTRAINT "identity_auth_method_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_session" ADD CONSTRAINT "identity_session_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_token" ADD CONSTRAINT "identity_token_user_id_identity_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."identity_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_auth_method_provider_subject_uidx" ON "identity_auth_method" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_auth_method_local_user_uidx" ON "identity_auth_method" USING btree ("user_id") WHERE "identity_auth_method"."provider" = 'local';--> statement-breakpoint
CREATE INDEX "identity_auth_method_user_idx" ON "identity_auth_method" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_login_state_hash_uidx" ON "identity_login_state" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "identity_login_state_expires_idx" ON "identity_login_state" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_session_secret_hash_uidx" ON "identity_session" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "identity_session_user_idx" ON "identity_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identity_session_expires_idx" ON "identity_session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_token_prefix_uidx" ON "identity_token" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_token_user_name_uidx" ON "identity_token" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "identity_token_expires_idx" ON "identity_token" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_user_username_uidx" ON "identity_user" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_user_email_verified_uidx" ON "identity_user" USING btree (lower("email")) WHERE "identity_user"."email" is not null and "identity_user"."email_verified_at" is not null;--> statement-breakpoint
CREATE INDEX "identity_user_email_idx" ON "identity_user" USING btree (lower("email"));