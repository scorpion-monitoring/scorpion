CREATE TABLE "kpii_reminder_sent" (
	"provider_id" uuid NOT NULL,
	"period" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipients" integer NOT NULL,
	"services" integer NOT NULL,
	CONSTRAINT "kpii_reminder_sent_pk" PRIMARY KEY("provider_id","period"),
	CONSTRAINT "kpii_reminder_sent_period_check" CHECK ("kpii_reminder_sent"."period" = (date_trunc('month', "kpii_reminder_sent"."period"::timestamp) + interval '1 month' - interval '1 day')::date),
	CONSTRAINT "kpii_reminder_sent_counts_check" CHECK ("kpii_reminder_sent"."recipients" >= 1 and "kpii_reminder_sent"."services" >= 1)
);
