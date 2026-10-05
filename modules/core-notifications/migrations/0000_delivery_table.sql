CREATE TABLE "notify_delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"channel" text NOT NULL,
	"recipient_address" text,
	"recipient_user_id" uuid,
	"locale" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text,
	"html_body" text,
	"sensitive" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transport" text,
	CONSTRAINT "notify_delivery_status_check" CHECK ("notify_delivery"."status" in ('queued', 'sending', 'sent', 'dead')),
	CONSTRAINT "notify_delivery_channel_check" CHECK ("notify_delivery"."channel" in ('email', 'webhook')),
	CONSTRAINT "notify_delivery_address_check" CHECK ("notify_delivery"."channel" <> 'email' or "notify_delivery"."recipient_address" is not null)
);
--> statement-breakpoint
CREATE INDEX "notify_delivery_due_idx" ON "notify_delivery" USING btree ("next_attempt_at") WHERE "notify_delivery"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "notify_delivery_lease_idx" ON "notify_delivery" USING btree ("locked_until") WHERE "notify_delivery"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "notify_delivery_status_idx" ON "notify_delivery" USING btree ("status","created_at");