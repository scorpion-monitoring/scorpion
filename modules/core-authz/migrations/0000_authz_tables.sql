CREATE TABLE "authz_default_grant" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authz_default_grant_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "authz_role" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authz_role_key_format" CHECK ("authz_role"."key" ~ '^[a-z][a-z0-9-]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "authz_role_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authz_role_permission" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "authz_role_permission_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
ALTER TABLE "authz_default_grant" ADD CONSTRAINT "authz_default_grant_role_id_authz_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_assignment" ADD CONSTRAINT "authz_role_assignment_role_id_authz_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz_role_permission" ADD CONSTRAINT "authz_role_permission_role_id_authz_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."authz_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authz_role_key_uidx" ON "authz_role" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "authz_role_assignment_user_role_uidx" ON "authz_role_assignment" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "authz_role_assignment_role_idx" ON "authz_role_assignment" USING btree ("role_id");