CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"actor_kind" text NOT NULL,
	"user_id" text,
	"token_id" text,
	"ip" text,
	"method" text,
	"path" text,
	"status" integer,
	"query" jsonb,
	"body" jsonb,
	"truncated" boolean DEFAULT false NOT NULL,
	"request_id" text,
	"subject_type" text,
	"subject_id" text,
	"event_id" uuid,
	"payload" jsonb,
	CONSTRAINT "audit_event_source_check" CHECK ("audit_event"."source" in ('event', 'api')),
	CONSTRAINT "audit_event_outcome_check" CHECK ("audit_event"."outcome" in ('ok', 'denied', 'error')),
	CONSTRAINT "audit_event_actor_kind_check" CHECK ("audit_event"."actor_kind" in ('user', 'token', 'anonymous', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_event_id_idx" ON "audit_event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "audit_event_occurred_at_idx" ON "audit_event" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_user_idx" ON "audit_event" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_action_idx" ON "audit_event" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_event_source_idx" ON "audit_event" USING btree ("source","occurred_at");