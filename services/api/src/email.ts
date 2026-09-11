import { sha256Hex } from "./crypto";
import type { Env } from "./env";

export interface SendOtpResult {
  sent: boolean;
  /** Present when email was not sent (local / unverified-domain preview). */
  devCode?: string;
  error?: string;
  id?: string;
}

function previewFallback(env: Env): boolean {
  return env.API_ENV !== "production";
}

function hasResendKey(env: Env): boolean {
  return Boolean((env.RESEND_API_KEY ?? "").trim());
}

export function mailConfigured(env: Pick<Env, "RESEND_API_KEY">): boolean {
  return Boolean((env.RESEND_API_KEY ?? "").trim());
}

export function parseResendError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as {
      message?: unknown;
      name?: unknown;
      error?: { message?: unknown } | string;
    };
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
    if (
      record.error &&
      typeof record.error === "object" &&
      typeof record.error.message === "string" &&
      record.error.message.trim()
    ) {
      return record.error.message.trim();
    }
    if (typeof record.name === "string" && record.name.trim()) {
      return `${record.name} (${status})`;
    }
  }
  return `Resend responded ${status}`;
}

export function explainMailFailure(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("resend_api_key") || lower.includes("not set")) {
    return `${error} Add the sending key on Worker cyvra-mobile-api Settings → Variables and Secrets. Do not rotate Erase keys.`;
  }
  if (
    lower.includes("not verified") ||
    lower.includes("unverified") ||
    lower.includes("verify your domain")
  ) {
    return `${error} Verify domain cyvoriq.co.in in Resend → Domains (SPF/DKIM). Keep cyvra.co.in verified for Erase.`;
  }
  if (
    lower.includes("testing") ||
    lower.includes("own email") ||
    lower.includes("only send testing") ||
    lower.includes("you can only send")
  ) {
    return `${error} Resend testing mode only delivers to the Resend account inbox. Add ceo@cyvoriq.com there, or enable production sending after cyvoriq.co.in is Verified.`;
  }
  return error;
}

function otpText(code: string, staff: boolean): string {
  if (staff) {
    return `Your CYVRA Mobile ops sign-in code is ${code}. It expires in 10 minutes. This is not a customer login. Phone is not used.`;
  }
  return `Your CYVRA Mobile Evidence sign-in code is ${code}. It expires in 10 minutes.`;
}

function otpHtml(code: string, staff: boolean): string {
  const title = staff ? "CYVRA Mobile ops sign-in" : "CYVRA Mobile sign-in";
  return `<!doctype html>
<html>
<body style="font-family:Inter,Segoe UI,sans-serif;color:#15181c;background:#f6f7f8;padding:24px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e6e8eb;border-radius:12px">
    <tr><td style="padding:24px 28px">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;color:#5c6470">${title}</p>
      <p style="margin:0 0 18px;font-size:15px">Use this 6-digit code. It expires in 10 minutes. Phone is not used.</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:.28em;color:#15181c">${code}</p>
      <p style="margin:18px 0 0;font-size:13px;color:#5c6470">If you did not request this, ignore the email. This is not a Windows Erase licence.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function licenceText(params: {
  licenceKey: string;
  slabLabel: string;
  kind: string;
  brandScope: string;
}): string {
  return [
    `Your CYVRA Mobile licence key is:`,
    params.licenceKey,
    ``,
    `Type: ${params.kind}`,
    `Devices: ${params.slabLabel} of brand ${params.brandScope}`,
    `The same key may be used on devices of that brand up to the slab.`,
    `This is not a sanitization certificate and not a Windows Erase licence.`,
    ``,
    `CYVORIQ Solutions Pvt. Ltd.`,
  ].join("\n");
}

function licenceHtml(params: {
  licenceKey: string;
  slabLabel: string;
  kind: string;
  brandScope: string;
}): string {
  return `<!doctype html>
<html>
<body style="font-family:Inter,Segoe UI,sans-serif;color:#15181c;background:#f6f7f8;padding:24px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e8eb;border-radius:12px">
    <tr><td style="padding:24px 28px">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;color:#5c6470">CYVRA Mobile licence</p>
      <p style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:.04em">${params.licenceKey}</p>
      <p style="margin:0;font-size:14px;color:#5c6470">Type ${params.kind} · Devices ${params.slabLabel} · Brand ${params.brandScope}</p>
      <p style="margin:16px 0 0;font-size:13px;color:#5c6470">Same key, same brand, up to the slab. This is not a sanitization certificate and not a Windows Erase licence.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

async function postResendEmail(
  env: Env,
  params: {
    to: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
  },
): Promise<SendOtpResult> {
  const from = env.RESEND_FROM ?? "CYVRA Mobile <noreply@cyvoriq.co.in>";
  let lastError = "email failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": params.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { id?: string; message?: string }
      | null;
    if (response.ok) {
      return { sent: true, id: payload?.id };
    }
    lastError = explainMailFailure(parseResendError(payload, response.status));
    console.error(`[otp] Resend send failed: ${lastError}`);
    if (response.status === 429 || response.status >= 500) {
      continue;
    }
    break;
  }
  return { sent: false, error: lastError };
}

