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
  health: () => request<{ status: string; database: string }>("/health"),
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
  const token = readAdminToken();
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
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export interface MobileSerial {
  serialId: string;
  publicNumber: string;
  status: string;
  customerEmail: string;
  paymentNoted: string;
  issuedBy: string;
  issuedAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
}

export const adminApi = {
  listSerials: () =>
    adminRequest<{ superAdmin: string; actor: string; serials: MobileSerial[] }>(
      "/admin/serials",
    ),
  createSerial: (customerEmail: string, paymentNoted: string) =>
    adminRequest<{ serial: MobileSerial }>("/admin/serials", {
      method: "POST",
      body: JSON.stringify({ customerEmail, paymentNoted }),
    }),
  issueSerial: (serialId: string) =>
    adminRequest<{ serial: MobileSerial; replayed: boolean }>(
      `/admin/serials/${serialId}/issue`,
      { method: "POST" },
    ),
  revokeSerial: (serialId: string) =>
    adminRequest<{ serial: MobileSerial; replayed: boolean }>(
      `/admin/serials/${serialId}/revoke`,
      { method: "POST" },
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
