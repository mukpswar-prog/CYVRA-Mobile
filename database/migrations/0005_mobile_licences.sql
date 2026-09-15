ALTER TABLE "mobile_serials" ADD COLUMN "customer_kind" text DEFAULT 'SINGLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "device_max" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "brand_scope" text DEFAULT 'UNSPECIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "customer_full_name" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "devices_bound" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "email_error" text;--> statement-breakpoint
CREATE INDEX "mobile_serials_created_at_idx" ON "mobile_serials" USING btree ("created_at");--> statement-breakpoint
CREATE TABLE "staff_operators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"nominated_by" text NOT NULL,
	"nominated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_operators_email_unique" ON "staff_operators" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "staff_operators_status_idx" ON "staff_operators" USING btree ("status");--> statement-breakpoint
CREATE TABLE "staff_otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "staff_otp_challenges_email_idx" ON "staff_otp_challenges" USING btree ("email");--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_token_hash_unique" ON "staff_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_sessions_email_idx" ON "staff_sessions" USING btree ("email");
