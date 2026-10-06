/*
 * WS-H2 PILLAR 2 - `payments.payment_method`.
 * ============================================
 *
 * HOW the money arrived, recorded alongside the `status` that says WHETHER it
 * did. `status` answers a financial question; `payment_method` answers an
 * operational one - "which rail do I look at to find the settlement?" - and
 * without it the only place that can answer it is free text in `reference`.
 *
 * NULLABLE, AND THAT IS NOT AN AFTERTHOUGHT
 * -----------------------------------------
 * Every `payments` row that exists today was written before this migration and
 * has no method, because none was ever captured. Backfilling would mean
 * asserting how a customer paid last month: a fabricated fact in a table whose
 * entire purpose is to be trustworthy. Pre-existing rows stay NULL, and NULL
 * on a `PAID` row means "pre-WS-H2", not "data was lost".
 *
 * Required-ness lives at the moment the fact becomes knowable -
 * `POST /serials/:serialId/confirm-payment` refuses to confirm without one,
 * inside the same transaction that writes `status = 'PAID'`. So a NEW row can
 * never be method-less, while this column's nullability does not break the
 * 0007 seed INSERT or any `INSERT ... DEFAULT VALUES` after it.
 *
 * ANOMALY: THE FREEZE DOES NOT DEFINE THIS FIELD
 * ---------------------------------------------
 * The Design Freeze never uses the phrase "payment method" and never lists an
 * allowed set. §18 PAYMENT CONTROL enumerates what confirming a payment must
 * record - Status, Confirmed By, Confirmed At, Reference, Notes, Amount,
 * Currency, Payment Date - and method is not among them; §18's worked example
 * shows `Method:` in prose only. The seven values below are therefore a CODE
 * decision, chosen from what the product already says about payments (the
 * confirm dialog's placeholder is "UPI ref, bank reference, note"; the legacy
 * admin form reads "UPI / NEFT reference and date") plus the standard Indian
 * settlement rails. They are recorded here, and in `schema.ts`, so the set can
 * be amended by ruling rather than by archaeology.
 *
 * `OTHER` is deliberate: a required field with no escape hatch gets lied to,
 * and an operator who cannot find their rail will write it into `reference` -
 * corrupting a field §18 *does* specify.
 *
 * ORDERING: the enum type is created before the column that uses it, and no
 * existing constraint, index or row is touched - this migration is purely
 * additive, so rolling it back is `DROP COLUMN` followed by `DROP TYPE`.
 */
--> statement-breakpoint
CREATE TYPE "public"."payment_method_enum" AS ENUM('UPI', 'BANK_TRANSFER', 'CARD', 'NET_BANKING', 'CASH', 'CHEQUE', 'OTHER');--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_method" "payment_method_enum";
