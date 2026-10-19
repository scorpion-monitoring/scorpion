CREATE TABLE "kpif_evaluation" (
	"set_id" uuid PRIMARY KEY NOT NULL,
	"indicator_id" uuid NOT NULL,
	"aggregate" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "kpif_evaluation_aggregate_check" CHECK (char_length("kpif_evaluation"."aggregate") > 0)
);
--> statement-breakpoint
CREATE TABLE "kpif_indicator" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"example" text,
	"qualitative" boolean DEFAULT false NOT NULL,
	"value_type" text NOT NULL,
	"unit" text,
	"min_value" numeric,
	"max_value" numeric,
	"thematic" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "kpif_indicator_slug_check" CHECK (char_length("kpif_indicator"."slug") between 1 and 64 and "kpif_indicator"."slug" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
	CONSTRAINT "kpif_indicator_name_check" CHECK (char_length("kpif_indicator"."name") between 1 and 200),
	CONSTRAINT "kpif_indicator_description_check" CHECK ("kpif_indicator"."description" is null or char_length("kpif_indicator"."description") <= 4000),
	CONSTRAINT "kpif_indicator_example_check" CHECK ("kpif_indicator"."example" is null or char_length("kpif_indicator"."example") <= 1000),
	CONSTRAINT "kpif_indicator_value_type_check" CHECK (char_length("kpif_indicator"."value_type") between 1 and 64),
	CONSTRAINT "kpif_indicator_bounds_check" CHECK ("kpif_indicator"."min_value" is null or "kpif_indicator"."max_value" is null or "kpif_indicator"."min_value" <= "kpif_indicator"."max_value"),
	CONSTRAINT "kpif_indicator_qualitative_check" CHECK (not "kpif_indicator"."qualitative" or ("kpif_indicator"."value_type" = 'text' and "kpif_indicator"."min_value" is null and "kpif_indicator"."max_value" is null))
);
--> statement-breakpoint
CREATE TABLE "kpif_indicator_means" (
	"indicator_id" uuid NOT NULL,
	"term_key" text NOT NULL,
	CONSTRAINT "kpif_indicator_means_indicator_id_term_key_pk" PRIMARY KEY("indicator_id","term_key")
);
--> statement-breakpoint
CREATE TABLE "kpif_indicator_tool" (
	"indicator_id" uuid NOT NULL,
	"term_key" text NOT NULL,
	CONSTRAINT "kpif_indicator_tool_indicator_id_term_key_pk" PRIMARY KEY("indicator_id","term_key")
);
--> statement-breakpoint
CREATE TABLE "kpif_kpi_set" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rimo_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "kpif_kpi_set_slug_check" CHECK (char_length("kpif_kpi_set"."slug") between 1 and 64 and "kpif_kpi_set"."slug" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
	CONSTRAINT "kpif_kpi_set_name_check" CHECK (char_length("kpif_kpi_set"."name") between 1 and 200),
	CONSTRAINT "kpif_kpi_set_description_check" CHECK ("kpif_kpi_set"."description" is null or char_length("kpif_kpi_set"."description") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "kpif_kpi_set_indicator" (
	"set_id" uuid NOT NULL,
	"indicator_id" uuid NOT NULL,
	"necessity" text NOT NULL,
	CONSTRAINT "kpif_kpi_set_indicator_set_id_indicator_id_pk" PRIMARY KEY("set_id","indicator_id"),
	CONSTRAINT "kpif_kpi_set_indicator_necessity_check" CHECK (char_length("kpif_kpi_set_indicator"."necessity") > 0)
);
--> statement-breakpoint
ALTER TABLE "kpif_evaluation" ADD CONSTRAINT "kpif_evaluation_set_id_kpif_kpi_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."kpif_kpi_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpif_evaluation" ADD CONSTRAINT "kpif_evaluation_set_indicator_fk" FOREIGN KEY ("set_id","indicator_id") REFERENCES "public"."kpif_kpi_set_indicator"("set_id","indicator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpif_indicator_means" ADD CONSTRAINT "kpif_indicator_means_indicator_id_kpif_indicator_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."kpif_indicator"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpif_indicator_tool" ADD CONSTRAINT "kpif_indicator_tool_indicator_id_kpif_indicator_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."kpif_indicator"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpif_kpi_set_indicator" ADD CONSTRAINT "kpif_kpi_set_indicator_set_id_kpif_kpi_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."kpif_kpi_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpif_kpi_set_indicator" ADD CONSTRAINT "kpif_kpi_set_indicator_indicator_id_kpif_indicator_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."kpif_indicator"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpif_evaluation_aggregate_idx" ON "kpif_evaluation" USING btree ("aggregate");--> statement-breakpoint
CREATE UNIQUE INDEX "kpif_indicator_slug_idx" ON "kpif_indicator" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "kpif_indicator_name_idx" ON "kpif_indicator" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "kpif_indicator_thematic_idx" ON "kpif_indicator" USING btree ("thematic");--> statement-breakpoint
CREATE INDEX "kpif_indicator_unit_idx" ON "kpif_indicator" USING btree ("unit");--> statement-breakpoint
CREATE INDEX "kpif_indicator_means_term_idx" ON "kpif_indicator_means" USING btree ("term_key");--> statement-breakpoint
CREATE INDEX "kpif_indicator_tool_term_idx" ON "kpif_indicator_tool" USING btree ("term_key");--> statement-breakpoint
CREATE UNIQUE INDEX "kpif_kpi_set_slug_idx" ON "kpif_kpi_set" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "kpif_kpi_set_name_idx" ON "kpif_kpi_set" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "kpif_kpi_set_rimo_category_idx" ON "kpif_kpi_set" USING btree ("rimo_category");--> statement-breakpoint
CREATE INDEX "kpif_kpi_set_indicator_indicator_idx" ON "kpif_kpi_set_indicator" USING btree ("indicator_id");--> statement-breakpoint
CREATE INDEX "kpif_kpi_set_indicator_necessity_idx" ON "kpif_kpi_set_indicator" USING btree ("necessity");