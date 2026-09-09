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
};
