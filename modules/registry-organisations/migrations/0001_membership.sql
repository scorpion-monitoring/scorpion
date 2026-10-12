CREATE TABLE "org_membership" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"role_changed_at" timestamp with time zone,
	"role_changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_membership_organisation_user_key" UNIQUE("organisation_id","user_id"),
	CONSTRAINT "org_membership_state_check" CHECK ("org_membership"."state" in ('requested', 'approved', 'rejected', 'left')),
	CONSTRAINT "org_membership_role_check" CHECK ("org_membership"."role" in ('member', 'manager')),
	CONSTRAINT "org_membership_manager_approved_check" CHECK ("org_membership"."role" = 'member' or "org_membership"."state" = 'approved')
);
--> statement-breakpoint
ALTER TABLE "org_membership" ADD CONSTRAINT "org_membership_organisation_id_org_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."org_organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_membership_user_idx" ON "org_membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_membership_pending_idx" ON "org_membership" USING btree ("requested_at","id") WHERE "org_membership"."state" = 'requested';--> statement-breakpoint
CREATE INDEX "org_membership_members_idx" ON "org_membership" USING btree ("organisation_id") WHERE "org_membership"."state" = 'approved';--> statement-breakpoint
CREATE INDEX "org_membership_managers_idx" ON "org_membership" USING btree ("organisation_id","user_id") WHERE "org_membership"."state" = 'approved' and "org_membership"."role" = 'manager';