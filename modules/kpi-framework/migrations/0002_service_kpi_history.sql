CREATE TABLE "kpif_service_kpi_history" (
	"service_id" uuid NOT NULL,
	"set_id" uuid,
	"extras" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"changed_by" uuid,
	CONSTRAINT "kpif_service_kpi_history_service_id_valid_from_pk" PRIMARY KEY("service_id","valid_from"),
	CONSTRAINT "kpif_service_kpi_history_range_check" CHECK ("kpif_service_kpi_history"."valid_to" is null or "kpif_service_kpi_history"."valid_to" > "kpif_service_kpi_history"."valid_from"),
	CONSTRAINT "kpif_service_kpi_history_extras_check" CHECK (cardinality("kpif_service_kpi_history"."extras") <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kpif_service_kpi_history_open_idx" ON "kpif_service_kpi_history" USING btree ("service_id") WHERE "kpif_service_kpi_history"."valid_to" is null;
--> statement-breakpoint
-- The backfill: one open row per service that has a KPI set or extras today. `valid_from` is the `updated_at` of the
-- service's set row (the last time the set changed); a service with extras only has no such time and starts at the
-- migration. History therefore begins at the migration for what changed before it. The extras are written as the
-- service layer writes them: without the ones the set contains, sorted.
INSERT INTO "kpif_service_kpi_history" ("service_id", "set_id", "extras", "valid_from", "valid_to", "changed_by")
SELECT s."service_id",
       ss."set_id",
       COALESCE((
         SELECT array_agg(e."indicator_id" ORDER BY e."indicator_id")
         FROM "kpif_service_extra_indicator" e
         WHERE e."service_id" = s."service_id"
           AND (ss."set_id" IS NULL OR NOT EXISTS (
             SELECT 1 FROM "kpif_kpi_set_indicator" si
             WHERE si."set_id" = ss."set_id" AND si."indicator_id" = e."indicator_id"))
       ), '{}'::uuid[]),
       COALESCE(ss."updated_at", now()),
       NULL,
       ss."updated_by"
FROM (
  SELECT "service_id" FROM "kpif_service_set"
  UNION
  SELECT "service_id" FROM "kpif_service_extra_indicator"
) s
LEFT JOIN "kpif_service_set" ss ON ss."service_id" = s."service_id";
--> statement-breakpoint
-- Append-only: a row is never deleted, and the only update is the closing of the open row (valid_to from null to a
-- time, nothing else). A change of what a service had is a new row. A later deletion of services needs its own
-- migration that drops this trigger, with an ADR.
CREATE FUNCTION "kpif_service_kpi_history_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kpif_service_kpi_history is append-only: a row is never deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."valid_to" IS NOT NULL
     OR NEW."valid_to" IS NULL
     OR NEW."service_id" IS DISTINCT FROM OLD."service_id"
     OR NEW."set_id" IS DISTINCT FROM OLD."set_id"
     OR NEW."extras" IS DISTINCT FROM OLD."extras"
     OR NEW."valid_from" IS DISTINCT FROM OLD."valid_from"
     OR NEW."changed_by" IS DISTINCT FROM OLD."changed_by" THEN
    RAISE EXCEPTION 'kpif_service_kpi_history is append-only: a row may only be closed, once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "kpif_service_kpi_history_guard" BEFORE UPDATE OR DELETE ON "kpif_service_kpi_history"
FOR EACH ROW EXECUTE FUNCTION "kpif_service_kpi_history_guard"();
