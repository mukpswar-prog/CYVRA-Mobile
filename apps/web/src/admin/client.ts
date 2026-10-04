/**
 * The console's transport and its query builder.
 *
 * Deliberately not an extension of `../api.ts`. That module owns the customer
 * session and the legacy console; sharing it would mean changing a file the
 * marketing bundle imports in order to add an admin screen. This file depends
 * on `api.ts` for exactly one exported thing - `readStaffSession` - and
 * everything else it needs.
 *
 * TWO RULES BAKED INTO THIS FILE
 * -------------------------------
 * 1. It never sends `X-Admin-Email`.
 *    The legacy `adminRequest` does, for historical reasons, and the server
 *    ignores it: identity comes from the bearer token (decision E3). Sending a
 *    header the server refuses to read is a spoofing affordance with no
 *    compensating benefit, so it is simply not built here.
 *
 * 2. Server refusals are surfaced verbatim.
 *    `parseSerialQuery` refuses rather than clamps, and its sentences name the
 *    parameter, the value and the allowed set. Replacing one with a generic
 *    "something went wrong" would throw away the only explanation the operator
 *    has for why their filter came back empty.
 */
import { readStaffSession, writeStaffSession } from "../api";
import type {
  AuditListResponse,
  MeResponse,
  ReportResponse,
  SerialListResponse,
  SerialRecordResponse,
  StaffListResponse,
} from "./types";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);

/** Thrown for a refusal. Carries the status so callers can branch on 401. */
export class AdminHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminHttpError";
  }
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  const token = readStaffSession();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (headers.Accept === "text/csv") {
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new AdminHttpError(res.status, data.error ?? `Request failed (${res.status})`);
    }
    return (await res.text()) as T;
  }

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new AdminHttpError(
      res.status,
      data.error ?? `Request failed (${res.status})`,
    );
  }
  return data as T;
}

/* ------------------------------------------------------------------------ *
 * QUERY BUILDER
 * ------------------------------------------------------------------------ */

/**
 * The registry's filter state - exactly the parameters `parseSerialQuery`
 * reads, spelled the way it spells them, so a state that is "set" here is a
 * parameter the server will actually see.
 *
 * Arrays rather than objects of booleans: a multi-select filter's whole job is
 * to produce a comma list, and a `Set` in state would need converting twice.
 */
export interface SerialQueryState {
  q: string;
  status: string[];
  paymentStatus: string[];
  planCode: string[];
  customerKind: string[];
  hostBinding: string[];
  delivery: string[];
  validityEndsWithinDays: number | null;
  page: number;
  pageSize: number;
}

export const EMPTY_SERIAL_QUERY: SerialQueryState = Object.freeze({
  q: "",
  status: [],
  paymentStatus: [],
  planCode: [],
  customerKind: [],
  hostBinding: [],
  delivery: [],
  validityEndsWithinDays: null,
  page: 1,
  pageSize: 25,
});

/**
 * Serialise a filter state to a query string.
 *
 * Empty arrays are OMITTED rather than sent as `status=`. The server treats a
 * present-but-empty list as "no token", so both are equivalent there - but an
 * omitted parameter is what the response's `filters` echo will omit too, and a
 * chip's active state is derived from `filters`, not from what we hoped we
 * sent. One representation, one source of truth.
 */
export function buildSerialQuery(state: SerialQueryState): string {
  const params = new URLSearchParams();
  const q = state.q.trim();
  if (q !== "") params.set("q", q);
  for (const [key, values] of [
    ["status", state.status],
    ["paymentStatus", state.paymentStatus],
    ["planCode", state.planCode],
    ["customerKind", state.customerKind],
    ["hostBinding", state.hostBinding],
    ["delivery", state.delivery],
  ] as const) {
    if (values.length > 0) params.set(key, values.join(","));
  }
  if (state.validityEndsWithinDays !== null) {
    params.set("validityEndsWithinDays", String(state.validityEndsWithinDays));
  }
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.pageSize !== 25) params.set("pageSize", String(state.pageSize));
  return params.toString();
}

