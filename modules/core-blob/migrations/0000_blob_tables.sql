CREATE TABLE "blob_blob" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unreferenced_since" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blob_reference" (
	"ref" text PRIMARY KEY NOT NULL,
	"blob_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blob_reference" ADD CONSTRAINT "blob_reference_blob_id_blob_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob_blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blob_blob_hash_uidx" ON "blob_blob" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "blob_blob_unreferenced_idx" ON "blob_blob" USING btree ("unreferenced_since");--> statement-breakpoint
CREATE INDEX "blob_reference_blob_idx" ON "blob_reference" USING btree ("blob_id");