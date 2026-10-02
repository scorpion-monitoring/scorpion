CREATE TABLE "identity_first_run_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_first_run_token_hash_uidx" ON "identity_first_run_token" USING btree ("secret_hash");