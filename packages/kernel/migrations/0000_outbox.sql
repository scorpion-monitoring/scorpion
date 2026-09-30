CREATE TABLE "kernel_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emitter" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kernel_outbox_delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"subscriber" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "kernel_outbox_delivery_status_check" CHECK ("kernel_outbox_delivery"."status" in ('pending', 'delivered', 'dead'))
);
--> statement-breakpoint
ALTER TABLE "kernel_outbox_delivery" ADD CONSTRAINT "kernel_outbox_delivery_event_id_kernel_outbox_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."kernel_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kernel_outbox_occurred_at_idx" ON "kernel_outbox" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kernel_outbox_delivery_event_subscriber_idx" ON "kernel_outbox_delivery" USING btree ("event_id","subscriber");--> statement-breakpoint
CREATE INDEX "kernel_outbox_delivery_due_idx" ON "kernel_outbox_delivery" USING btree ("status","next_attempt_at");