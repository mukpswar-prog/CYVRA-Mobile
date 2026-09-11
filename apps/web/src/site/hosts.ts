/** Pages / custom hosts for this Vite bundle. Never Erase hosts. */

export function isAdminHost(hostname = window.location.hostname): boolean {
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
