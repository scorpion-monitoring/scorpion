ALTER TABLE "identity_login_failure" ADD COLUMN "context" text DEFAULT 'sign-in' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_login_failure" DROP CONSTRAINT "identity_login_failure_key_hash_window_start_pk";--> statement-breakpoint
ALTER TABLE "identity_login_failure" ADD CONSTRAINT "identity_login_failure_key_hash_window_start_context_pk" PRIMARY KEY("key_hash","window_start","context");
