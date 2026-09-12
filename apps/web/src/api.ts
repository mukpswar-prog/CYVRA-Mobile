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
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
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

export interface RegistrationInput {
  fullName: string;
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  pincode: string;
  state: string;
  email: string;
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
  issuedBy: string;
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
