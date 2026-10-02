CREATE TABLE "settings_secret" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "settings_setting" (
	"module_id" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings_user_preference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "settings_secret_name_uidx" ON "settings_secret" USING btree ("name");--> statement-breakpoint
CREATE INDEX "settings_secret_key_idx" ON "settings_secret" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_user_preference_user_key_uidx" ON "settings_user_preference" USING btree ("user_id","key");