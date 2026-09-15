import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  explainMailFailure,
  mailConfigured,
  mailFromHost,
  parseResendError,
  sendOtpEmail,
} from "../src/email.ts";
import type { Env } from "../src/env.ts";

function env(overrides: Partial<Env> = {}): Env {
  return {
    HYPERDRIVE: {} as Env["HYPERDRIVE"],
    APP_ORIGIN: "http://localhost:5173",
    API_ENV: "preview",
    ...overrides,
  };
}

describe("ops mail", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses Resend testing-mode and nested errors", () => {
    assert.match(
      parseResendError(
        { message: "You can only send testing emails to your own email address." },
        403,
      ),
      /testing emails/,
    );
    assert.equal(
      parseResendError({ error: { message: "The cyvoriq.co.in domain is not verified." } }, 403),
      "The cyvoriq.co.in domain is not verified.",
    );
    assert.equal(parseResendError(null, 500), "Resend responded 500");
  });

  it("explains testing mode and unverified domain without leaking a code", () => {
    assert.match(
      explainMailFailure("You can only send testing emails to your own email address."),
      /ceo@cyvoriq.com/,
    );
    assert.match(
      explainMailFailure("The cyvoriq.co.in domain is not verified. Please, add and verify your domain"),
      /Keep cyvra.co.in/,
    );
    assert.equal(mailConfigured(env()), false);
    assert.equal(mailConfigured(env({ RESEND_API_KEY: "re_test" })), true);
    assert.equal(mailFromHost(env()), "unset");
    assert.equal(
      mailFromHost(env({ RESEND_FROM: "CYVRA Mobile <noreply@cyvoriq.co.in>" })),
      "cyvoriq.co.in",
    );
    assert.equal(
      mailFromHost(env({ RESEND_FROM: "CYVRA Mobile <noreply@cyvra.co.in>" })),
      "cyvra.co.in",
    );
    assert.equal(mailFromHost(env({ RESEND_FROM: "noreply@example.com" })), "other");
    assert.match(
      explainMailFailure("This API key is restricted to cyvra.co.in"),
      /locked to Erase domain/,
    );
    assert.match(explainMailFailure("Resend responded 403"), /docs\/resend-mobile-otp\.md/);
  });

  it("explains a restricted-key 403 and still returns a preview code", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          message: "This API key is restricted to only send emails from cyvra.co.in",
        }),
        { status: 403 },
      )) as typeof fetch;
    const result = await sendOtpEmail(
      env({
        RESEND_API_KEY: "re_test",
        RESEND_FROM: "CYVRA Mobile <noreply@cyvoriq.co.in>",
      }),
      {
        email: "ceo@cyvoriq.com",
        code: "246810",
        challengeId: "44444444-4444-4444-8444-444444444444",
        purpose: "customer",
      },
    );
    assert.equal(result.sent, false);
    assert.equal(result.devCode, "246810");
    assert.match(result.error ?? "", /locked to Erase domain/);
  });

  it("returns an on-screen code when the Worker has no Resend key", async () => {
    const result = await sendOtpEmail(env(), {
      email: "ceo@cyvoriq.com",
      code: "123456",
      challengeId: "11111111-1111-4111-8111-111111111111",
      purpose: "staff",
    });
    assert.equal(result.sent, false);
    assert.equal(result.devCode, "123456");
    assert.match(result.error ?? "", /RESEND_API_KEY/);
  });

  it("sends HTML+text and does not return the code when Resend accepts", async () => {
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        html?: string;
        text?: string;
        to?: string[];
      };
      assert.equal(body.to?.[0], "ceo@cyvoriq.com");
      assert.match(body.text ?? "", /654321/);
      assert.match(body.html ?? "", /654321/);
      assert.match(body.html ?? "", /ops sign-in/);
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }) as typeof fetch;
    const result = await sendOtpEmail(env({ RESEND_API_KEY: "re_test" }), {
      email: "ceo@cyvoriq.com",
      code: "654321",
      challengeId: "22222222-2222-4222-8222-222222222222",
      purpose: "staff",
    });
    assert.equal(result.sent, true);
    assert.equal(result.id, "msg_1");
    assert.equal(result.devCode, undefined);
  });

  it("retries once on 429 then returns a preview code", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "Rate limit exceeded" }), { status: 429 });
    }) as typeof fetch;
    const result = await sendOtpEmail(env({ RESEND_API_KEY: "re_test" }), {
      email: "ceo@cyvoriq.com",
      code: "777777",
      challengeId: "33333333-3333-4333-8333-333333333333",
      purpose: "staff",
    });
    assert.equal(calls, 2);
    assert.equal(result.sent, false);
    assert.equal(result.devCode, "777777");
    assert.match(result.error ?? "", /Rate limit/);
  });
});
