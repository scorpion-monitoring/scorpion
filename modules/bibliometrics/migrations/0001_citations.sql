CREATE TABLE "biblio_citation_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"source" text NOT NULL,
	"service_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"asked" integer DEFAULT 0 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "biblio_citation_run_trigger_check" CHECK ("biblio_citation_run"."trigger" in ('schedule', 'manual')),
	CONSTRAINT "biblio_citation_run_source_check" CHECK ("biblio_citation_run"."source" ~ '^[a-z][a-z0-9-]{0,31}$'),
	CONSTRAINT "biblio_citation_run_counts_check" CHECK ("biblio_citation_run"."asked" >= 0 and "biblio_citation_run"."found" >= 0 and "biblio_citation_run"."failed" >= 0 and "biblio_citation_run"."found" + "biblio_citation_run"."failed" <= "biblio_citation_run"."asked"),
	CONSTRAINT "biblio_citation_run_error_check" CHECK ("biblio_citation_run"."error" is null or char_length("biblio_citation_run"."error") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "biblio_citation_snapshot" (
	"run_id" uuid NOT NULL,
	"doi" text NOT NULL,
	"source" text NOT NULL,
	"cited_by_count" integer NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "biblio_citation_snapshot_doi_check" CHECK (char_length("biblio_citation_snapshot"."doi") between 4 and 256 and "biblio_citation_snapshot"."doi" = lower("biblio_citation_snapshot"."doi")),
	CONSTRAINT "biblio_citation_snapshot_count_check" CHECK ("biblio_citation_snapshot"."cited_by_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "biblio_citation_snapshot" ADD CONSTRAINT "biblio_citation_snapshot_run_id_biblio_citation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."biblio_citation_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biblio_citation_run_service_idx" ON "biblio_citation_run" USING btree ("service_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "biblio_citation_snapshot_run_doi_key" ON "biblio_citation_snapshot" USING btree ("run_id","doi");--> statement-breakpoint
CREATE INDEX "biblio_citation_snapshot_doi_idx" ON "biblio_citation_snapshot" USING btree ("doi","source","taken_at");