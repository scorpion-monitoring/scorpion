ALTER TABLE "identity_user" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "identity_user" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "identity_user" ADD CONSTRAINT "identity_user_display_name_length" CHECK (char_length("identity_user"."display_name") <= 100);--> statement-breakpoint
ALTER TABLE "identity_user" ADD CONSTRAINT "identity_user_bio_length" CHECK (char_length("identity_user"."bio") <= 2000);