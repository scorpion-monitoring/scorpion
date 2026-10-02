CREATE TABLE "kernel_rate_bucket" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"allowed" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "kernel_rate_bucket_updated_at_idx" ON "kernel_rate_bucket" USING btree ("updated_at");