/**
 * Send an OTP email. Per the guideline, Resend is called ONLY from the Worker
 * (never the browser), with an idempotency key, and we check `{ data, error }`
 * rather than relying on thrown errors.
 *
 * Local / Pages preview (API_ENV !== production): if RESEND_API_KEY is empty
 * or Resend rejects the send (unverified cyvoriq.co.in), the 6-digit code is
 * returned in the JSON so G3 can be tested without a verified domain.
 * Production never returns the code. Keep cyvra.co.in verified for Erase.
 */
export async function sendOtpEmail(
  env: Env,
  params: { email: string; code: string; challengeId: string; purpose?: "customer" | "staff" },
): Promise<SendOtpResult> {
  const { email, code, challengeId } = params;
  const staff = params.purpose === "staff";

  if (!hasResendKey(env)) {
    console.log(
      `[otp][preview] no RESEND_API_KEY set — not sending. email=${email} challenge=${challengeId}`,
    );
    return {
      sent: false,
      error: explainMailFailure("RESEND_API_KEY is not set on Worker cyvra-mobile-api."),
      devCode: previewFallback(env) ? code : undefined,
    };
  }

  const emailHash = await sha256Hex(email);
  const result = await postResendEmail(env, {
    to: email,
    subject: staff
      ? "Your CYVRA Mobile ops sign-in code"
      : "Your CYVRA Mobile sign-in code",
    text: otpText(code, staff),
    html: otpHtml(code, staff),
    idempotencyKey: `otp/${staff ? "staff/" : ""}${emailHash}/${challengeId}`,
  });
  if (result.sent) return result;
  if (previewFallback(env)) {
    console.warn("[otp][preview] unverified domain or send error — returning code in JSON");
    return { sent: false, error: result.error, devCode: code };
  }
  return result;
}

export async function sendLicenceEmail(
  env: Env,
  params: {
    email: string;
    licenceKey: string;
    slabLabel: string;
    kind: string;
    brandScope: string;
    serialId: string;
  },
): Promise<SendOtpResult & { id?: string }> {
  if (!hasResendKey(env)) {
    return {
      sent: false,
      error: explainMailFailure("RESEND_API_KEY is not set on Worker cyvra-mobile-api."),
      devCode: previewFallback(env) ? params.licenceKey : undefined,
    };
  }
  const result = await postResendEmail(env, {
    to: params.email,
    subject: `Your CYVRA Mobile licence ${params.licenceKey}`,
    text: licenceText(params),
    html: licenceHtml(params),
    idempotencyKey: `licence/${params.serialId}`,
  });
  if (result.sent) return result;
  if (previewFallback(env)) {
    return { sent: false, error: result.error, devCode: params.licenceKey };
  }
  return result;
}
