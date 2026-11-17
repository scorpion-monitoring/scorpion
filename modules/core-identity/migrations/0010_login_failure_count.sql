CREATE TABLE "identity_login_failure" (
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_seconds" integer NOT NULL,
	"failures" integer NOT NULL,
	"user_id" uuid,
	CONSTRAINT "identity_login_failure_key_hash_window_start_pk" PRIMARY KEY("key_hash","window_start"),
	CONSTRAINT "identity_login_failure_count_positive" CHECK ("identity_login_failure"."failures" >= 1),
	CONSTRAINT "identity_login_failure_window_positive" CHECK ("identity_login_failure"."window_seconds" >= 1)
);
--> statement-breakpoint
CREATE INDEX "identity_login_failure_window_start_idx" ON "identity_login_failure" USING btree ("window_start");