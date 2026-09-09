ALTER TABLE "email_otp_challenges" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "email_otp_challenges" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "email_otp_challenges" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "email_otp_challenges" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "email_otp_challenges" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "email_otp_challenges" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "state" text;