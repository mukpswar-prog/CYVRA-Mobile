/**
 * THE PAYMENT METHOD VOCABULARY - `payment_method_enum`, mirrored for the UI.
 * ==========================================================================
 *
 * `payment_method_enum` in `database/src/schema.ts` is the authority: seven
 * values, enforced by Postgres. This file is the browser's copy of that set,
 * laid out as the `{ value, label }` pairs a `<select>` needs.
 *
 * WHY THERE ARE TWO
 * ------------------
 * `apps/web` bundles for the browser and depends on `react` and nothing else;
 * importing `@cyvra/database/schema` would drag drizzle-orm and `pg` into a
 * page load to read a seven-element array. So the mirror is deliberate - but a
 * mirrored vocabulary is exactly the thing that drifts, and drift here would
 * show up as a 400 from the confirm route naming values the dialog never
 * offered. Three things hold it honest:
 *
 *   1. `paymentMethod.test.ts` pins the value list verbatim, and the API has a
 *      companion test pinning `paymentMethodEnum.enumValues` verbatim. A
 *      change to the set therefore has to touch two test files in two
 *      packages, which is a reviewable event rather than an accident.
 *   2. The server's refusal sentence is built from `paymentMethodEnum.enumValues`
 *      itself, so if drift ever does occur the operator is told the *real* set
 *      rather than being handed an opaque 500.
 *   3. The values are asserted here as `PAYMENT_METHOD_VALUES` so labels and
 *      wire values cannot diverge within this file either.
 *
 * Extracting this into a shared constants package is on the disposition list
 * (see `services/api/src/format/datetime.ts`'s header, which has the same
 * shape of problem for the same reason) - not done silently, because it is an
 * architectural change rather than a fix.
 *
 * THE FREEZE DOES NOT NAME THIS FIELD
 * -----------------------------------
 * The Design Freeze never says "payment method" and never lists an allowed
 * set. §18 PAYMENT CONTROL enumerates Status, Confirmed By, Confirmed At,
 * Reference, Notes, Amount, Currency and Payment Date - not method. These seven
 * values are a code decision, recorded in migration 0009, in `schema.ts` and
 * here, so they can be amended by ruling rather than by archaeology.
 */

export interface PaymentMethodOption {
  readonly value: string;
  readonly label: string;
}

/**
 * In the order an operator reads them: the rails the product already mentions
 * first (the confirm dialog's own placeholder says "UPI ref, bank reference"),
 * then card and net banking, then the offline settling methods, then the
 * catch-all.
 *
 * `OTHER` earns its place: a mandatory field with no escape hatch gets lied
 * to, and an operator who cannot find their rail will write it into `reference`
 * instead - corrupting a field §18 *does* specify.
 */
export const PAYMENT_METHODS: readonly PaymentMethodOption[] = Object.freeze([
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer (IMPS / NEFT / RTGS)" },
  { value: "CARD", label: "Card" },
  { value: "NET_BANKING", label: "Net banking" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
]);

/**
 * The set, as the wire sees it - exactly the strings `payment_method_enum`
 * admits. Kept separate from `PAYMENT_METHODS`' labels so a label can be
 * worded for humans without the value changing under it.
 */
export const PAYMENT_METHOD_VALUES: readonly string[] = Object.freeze(
  PAYMENT_METHODS.map((option) => option.value),
);
