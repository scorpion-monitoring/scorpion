CREATE TABLE "kernel_job_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"module" text NOT NULL,
	"job_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"timeout_seconds" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	CONSTRAINT "kernel_job_run_status_check" CHECK ("kernel_job_run"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "kernel_job_run_job_started_idx" ON "kernel_job_run" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "kernel_job_run_started_idx" ON "kernel_job_run" USING btree ("started_at");