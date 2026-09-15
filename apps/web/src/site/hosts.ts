/** Pages / custom hosts for this Vite bundle. Never Erase hosts. */

export function isAdminHost(hostname = window.location.hostname): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return new URLSearchParams(window.location.search).get("ops") === "1";
  }
  return (
    hostname === "admin.cyvoriq.co.in" ||
    hostname === "cyvoriq-admin.pages.dev" ||
    hostname.endsWith(".cyvoriq-admin.pages.dev")
  );
}

export function isAccountsHost(hostname = window.location.hostname): boolean {
  return (
    hostname === "accounts.cyvoriq.co.in" ||
    hostname === "cyvoriq-accounts.pages.dev" ||
    hostname.endsWith(".cyvoriq-accounts.pages.dev")
  );
}
