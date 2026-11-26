CREATE TABLE "biblio_doi_metadata" (
	"doi" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"title" text,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issued" date,
	"issued_precision" text,
	"container" text,
	"type" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biblio_doi_metadata_doi_check" CHECK (char_length("biblio_doi_metadata"."doi") between 4 and 256 and "biblio_doi_metadata"."doi" = lower("biblio_doi_metadata"."doi")),
	CONSTRAINT "biblio_doi_metadata_status_check" CHECK ("biblio_doi_metadata"."status" in ('ok', 'not-found', 'failed')),
	CONSTRAINT "biblio_doi_metadata_title_check" CHECK (("biblio_doi_metadata"."status" = 'ok') = ("biblio_doi_metadata"."title" is not null) and ("biblio_doi_metadata"."title" is null or char_length("biblio_doi_metadata"."title") between 1 and 1000)),
	CONSTRAINT "biblio_doi_metadata_reason_check" CHECK (("biblio_doi_metadata"."status" = 'failed') = ("biblio_doi_metadata"."reason" is not null) and ("biblio_doi_metadata"."reason" is null or char_length("biblio_doi_metadata"."reason") between 1 and 64)),
	CONSTRAINT "biblio_doi_metadata_authors_check" CHECK (jsonb_typeof("biblio_doi_metadata"."authors") = 'array' and jsonb_array_length("biblio_doi_metadata"."authors") <= 100),
	CONSTRAINT "biblio_doi_metadata_issued_check" CHECK (("biblio_doi_metadata"."issued" is null) = ("biblio_doi_metadata"."issued_precision" is null) and ("biblio_doi_metadata"."issued_precision" is null or "biblio_doi_metadata"."issued_precision" in ('year', 'month', 'day'))),
	CONSTRAINT "biblio_doi_metadata_container_check" CHECK ("biblio_doi_metadata"."container" is null or char_length("biblio_doi_metadata"."container") between 1 and 500),
	CONSTRAINT "biblio_doi_metadata_type_check" CHECK ("biblio_doi_metadata"."type" is null or char_length("biblio_doi_metadata"."type") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "biblio_publication" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"doi" text NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biblio_publication_doi_check" CHECK (char_length("biblio_publication"."doi") between 4 and 256 and "biblio_publication"."doi" = lower("biblio_publication"."doi") and "biblio_publication"."doi" like '10.%/%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "biblio_publication_service_doi_key" ON "biblio_publication" USING btree ("service_id","doi");--> statement-breakpoint
CREATE INDEX "biblio_publication_doi_idx" ON "biblio_publication" USING btree ("doi");