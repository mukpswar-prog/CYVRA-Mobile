CREATE TABLE "mobile_serials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_number" text NOT NULL,
	"status" text NOT NULL,
	"customer_email" text NOT NULL,
	"user_id" uuid,
	"payment_noted" text NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD CONSTRAINT "mobile_serials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_serials_public_number_unique" ON "mobile_serials" USING btree ("public_number");--> statement-breakpoint
CREATE INDEX "mobile_serials_customer_email_idx" ON "mobile_serials" USING btree ("customer_email");--> statement-breakpoint
CREATE INDEX "mobile_serials_status_idx" ON "mobile_serials" USING btree ("status");