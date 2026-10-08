const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);

const TOKEN_KEY = "cyvra_mobile_session";

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | undefined) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage can throw in locked-down iframes; cookie-only then.
  }
}

/**
 * Carries the HTTP status alongside the server's sentence.
 *
 * It extends `Error` deliberately: every existing `catch ((err as Error).message)`
 * call site keeps working unchanged, while callers that must tell 401 from 404
 * from 503 can now do so instead of pattern-matching prose. Without this the
 * dashboard could not distinguish "signed out" from "no licence yet" from
 * "the server is down" - three different things to show a customer.
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * The parsed error body, when the server sent one.
   *
   * `POST /v1/licence-requests` answers 429 with `requestedAt` *inside* the
   * refusal, so a client whose retry arrived after a request that had already
   * landed can render "submitted" rather than a failure. Reading that back
   * requires the body to survive the throw, which is what this field is for.
   * Optional on purpose: callers that only need the status are unaffected.
   */
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? `Request failed (${res.status})`,
      res.status,
      data as unknown as Record<string, unknown>,
    );
  }
  return data as T;
}

export interface RequestOtpResponse {
  challengeId: string;
  delivery: "email" | "dev-log";
  mailConfigured?: boolean;
  mailError?: string | null;
  devCode?: string;
  message: string;
}

/**
 * The issuable plan slabs. Mirrors `ISSUABLE_SLABS` in
 * `services/api/src/licenceKey.ts`; `POST /auth/request` rejects anything else
 * with "Plan must be a device count of 1, 5, 10, 25, 50."
 *
 * `3` and `7` are valid *licence* slabs but deliberately absent here: they are
 * not issuable to a customer choosing a plan for themselves.
 */
export const PLAN_SLABS = [1, 5, 10, 25, 50] as const;

export type PlanSlab = (typeof PLAN_SLABS)[number];

export interface RegistrationInput {
  fullName: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  pincode: string;
  state: string;
  email: string;
  /**
   * The device count the customer chose.
   *
   * Without this field the server's `parsePlan(undefined)` returns
   * `REGISTRATION_DEFAULT_SLAB` (1) and every registration silently becomes a
   * one-device licence. The value is snapshotted onto `email_otp_challenges`
   * when the code is requested, so it cannot change between asking for a code
   * and entering it, and `/auth/verify` then hands it to the licence bridge.
   */
  plan: PlanSlab;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string | null;
  companyName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  pincode?: string | null;
  state?: string | null;
}

/** `/build-manifest.json`, returned by `GET /v1/me/entitlement` as `build`. */
export interface BuildManifest {
  _readme?: string;
  /**
   * `"unavailable"` until a release job has actually published an installer.
   * A null `version` therefore means *no build has ever been released*, not
   * "version unknown" - the dashboard must say so rather than print a guess.
   */
  state: string;
  version: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  url: string | null;
  releasedAt: string | null;
}

/**
 * The body of `GET /v1/me/entitlement`, mirroring `projectEntitlement` in
 * `services/api/src/entitlement.ts`.
 *
 * Note what is **absent**: no `scansUsed`, no `scansRemaining`, no revision.
 * Scan debits stay gated behind the R-1 ruling, so `usage.scans` reports a
 * state rather than a quantity - a constant on purpose, so no code path can
 * put a number there by accident. The dashboard renders that state; it does
 * not invent arithmetic to fill the space where a number used to be.
 */
export interface Entitlement {
  customer: { companyName: string | null; email: string };
  plan: { code: string; slab: string | null; label: string };
  licence: { status: string; sentence: string; maskedSerial: string | null };
  payment: { state: "known" | "unknown"; status: string | null; sentence: string | null };
  validity: { state: "window" | "unknown"; startsAt: string | null; endsAt: string | null };
  usage: {
    activation: { activatedAt: string | null; hostBinding: string };
    scans: { state: string };
  };
  build: BuildManifest;
  /**
   * WS-K3 (spec 10, "Request date/time") - when this customer submitted a
   * licence request from the Workspace.
   *
   * `null` means "never requested", which is a real answer and not a missing
   * field: the server distinguishes the two on purpose, so a dashboard can say
   * "you have not asked yet" rather than showing a blank.
   */
  requestedAt: string | null;
}

