CREATE TABLE "settings_vocabulary" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings_vocabulary_term" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vocabulary_id" text NOT NULL,
	"key" text NOT NULL,
	"labels" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings_vocabulary_term" ADD CONSTRAINT "settings_vocabulary_term_vocabulary_id_settings_vocabulary_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."settings_vocabulary"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settings_vocabulary_term_key_uidx" ON "settings_vocabulary_term" USING btree ("vocabulary_id","key");