/**
 * Count-only request: `pagination.total` is the whole answer.
 *
 * The server refuses rather than clamps, and `parseSerialQuery` accepts only
 * 25, 50 or 100 (`PAGE_SIZES` in services/api/src/admin/search.ts). So the
 * smallest count this contract allows is `pageSize=25`: asking for 1 is a 400
 * that names the allowed values, and every figure in the strip therefore came
 * back as an em dash. One page of payload, the whole answer in `total`.
 *
 * This is the ONLY way the console is permitted to obtain a number. The
 * alternative - fetching pages and counting what came back - is wrong the
 * moment a page fails to load, and wrong in the direction of under-reporting,
 * which on a "Payment Pending" figure reads as "nothing needs doing".
 */
export function countSerials(query: string): Promise<SerialListResponse> {
  const params = new URLSearchParams(query);
  params.set("pageSize", "25");
  params.delete("page");
  return adminRequest<SerialListResponse>(`/admin/serials?${params.toString()}`);
}

/**
 * The audit trail's filter state, matching `parseAuditQuery` field for field.
 *
 * Two notes that are not obvious from the parameter names:
 *
 * - `action` is emitted as ONE comma-joined parameter. The server reads
 *   `params.getAll("action")` and splits each on commas, so both spellings
 *   work - but the response echoes the parsed set either way, and one
 *   parameter keeps the echo and the request able to say the same thing.
 *
 * - `from` / `to` are ISO-8601 instants, not calendar days. `readBoundary`
 *   parses them with `new Date()`, and a bare `YYYY-MM-DD` would be read as
 *   UTC midnight - which in IST silently moves the start of a range back by
 *   five and a half hours. The UI therefore sends a full instant with an
 *   explicit offset.
 */
export interface AuditQueryState {
  readonly entityId: string;
  readonly entityType: string;
  readonly actor: string;
  readonly action: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly page: number;
  readonly pageSize: number;
}

export const EMPTY_AUDIT_QUERY: AuditQueryState = Object.freeze({
  entityId: "",
  entityType: "",
  actor: "",
  action: [],
  from: "",
  to: "",
  page: 1,
  pageSize: 25,
});

export function buildAuditQuery(state: AuditQueryState): string {
  const params = new URLSearchParams();
  if (state.entityId !== "") params.set("entityId", state.entityId);
  if (state.entityType !== "") params.set("entityType", state.entityType);
  if (state.actor !== "") params.set("actor", state.actor);
  if (state.action.length > 0) params.set("action", state.action.join(","));
  if (state.from !== "") params.set("from", state.from);
  if (state.to !== "") params.set("to", state.to);
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.pageSize !== 25) params.set("pageSize", String(state.pageSize));
  return params.toString();
}

/* ------------------------------------------------------------------------ *
 * ROUTES
 * ------------------------------------------------------------------------ */