/**
 * A discriminated union instead of a thrown error, so the dashboard cannot
 * forget one of the cases and quietly fall back to placeholder data - which is
 * precisely how the mock survived as long as it did.
 *
 * - `unauthenticated` - 401. The session is gone; sign in again.
 * - `no-licence`      - 404 "Licence not found." Signed in, no record yet.
 * - `unavailable`     - 503. We could not *establish* a record; this says
 *                       nothing about whether one exists. Never rendered as 404.
 * - `failed`          - network failure or an unexpected status.
 */
export type EntitlementResult =
  | { kind: "ok"; entitlement: Entitlement }
  | { kind: "unauthenticated"; message: string }
  | { kind: "no-licence"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "failed"; message: string };

/**
 * Human sentence for `usage.scans.state`, whose value is
 * `"available-after-first-scan"` (`SCANS_STATE` in the API).
 */
export function scansStateSentence(state: string): string {
  if (state === "available-after-first-scan") return "Available after first scan";
  return state.replace(/-/g, " ");
}

/**
 * What the Workspace's purchase form submits (WS-K3, spec 9).
 *
 * Deliberately carries **no** payment field and no status: spec 11 says a
 * "Payment Done" note is a customer declaration that authorises nothing, and
 * spec 3 step 3 says payment is recorded by the authorised business. There is
 * no code path that could accept it from here.
 *
 * `email` is absent as well - the server overwrites whatever it is given with
 * the session's address, so sending one would only invite a false belief that
 * the client decides whose request this is.
 */
export interface LicenceRequestInput {
  /** The form's single "Customer / company name" field, as spec 9 labels it. */
  fullName: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string | null;
  pincode: string;
  state: string;
  plan: PlanSlab;
}

/** The server's answer: an ISO-8601 stamp of when the request was recorded. */
export interface LicenceRequestResult {
  status: "SUBMITTED";
  requestedAt: string;
}

export const api = {
  health: () =>
    request<{
      status: string;
      database: string;
      mailConfigured?: boolean;
      mailFromHost?: "cyvoriq.co.in" | "cyvra.co.in" | "other" | "unset";
    }>("/health"),
  requestOtp: (profile: RegistrationInput) =>
    request<RequestOtpResponse>("/auth/request", {
      method: "POST",
      body: JSON.stringify(profile),
    }),
  verifyOtp: async (challengeId: string, code: string) => {
    const data = await request<{ user: AuthUser; isNewUser: boolean; token?: string }>(
      "/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({ challengeId, code }),
      },
    );
    writeToken(data.token);
    return data;
  },
  me: () => request<{ user: AuthUser | null }>("/me"),
  logout: async () => {
    const result = await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
    writeToken(undefined);
    return result;
  },
  reportSessions: () =>
    request<{ sessions: ReportSession[] }>("/reports/sessions"),
  listReports: () =>
    request<{ title: string; reports: ReportSummary[] }>("/reports"),
  getReport: (reportId: string) => request<ReportDetail>(`/reports/${reportId}`),
  freezeReport: (processingSessionId: string) =>
    request<FreezeResult>("/reports/freeze", {
      method: "POST",
      body: JSON.stringify({ processingSessionId }),
    }),
  getLicense: () =>
    request<{
      licenseId: string;
      serialNumber: string;
      customerEmail: string;
      customerName: string | null;
      companyName: string | null;
      planName: string;
      deviceScanEntitlement: number;
      scansUsed: number;
      scansRemaining: number;
      revision: number;
      status: "ACTIVE" | "EXPIRED" | "REVOKED" | "SUPERSEDED" | "SERVER_UNAVAILABLE";
      lastVerifiedAt: string;
    }>("/license"),
  /**
   * The customer's real entitlement - the only source the dashboard is allowed
   * to show for plan, status, usage and build.
   *
   * Never throws: every outcome is a `kind` the UI must render explicitly, so
   * there is no code path that can silently substitute mock values. 401, 404
   * and 503 are three different states and are kept apart on purpose - a
   * transient 503 must never be shown as "you have no licence".
   */
  entitlement: async (): Promise<EntitlementResult> => {
    try {
      return {
        kind: "ok",
        entitlement: await request<Entitlement>("/v1/me/entitlement"),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Entitlement is unavailable.";
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) return { kind: "unauthenticated", message };
      if (status === 404) return { kind: "no-licence", message };
      if (status === 503) return { kind: "unavailable", message };
      return { kind: "failed", message };
    }
  },
  /**
   * WS-K3 - the purchase form's submit (spec 9/10), replacing the honesty
   * notice that used to say no endpoint existed.
   *
   * Throws like every other writer, so the shell decides what a refusal looks
   * like - with one deliberate exception: **429 is not a failure.** The server
   * refuses a second request inside its rate-limit window and sends the
   * original stamp back inside the refusal. Rendering that as a red error would
   * tell a customer their request failed at the exact moment it had in fact
   * succeeded, which is what a lost response plus a retry produces.
   */
  licenceRequest: async (input: LicenceRequestInput): Promise<LicenceRequestResult> => {
    try {
      return await request<LicenceRequestResult>("/v1/licence-requests", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const stamp = err.details.requestedAt;
        if (typeof stamp === "string") {
          return { status: "SUBMITTED", requestedAt: stamp };
        }
      }
      throw err;
    }
  },
};

