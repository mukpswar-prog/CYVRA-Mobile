import type { Env } from "./env";

export interface SendOtpResult {
  sent: boolean;
  /** Present only in dev mode (no RESEND_API_KEY) to ease local testing. */
  devCode?: string;
  error?: string;
}

/**
 * Send an OTP email. Per the guideline, Resend is called ONLY from the Worker
 * (never the browser), with an idempotency key, and we check `{ data, error }`
 * rather than relying on thrown errors.
 *
 * In dev mode (no RESEND_API_KEY) nothing is sent: the code is logged and
 * surfaced so the local sign-in flow works without a verified Resend domain.
 */
export async function sendOtpEmail(
  env: Env,
  params: { email: string; code: string; challengeId: string },
): Promise<SendOtpResult> {
  const { email, code, challengeId } = params;

  if (!env.RESEND_API_KEY) {
    console.log(
      `[otp][dev] no RESEND_API_KEY set — not sending. email=${email} code=${code} challenge=${challengeId}`,
    );
    return { sent: false, devCode: code };
  }

  const from = env.RESEND_FROM ?? "CYVRA Mobile <noreply@cyvra.co.in>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Idempotency scoped to the challenge so retries don't double-send.
      "Idempotency-Key": `otp/${challengeId}`,
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
    return { sent: false, error };
  }

  return { sent: true };
}
