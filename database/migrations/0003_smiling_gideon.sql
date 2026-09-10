CREATE TABLE "report_manifests" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_lifecycle_id" uuid NOT NULL,
	"processing_session_id" uuid NOT NULL,
	"public_number" text NOT NULL,
	"coverage" text NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_manifests" ADD CONSTRAINT "report_manifests_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_device_lifecycle_id_device_lifecycles_id_fk" FOREIGN KEY ("device_lifecycle_id") REFERENCES "public"."device_lifecycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_processing_session_id_processing_sessions_id_fk" FOREIGN KEY ("processing_session_id") REFERENCES "public"."processing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_session_unique" ON "reports" USING btree ("processing_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_public_number_unique" ON "reports" USING btree ("public_number");--> statement-breakpoint
CREATE INDEX "reports_user_id_idx" ON "reports" USING btree ("user_id");