export interface ReportSession {
  processingSessionId: string;
  deviceLifecycleId: string;
  createdAt: string;
  manufacturer: string | null;
  model: string | null;
}

export interface ReportSummary {
  reportId: string;
  publicNumber: string;
  processingSessionId: string;
  deviceLifecycleId: string;
  coverage: "COMPLETE" | "LIMITED" | "PARTIAL";
  coverageCaption?: string;
  frozenAt: string;
}

export interface ReportEntry {
  testId: string;
  evidenceId: string;
  result: string;
  source: string;
  userName: string;
  objectiveName: string;
  domain: string;
  domainLabel: string;
}

export interface ReportDetail {
  title: string;
  reportId: string;
  publicNumber: string;
  coverage: "COMPLETE" | "LIMITED" | "PARTIAL";
  coverageCaption: string;
  frozenAt: string;
  deviceLifecycleId?: string | null;
  processingSessionId?: string | null;
  entries: ReportEntry[];
  nongoals: string[];
}

const ADMIN_TOKEN_KEY = "cyvra_mobile_admin_token";
const ADMIN_EMAIL_KEY = "cyvra_mobile_admin_email";
const STAFF_SESSION_KEY = "cyvra_mobile_staff_session";

export function readAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeAdminToken(token: string) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // ignore locked storage
  }
}

