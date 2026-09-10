import { sha256Hex } from "./crypto";
import type { Env } from "./env";

export interface SendOtpResult {
  sent: boolean;
  /** Present when email was not sent (local / unverified-domain preview). */
  devCode?: string;
  error?: string;
}

function previewFallback(env: Env): boolean {
  return env.API_ENV !== "production";
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
  params: { email: string; code: string; challengeId: string },
): Promise<SendOtpResult> {
  const { email, code, challengeId } = params;

  if (!env.RESEND_API_KEY) {
    console.log(
      `[otp][preview] no RESEND_API_KEY set — not sending. email=${email} challenge=${challengeId}`,
    );
    return { sent: false, devCode: previewFallback(env) ? code : undefined };
  }

  const from = env.RESEND_FROM ?? "CYVRA Mobile <noreply@cyvoriq.co.in>";
  const emailHash = await sha256Hex(email);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Guideline §6.4: otp/<email-hash>/<challenge-id>, 24h window (Resend default).
      "Idempotency-Key": `otp/${emailHash}/${challengeId}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your CYVRA Mobile sign-in code",
      text: `Your CYVRA Mobile Evidence sign-in code is ${code}. It expires in 10 minutes.`,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { id?: string; message?: string }
    | null;

  if (!response.ok) {
    const error = payload?.message ?? `Resend responded ${response.status}`;
    console.error(`[otp] Resend send failed: ${error}`);
    if (previewFallback(env)) {
      console.warn("[otp][preview] unverified domain or send error — returning code in JSON");
      return { sent: false, devCode: code };
    }
    return { sent: false, error };
  }

  return { sent: true };
}
