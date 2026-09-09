/** Customer registration fields collected before the Resend OTP. */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PINCODE_RE = /^\d{6}$/;

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
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