export function readStaffSession(): string {
  try {
    return sessionStorage.getItem(STAFF_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStaffSession(token: string) {
  try {
    if (token) sessionStorage.setItem(STAFF_SESSION_KEY, token);
    else sessionStorage.removeItem(STAFF_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function readAdminEmail(): string {
  try {
    return sessionStorage.getItem(ADMIN_EMAIL_KEY) ?? "ceo@cyvoriq.com";
  } catch {
    return "ceo@cyvoriq.com";
  }
}

export function writeAdminEmail(email: string) {
  try {
    sessionStorage.setItem(ADMIN_EMAIL_KEY, email);
  } catch {
    // ignore
  }
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const staff = readStaffSession();
  const token = staff || readAdminToken();
  const email = readAdminEmail();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Admin-Email": email,
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if ((init?.headers as Record<string, string> | undefined)?.Accept === "text/csv") {
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Request failed (${res.status})`);
    }
    return (await res.text()) as T;
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export interface MobileSerial {
  serialId: string;
  publicNumber: string;
  licenceKey: string;
  status: string;
  customerKind: string;
  deviceMax: number;
  slabLabel: string;
  brandScope: string;
  customerEmail: string;
  customerFullName: string | null;
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
  state: string | null;
  paymentNoted: string;
  devicesBound: number;
  /** Who created the row. `null` on pre-W5 rows, where the value was destroyed. */
  createdBy: string | null;
  /**
   * `string | null` because `jsonSerial` withholds it until `issued_at` exists:
   * an unissued record has no issuer to name.
   */
  issuedBy: string | null;
  issuedAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  emailedAt: string | null;
  emailMessageId: string | null;
  emailError: string | null;
}

export interface LicenceDraft {
  customerEmail: string;
  paymentNoted: string;
  customerKind: "SINGLE" | "BULK";
  deviceMax: 1 | 3 | 5 | 7 | 25;
  brandScope: string;
  customerFullName: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  pincode: string;
  state: string;
}

export const adminApi = {
  requestStaffCode: (email: string) =>
    adminRequest<{
      challengeId: string;
      delivery: string;
      mailConfigured?: boolean;
      mailError?: string | null;
      devCode?: string;
      message: string;
    }>(
      "/admin/auth/request",
      { method: "POST", body: JSON.stringify({ email }) },
    ),
  verifyStaffCode: async (challengeId: string, code: string) => {
    const result = await adminRequest<{
      operator: { email: string; superAdmin: boolean };
      token: string;
    }>("/admin/auth/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId, code }),
    });
    writeStaffSession(result.token);
    writeAdminEmail(result.operator.email);
    return result;
  },
  logoutStaff: () => {
    writeStaffSession("");
    return adminRequest<{ ok: boolean }>("/admin/auth/logout", { method: "POST" });
  },
  me: () =>
    adminRequest<{ email: string; superAdmin: boolean; superAdminEmail: string }>("/admin/me"),
  listStaff: () =>
    adminRequest<{
      operators: {
        staffId: string;
        email: string;
        status: string;
        nominatedBy: string;
        nominatedAt: string | null;
        revokedAt: string | null;
      }[];
    }>("/admin/staff"),
  nominateStaff: (email: string) =>
    adminRequest<{ operator: { email: string; status: string } }>("/admin/staff", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  revokeStaff: (staffId: string) =>
    adminRequest(`/admin/staff/${staffId}/revoke`, { method: "POST" }),
  listSerials: () =>
    adminRequest<{ superAdmin: string; actor: string; serials: MobileSerial[] }>(
      "/admin/serials",
    ),
  createSerial: (draft: LicenceDraft) =>
    adminRequest<{ serial: MobileSerial }>("/admin/serials", {
      method: "POST",
      body: JSON.stringify(draft),
    }),
  issueSerial: (serialId: string) =>
    adminRequest<{ serial: MobileSerial; replayed: boolean; emailed?: boolean }>(
      `/admin/serials/${serialId}/issue`,
      { method: "POST" },
    ),
  revokeSerial: (serialId: string) =>
    adminRequest<{ serial: MobileSerial; replayed: boolean }>(
      `/admin/serials/${serialId}/revoke`,
      { method: "POST" },
    ),
  licenceReport: (from: string, to: string) =>
    adminRequest<{ count: number; rows: MobileSerial[]; from: string; to: string }>(
      `/admin/reports/licences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  licenceReportCsv: (from: string, to: string) =>
    adminRequest<string>(
      `/admin/reports/licences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=csv`,
      { headers: { Accept: "text/csv" } },
    ),
};

export interface FreezeResult {
  title: string;
  reportId: string;
  publicNumber: string;
  coverage: "COMPLETE" | "LIMITED" | "PARTIAL";
  coverageCaption?: string;
  frozenAt: string;
  replayed: boolean;
}
