const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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

export interface AuthUser {
  id: string;
  email: string;
}

export const api = {
  health: () => request<{ status: string; database: string }>("/health"),
  requestOtp: (email: string) =>
    request<RequestOtpResponse>("/auth/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyOtp: (challengeId: string, code: string) =>
    request<{ user: AuthUser; isNewUser: boolean }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId, code }),
    }),
  me: () => request<{ user: AuthUser | null }>("/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};
