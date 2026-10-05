ALTER TYPE "public"."staff_role_enum" ADD VALUE 'SYSTEM';--> statement-breakpoint
ALTER TABLE "email_otp_challenges" ADD COLUMN "device_max" integer;--> statement-breakpoint
ALTER TABLE "mobile_serials" ALTER COLUMN "issued_by" DROP NOT NULL;
