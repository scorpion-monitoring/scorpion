CREATE TABLE "notify_inbox_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notify_inbox_item_title_check" CHECK (char_length("notify_inbox_item"."title") between 1 and 200),
	CONSTRAINT "notify_inbox_item_text_check" CHECK (char_length("notify_inbox_item"."text") <= 2000),
	CONSTRAINT "notify_inbox_item_link_check" CHECK (char_length("notify_inbox_item"."link") <= 2048)
);
--> statement-breakpoint
CREATE INDEX "notify_inbox_item_user_idx" ON "notify_inbox_item" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notify_inbox_item_unread_idx" ON "notify_inbox_item" USING btree ("user_id") WHERE "notify_inbox_item"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notify_inbox_item_read_idx" ON "notify_inbox_item" USING btree ("read_at") WHERE "notify_inbox_item"."read_at" is not null;