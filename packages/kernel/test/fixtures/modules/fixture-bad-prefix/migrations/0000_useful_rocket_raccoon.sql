CREATE TABLE "fixture_bad_prefix_fine" (
	"id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stray_table" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note" text
);
