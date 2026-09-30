CREATE TABLE "example_notes_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
