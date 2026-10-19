CREATE TABLE "kpif_service_extra_indicator" (
	"service_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	CONSTRAINT "kpif_service_extra_indicator_service_id_indicator_id_pk" PRIMARY KEY("service_id","indicator_id")
);
--> statement-breakpoint
CREATE TABLE "kpif_service_set" (
	"service_id" uuid PRIMARY KEY NOT NULL,
	"set_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "kpif_service_extra_indicator" ADD CONSTRAINT "kpif_service_extra_indicator_indicator_id_kpif_indicator_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."kpif_indicator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpif_service_set" ADD CONSTRAINT "kpif_service_set_set_id_kpif_kpi_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."kpif_kpi_set"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpif_service_extra_indicator_indicator_idx" ON "kpif_service_extra_indicator" USING btree ("indicator_id");--> statement-breakpoint
CREATE INDEX "kpif_service_set_set_idx" ON "kpif_service_set" USING btree ("set_id");