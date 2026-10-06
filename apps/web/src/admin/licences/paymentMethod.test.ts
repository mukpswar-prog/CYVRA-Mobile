/**
 * THE PAYMENT METHOD VOCABULARY, PINNED.
 * =======================================
 *
 * A mirrored constant is a liability only while nobody is watching it, and
 * this is the watching. `paymentMethod.ts` duplicates
 * `paymentMethodEnum.enumValues` from `database/src/schema.ts` because the
 * browser bundle must not depend on the database package - see that file's
 * header, which explains the trade in full.
 *
 * Two tests pin the same seven strings, one here and one in
 * `services/api/test/paymentMethod.test.ts`. Changing the accepted set
 * therefore means editing two files in two packages, which is exactly the
 * reviewable event a silent drift would not have been.
 *
 * Also asserted here: the labels are usable UI. An option with an empty label
 * renders as a blank row in the dropdown - the operator is asked to choose
 * between nothing - and duplicate values make React's key and the select's
 * `value` disagree, which silently selects the wrong option.
 */
import { describe, expect, it } from "vitest";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_VALUES,
  type PaymentMethodOption,
} from "./paymentMethod";

describe("the payment method vocabulary", () => {
  it("is exactly the seven values payment_method_enum admits", () => {
    expect(PAYMENT_METHOD_VALUES).toEqual([
      "UPI",
      "BANK_TRANSFER",
      "CARD",
      "NET_BANKING",
      "CASH",
      "CHEQUE",
      "OTHER",
    ]);
  });

  it("publishes a non-empty, unique label for every value", () => {
    for (const option of PAYMENT_METHODS) {
      expect(option.value, "every value must be named").not.toBe("");
      expect(option.label.trim(), `label for ${option.value}`).not.toBe("");
    }
    const values = PAYMENT_METHODS.map((option: PaymentMethodOption) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("keeps PAYMENT_METHOD_VALUES in step with PAYMENT_METHODS", () => {
    // Derived, so they cannot diverge inside this file either - the risk the
    // header above spends a paragraph on, one level down.
    expect(PAYMENT_METHOD_VALUES).toEqual(PAYMENT_METHODS.map((option) => option.value));
  });

  it("is frozen, so no runtime code can widen the set after load", () => {
    expect(Object.isFrozen(PAYMENT_METHODS)).toBe(true);
    expect(Object.isFrozen(PAYMENT_METHOD_VALUES)).toBe(true);
  });
});
