/** Customer registration fields collected before the Resend OTP. */

import { ISSUABLE_SLABS, isIssuableSlab } from "./licenceKey";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PINCODE_RE = /^\d{6}$/;

/**
 * The slab a registration that named no plan receives.
 *
 * There is no checkout step yet - `cyvoriq.co.in` collects a name, a company and
 * an address and never asks what the customer wants to buy - so every
 * registration today arrives without a plan and this is what it gets.
 *
 * It is `1` rather than the schema's own default of `3` for three reasons:
 *
 *   1. slab 3 maps to `CAP-3`, which `licenceKey.ts` marks LEGACY - "reachable
 *      from records created before the commercial plan list existed, never
 *      offered to new ones". Defaulting new records onto it would contradict a
 *      rule stated in the module that owns plan codes.
 *   2. the 05 Oct 2026 design freeze fixes the standard plans at 1, 5, 10, 25
 *      and 50 (RULE 4). `1` is the smallest of them; `3` is not one of them.
 *   3. a pending-payment row that claims 50 devices is a promise. The smallest
 *      issuable slab is the largest claim the record can honestly make while
 *      `payments.status` is still `PENDING`.
 *
 * This is a placeholder for a real plan picker, not a pricing decision.
 */
export const REGISTRATION_DEFAULT_SLAB = 1;

export interface RegistrationProfile {
  fullName: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  pincode: string;
  state: string;
}

export interface ParsedRegistration extends RegistrationProfile {
  email: string;
  /** Device slab, always a member of `ISSUABLE_SLABS`. */
  deviceMax: number;
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read the device slab off a registration payload.
 *
 * Accepts `plan` (the name the checkout will use) or `deviceMax` (the column it
 * becomes). Absent, null or empty means "the form offered no plan" and falls
 * back to the default rather than refusing: a customer who never saw a plan
 * field must not be locked out of registering because of a field they never saw.
 *
 * Anything present and unrecognisable is refused, and there are two different
 * kinds of refusal behind that one answer, both decided before the OTP is sent:
 *
 *   * a slab the key format cannot encode (`2`, `4`, `100`, ...) would produce
 *     a licence row no key could ever be generated for - a record that can
 *     never leave `PAYMENT_PENDING`;
 *   * a slab the key CAN encode but a new record may not be born on (`3`, `7`)
 *     would write a LEGACY plan code onto a customer who registered today,
 *     which `licenceKey.ts` and design-freeze RULE 4 both forbid.
 *
 * The five standard plans - 1, 5, 10, 25, 50 - are all accepted: slab 10
 * joined `LICENCE_SLABS` when RULE 4 was applied.
 */
export function parsePlan(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: REGISTRATION_DEFAULT_SLAB };
  }
  const parsed = typeof raw === "number" ? raw : Number(trim(raw));
  if (!Number.isInteger(parsed) || !isIssuableSlab(parsed)) {
    return {
      ok: false,
      error: `Plan must be a device count of ${ISSUABLE_SLABS.join(", ")}.`,
    };
  }
  return { ok: true, value: parsed };
}

export function parseRegistration(body: Record<string, unknown>): {
  ok: true;
  value: ParsedRegistration;
} | { ok: false; error: string } {
  const email = trim(body.email).toLowerCase();
  const fullName = trim(body.fullName);
  const companyName = trim(body.companyName);
  const addressLine1 = trim(body.addressLine1);
  const addressLine2 = trim(body.addressLine2);
  const pincode = trim(body.pincode).replace(/\s/g, "");
  const state = trim(body.state);

  const plan = parsePlan(body.plan ?? body.deviceMax);
  if (!plan.ok) return plan;

  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, error: "Full name is required." };
  }
  if (!PINCODE_RE.test(pincode)) {
    return { ok: false, error: "A 6-digit pincode is required." };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "A valid email address is required." };
  }
  if (companyName.length > 160) {
    return { ok: false, error: "Company name is too long." };
  }
  if (addressLine1.length > 160 || addressLine2.length > 160) {
    return { ok: false, error: "Address is too long." };
  }
  if (state.length > 80) {
    return { ok: false, error: "State is too long." };
  }

  return {
    ok: true,
    value: {
      email,
      fullName,
      companyName,
      addressLine1,
      addressLine2,
      pincode,
      state,
      deviceMax: plan.value,
    },
  };
}

export function profileColumns(profile: RegistrationProfile) {
  return {
    fullName: profile.fullName,
    companyName: profile.companyName || null,
    addressLine1: profile.addressLine1 || null,
    addressLine2: profile.addressLine2 || null,
    pincode: profile.pincode,
    state: profile.state || null,
  };
}
