CREATE TABLE "capability_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_lifecycle_id" uuid NOT NULL,
	"processing_session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_lifecycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"manufacturer" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_lifecycle_id" uuid NOT NULL,
	"processing_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL,
	"record_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_lifecycle_id" uuid NOT NULL,
	"processing_session_id" uuid NOT NULL,
	"test_id" text NOT NULL,
	"source" text NOT NULL,
	"result" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"method" text NOT NULL,
	"limitation" text,
	"notes" text,
	"payload" jsonb,
	"digest" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_lifecycle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capability_profiles" ADD CONSTRAINT "capability_profiles_device_lifecycle_id_device_lifecycles_id_fk" FOREIGN KEY ("device_lifecycle_id") REFERENCES "public"."device_lifecycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_profiles" ADD CONSTRAINT "capability_profiles_processing_session_id_processing_sessions_id_fk" FOREIGN KEY ("processing_session_id") REFERENCES "public"."processing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_lifecycles" ADD CONSTRAINT "device_lifecycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_batches" ADD CONSTRAINT "evidence_batches_device_lifecycle_id_device_lifecycles_id_fk" FOREIGN KEY ("device_lifecycle_id") REFERENCES "public"."device_lifecycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_batches" ADD CONSTRAINT "evidence_batches_processing_session_id_processing_sessions_id_fk" FOREIGN KEY ("processing_session_id") REFERENCES "public"."processing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_batches" ADD CONSTRAINT "evidence_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_device_lifecycle_id_device_lifecycles_id_fk" FOREIGN KEY ("device_lifecycle_id") REFERENCES "public"."device_lifecycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_processing_session_id_processing_sessions_id_fk" FOREIGN KEY ("processing_session_id") REFERENCES "public"."processing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_sessions" ADD CONSTRAINT "processing_sessions_device_lifecycle_id_device_lifecycles_id_fk" FOREIGN KEY ("device_lifecycle_id") REFERENCES "public"."device_lifecycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_sessions" ADD CONSTRAINT "processing_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_profiles_lifecycle_version" ON "capability_profiles" USING btree ("device_lifecycle_id","version");--> statement-breakpoint
CREATE INDEX "device_lifecycles_user_id_idx" ON "device_lifecycles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "evidence_batches_user_id_idx" ON "evidence_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "evidence_records_session_idx" ON "evidence_records" USING btree ("processing_session_id");--> statement-breakpoint
CREATE INDEX "evidence_records_test_id_idx" ON "evidence_records" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "processing_sessions_lifecycle_idx" ON "processing_sessions" USING btree ("device_lifecycle_id");--> statement-breakpoint
CREATE INDEX "processing_sessions_user_id_idx" ON "processing_sessions" USING btree ("user_id");