export const adminClient = {
  me: () => adminRequest<MeResponse>("/admin/me"),

  /**
   * STEP 1 of sign-in: ask for a one-time code.
   *
   * The `devCode` in the response is the server telling the *caller* the code
   * in a non-mail-configured environment. It is rendered only when the server
   * sends it, and it is never treated as a fallback: if mail is not configured
   * and no `devCode` came back there is genuinely no way in, and saying so is
   * better than offering a box that cannot be filled.
   */
  requestCode: (email: string) =>
    adminRequest<{
      challengeId: string;
      delivery: string;
      mailConfigured?: boolean;
      mailError?: string | null;
      devCode?: string;
      message: string;
    }>("/admin/auth/request", { method: "POST", body: JSON.stringify({ email }) }),

  /**
   * STEP 2: exchange the code for a bearer token.
   *
   * The token is stored before this resolves, so the very next request - which
   * is `GET /admin/me`, asked for immediately after - already carries it.
   * Nothing else in this console writes the session.
   */
  verifyCode: async (challengeId: string, code: string) => {
    const result = await adminRequest<{ operator: { email: string; superAdmin: boolean }; token: string }>(
      "/admin/auth/verify",
      { method: "POST", body: JSON.stringify({ challengeId, code }) },
    );
    writeStaffSession(result.token);
    return result;
  },

  listSerials: (query: string) =>
    adminRequest<SerialListResponse>(
      `/admin/serials${query ? `?${query}` : ""}`,
    ),

  getSerial: (serialId: string) =>
    adminRequest<SerialRecordResponse>(
      `/admin/serials/${encodeURIComponent(serialId)}`,
    ),

  patchSerial: (serialId: string, body: Record<string, unknown>) =>
    adminRequest<{ serial: SerialRecordResponse["serial"] }>(
      `/admin/serials/${encodeURIComponent(serialId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  /**
   * The twelve action routes. Keyed by action id so the row menu dispatches
   * through one table and never grows a bespoke branch per button.
   */
  confirmPayment: (serialId: string, reference?: string) =>
    post(`/admin/serials/${serialId}/confirm-payment`, reference ? { reference } : {}),
  /**
   * The Green Key Rule's exception, and it must be *asked for*.
   *
   * `waivePayment` defaults off so an accidental unpaid key is impossible: a
   * Super Admin who forgot to confirm payment gets a refusal rather than a key
   * they did not mean to mint. When it is on, the server requires a reason and
   * writes it into the audit row beside `paymentWaived: true`.
   */
  generateKey: (
    serialId: string,
    opts?: { waivePayment?: boolean; reason?: string },
  ) => post(`/admin/serials/${serialId}/generate-key`, opts ?? {}),
  issue: (serialId: string) => post(`/admin/serials/${serialId}/issue`, {}),
  resend: (serialId: string) => post(`/admin/serials/${serialId}/resend`, {}),
  suspend: (serialId: string, reason: string) =>
    post(`/admin/serials/${serialId}/suspend`, { reason }),
  revoke: (serialId: string, reason: string) =>
    post(`/admin/serials/${serialId}/revoke`, { reason }),
  requestRebind: (serialId: string, reason: string) =>
    post(`/admin/serials/${serialId}/rebind/request`, { reason }),
  /*
   * NO `approveRebind`. `POST /admin/serials/:id/rebind/approve` exists on the
   * server and `rebind:approve` exists in §41, but §14's menu is a list of
   * exactly twelve and approval is not on it - the operator asks, the host is
   * released, and the binding is made by re-activation. Adding the method here
   * anyway would advertise an affordance no screen renders, which is the same
   * shape of dishonesty §14's "never show an action that cannot be performed"
   * is guarding against, pointed at the code instead of the UI.
   */

  /**
   * The licence's own trail, scoped by the server to what this seat may see.
   * `entityId` is bound here rather than assembled by the caller, so the
   * drawer's timeline cannot be widened by a string built somewhere else.
   */
  auditFor: (serialId: string) =>
    adminRequest<AuditListResponse>(
      `/admin/audit?${buildAuditQuery({ ...EMPTY_AUDIT_QUERY, entityId: serialId })}`,
    ),

  listAudit: (query: string) =>
    adminRequest<AuditListResponse>(`/admin/audit${query ? `?${query}` : ""}`),

  activationFor: (serialId: string) =>
    adminRequest<Record<string, unknown>>(
      `/admin/serials/${encodeURIComponent(serialId)}/activation`,
    ),

  /**
   * Export as raw CSV.
   *
   * Always this route and never a client-side join of rows already on screen:
   * the server writes an `EXPORT_GENERATED` audit row for it, so an export
   * nobody can see in the trail is an export that never happened as far as
   * compliance is concerned. A file built in the browser writes nothing.
   */
  exportRecord: (serialId: string) =>
    adminRequest<string>(
      `/admin/serials/${encodeURIComponent(serialId)}/export`,
      { headers: { Accept: "text/csv" } },
    ),

  report: (from: string, to: string) =>
    adminRequest<ReportResponse>(
      `/admin/reports/licences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  reportCsv: (from: string, to: string) =>
    adminRequest<string>(
      `/admin/reports/licences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=csv`,
      { headers: { Accept: "text/csv" } },
    ),

  listStaff: () => adminRequest<StaffListResponse>("/admin/staff"),

  inviteStaff: (email: string, role: string) =>
    adminRequest<{ operator: { staffId: string; email: string; status: string; role: string }; replayed?: boolean }>(
      "/admin/staff",
      { method: "POST", body: JSON.stringify({ email, role }) },
    ),

  approveStaff: (staffId: string) => post(`/admin/staff/${staffId}/approve`, {}),
  suspendStaff: (staffId: string, reason: string) =>
    post(`/admin/staff/${staffId}/suspend`, { reason }),
  revokeStaff: (staffId: string, reason: string) =>
    post(`/admin/staff/${staffId}/revoke`, { reason }),

  logout: () => post("/admin/auth/logout", {}),
};

function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return adminRequest<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export { adminRequest };
