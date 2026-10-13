CREATE TABLE "svc_field_value" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "svc_field_value_key_check" CHECK (char_length("svc_field_value"."field_key") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "svc_license_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"licenses" jsonb NOT NULL,
	"release_version" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "svc_service" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"license" text,
	"stage" text NOT NULL,
	"description" text,
	"url" text,
	"same_as" text[] DEFAULT '{}'::text[] NOT NULL,
	"contact_email" text,
	"contact_type" text,
	"icon_blob_id" uuid,
	"icon_hash" text,
	"public" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "svc_service_slug_check" CHECK (char_length("svc_service"."slug") between 1 and 64 and "svc_service"."slug" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
	CONSTRAINT "svc_service_name_check" CHECK (char_length("svc_service"."name") between 1 and 200),
	CONSTRAINT "svc_service_description_check" CHECK ("svc_service"."description" is null or char_length("svc_service"."description") <= 4000),
	CONSTRAINT "svc_service_url_check" CHECK ("svc_service"."url" is null or (char_length("svc_service"."url") <= 500 and "svc_service"."url" ~* '^https?://')),
	CONSTRAINT "svc_service_same_as_check" CHECK (cardinality("svc_service"."same_as") <= 20),
	CONSTRAINT "svc_service_contact_check" CHECK (("svc_service"."contact_email" is null) = ("svc_service"."contact_type" is null)
        and ("svc_service"."contact_email" is null or char_length("svc_service"."contact_email") <= 254)
        and ("svc_service"."contact_type" is null or char_length("svc_service"."contact_type") between 1 and 64)),
	CONSTRAINT "svc_service_icon_check" CHECK (("svc_service"."icon_blob_id" is null) = ("svc_service"."icon_hash" is null)),
	CONSTRAINT "svc_service_published_check" CHECK ("svc_service"."public" = ("svc_service"."published_at" is not null)
        and ("svc_service"."published_at" is null) = ("svc_service"."published_by" is null))
);
--> statement-breakpoint
CREATE TABLE "svc_service_organisation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "svc_service_organisation_role_check" CHECK (char_length("svc_service_organisation"."role") between 1 and 32)
);
--> statement-breakpoint
CREATE TABLE "svc_slug_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "svc_field_value" ADD CONSTRAINT "svc_field_value_service_id_svc_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."svc_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_service_organisation" ADD CONSTRAINT "svc_service_organisation_service_id_svc_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."svc_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svc_slug_history" ADD CONSTRAINT "svc_slug_history_service_id_svc_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."svc_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "svc_field_value_key" ON "svc_field_value" USING btree ("service_id","field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_service_slug_idx" ON "svc_service" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "svc_service_name_idx" ON "svc_service" USING btree (lower("name"),"id");--> statement-breakpoint
CREATE INDEX "svc_service_stage_idx" ON "svc_service" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "svc_service_license_idx" ON "svc_service" USING btree ("license");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_service_organisation_key" ON "svc_service_organisation" USING btree ("service_id","organisation_id","role");--> statement-breakpoint
CREATE INDEX "svc_service_organisation_organisation_idx" ON "svc_service_organisation" USING btree ("organisation_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_slug_history_slug_idx" ON "svc_slug_history" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "svc_slug_history_service_idx" ON "svc_slug_history" USING btree ("service_id");