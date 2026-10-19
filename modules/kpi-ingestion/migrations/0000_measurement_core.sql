CREATE TABLE "kpii_ingestion_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"adapter" text NOT NULL,
	"actor_id" uuid,
	"file_name" text,
	"status" text NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "kpii_ingestion_run_adapter_check" CHECK (char_length("kpii_ingestion_run"."adapter") between 1 and 64),
	CONSTRAINT "kpii_ingestion_run_file_name_check" CHECK ("kpii_ingestion_run"."file_name" is null or char_length("kpii_ingestion_run"."file_name") between 1 and 120),
	CONSTRAINT "kpii_ingestion_run_status_check" CHECK ("kpii_ingestion_run"."status" in ('committed', 'rejected')),
	CONSTRAINT "kpii_ingestion_run_counts_check" CHECK ("kpii_ingestion_run"."inserted" >= 0 and "kpii_ingestion_run"."updated" >= 0 and "kpii_ingestion_run"."unchanged" >= 0 and "kpii_ingestion_run"."rejected" >= 0),
	CONSTRAINT "kpii_ingestion_run_problems_check" CHECK (jsonb_typeof("kpii_ingestion_run"."problems") = 'array' and jsonb_array_length("kpii_ingestion_run"."problems") <= 100)
);
--> statement-breakpoint
CREATE TABLE "kpii_measurement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	"period" date NOT NULL,
	"value_numeric" numeric,
	"value_text" text,
	"source" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "kpii_measurement_period_check" CHECK ("kpii_measurement"."period" = (date_trunc('month', "kpii_measurement"."period"::timestamp) + interval '1 month' - interval '1 day')::date),
	CONSTRAINT "kpii_measurement_one_value_check" CHECK (("kpii_measurement"."value_numeric" is null) <> ("kpii_measurement"."value_text" is null)),
	CONSTRAINT "kpii_measurement_numeric_check" CHECK ("kpii_measurement"."value_numeric" is null or ("kpii_measurement"."value_numeric" <> 'NaN'::numeric and "kpii_measurement"."value_numeric" <> 'Infinity'::numeric and "kpii_measurement"."value_numeric" <> '-Infinity'::numeric)),
	CONSTRAINT "kpii_measurement_text_check" CHECK ("kpii_measurement"."value_text" is null or char_length("kpii_measurement"."value_text") between 1 and 4000),
	CONSTRAINT "kpii_measurement_source_check" CHECK (char_length("kpii_measurement"."source") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "kpii_measurement" ADD CONSTRAINT "kpii_measurement_run_id_kpii_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."kpii_ingestion_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpii_ingestion_run_service_idx" ON "kpii_ingestion_run" USING btree ("service_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kpii_measurement_series_idx" ON "kpii_measurement" USING btree ("service_id","indicator_id","period");--> statement-breakpoint
CREATE INDEX "kpii_measurement_service_period_idx" ON "kpii_measurement" USING btree ("service_id","period");--> statement-breakpoint
CREATE INDEX "kpii_measurement_indicator_idx" ON "kpii_measurement" USING btree ("indicator_id");--> statement-breakpoint
CREATE INDEX "kpii_measurement_run_idx" ON "kpii_measurement" USING btree ("run_id");--> statement-breakpoint
-- To kpi.framework, a declared dependency (its migrations run first). By hand: see db/schema.ts. `restrict`: an indicator with measurements is not deleted.
ALTER TABLE "kpii_measurement" ADD CONSTRAINT "kpii_measurement_indicator_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."kpif_indicator"("id") ON DELETE restrict ON UPDATE no action;
