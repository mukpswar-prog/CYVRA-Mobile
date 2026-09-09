# CYVRA Mobile section on existing admin hosts (G7)

Freeze plan (9 Sep 2026): serial-key approval for mobile uses the **same**
admin and accounts panels as Windows. No second login. No new admin subdomain.

| Host | Role |
|---|---|
| https://admin.cyvra.co.in/ | Ops. Add a **CYVRA Mobile** button/section. |
| https://accounts.cyvra.co.in/ | Accounts. Same section pattern. |
| Super admin | `ceo@cyvoriq.com` (and users that person has approved) |

The button opens a different part of the **existing** app. Issue and approve
mobile serial keys the same way Windows keys are issued today, after payment
has transferred. Mobile serial **records** live in Neon
`floral-art-02749206` via Worker `cyvra-mobile-api`. Do not copy Erase licence
tables. Do not point mobile customers at `api.cyvra.co.in`.

This repository (`CYVRA-Mobile`) does not contain the Windows admin frontend.
The Erase `admin-frontend` change is a thin nav + views that call
`cyvra-mobile-api` with the **existing** admin session. CORS already allowlists
`admin.cyvra.co.in` and `accounts.cyvra.co.in`.

Customer registration stays on `mobile.cyvra.co.in` / `cyvra-mobile.pages.dev`.
