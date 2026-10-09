CREATE TABLE "org_organisation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"abbreviation" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"website" text,
	"ror_id" text,
	"same_as" text[] DEFAULT '{}'::text[] NOT NULL,
	"contact_email" text,
	"contact_type" text,
	"logo_blob_id" uuid,
	"logo_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "org_organisation_abbreviation_check" CHECK (char_length("org_organisation"."abbreviation") between 1 and 64 and "org_organisation"."abbreviation" !~ '[[:space:]/]'),
	CONSTRAINT "org_organisation_name_check" CHECK (char_length("org_organisation"."name") between 1 and 200),
	CONSTRAINT "org_organisation_description_check" CHECK ("org_organisation"."description" is null or char_length("org_organisation"."description") <= 4000),
	CONSTRAINT "org_organisation_website_check" CHECK ("org_organisation"."website" is null or (char_length("org_organisation"."website") <= 500 and "org_organisation"."website" ~* '^https?://')),
	CONSTRAINT "org_organisation_ror_id_check" CHECK ("org_organisation"."ror_id" is null or "org_organisation"."ror_id" ~ '^0[a-hj-km-np-tv-z0-9]{6}[0-9]{2}$'),
	CONSTRAINT "org_organisation_same_as_check" CHECK (cardinality("org_organisation"."same_as") <= 20),
	CONSTRAINT "org_organisation_contact_check" CHECK (("org_organisation"."contact_email" is null) = ("org_organisation"."contact_type" is null)
        and ("org_organisation"."contact_email" is null or char_length("org_organisation"."contact_email") <= 254)
        and ("org_organisation"."contact_type" is null or char_length("org_organisation"."contact_type") between 1 and 64)),
	CONSTRAINT "org_organisation_logo_check" CHECK (("org_organisation"."logo_blob_id" is null) = ("org_organisation"."logo_hash" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_organisation_type_abbreviation_idx" ON "org_organisation" USING btree ("type",lower("abbreviation"));--> statement-breakpoint
CREATE UNIQUE INDEX "org_organisation_type_name_idx" ON "org_organisation" USING btree ("type",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "org_organisation_ror_id_idx" ON "org_organisation" USING btree ("ror_id") WHERE "org_organisation"."ror_id" is not null;--> statement-breakpoint
CREATE INDEX "org_organisation_sort_idx" ON "org_organisation" USING btree (lower("abbreviation"),"id");--> statement-breakpoint
CREATE INDEX "org_organisation_name_idx" ON "org_organisation" USING btree (lower("name"));