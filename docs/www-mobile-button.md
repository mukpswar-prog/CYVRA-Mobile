# www.cyvra.co.in — thin CYVRA Mobile button (do not merge OTP)

Live Windows SPA: https://www.cyvra.co.in/  
Bundle: `/assets/index-zGcBCW9N.js` (Pages `cyvra-www`). Auth talks to
**`https://api.cyvra.co.in`**. Copy already says Erase OTP stays on that control
plane.

Resend domain **`cyvra.co.in` is already Verified** (same account, ~12 days).
Windows OTP and Mobile OTP can both send from that domain. They must **not**
share the Windows Worker, cookie, or licence tables.

## Do not do this

| Idea | Why not |
| --- | --- |
| Add a Mobile OTP form on www that calls `api.cyvra.co.in` | That is Erase. Mobile users/sessions live in Neon `floral-art-02749206`. |
| Copy Windows Get Started / OTP into a second panel on the same page | Guideline §7: Windows Get Started / OTP / download **untouched**. |
| Put `DATABASE_URL` or Resend on Pages `cyvra-www` | Secrets stay on Workers. |
| Point mobile customers at `api.cyvra.co.in` | Frozen. Mobile API is `cyvra-mobile-api`. |
| Rebuild the hero, reports, or download flow | Out of scope. |

## Do this (smallest www change)

Product story: **Windows | Mobile | Tablet** as equal journeys. Two origins.

On `cyvra-www` only (Erase repo, not this repo):

1. Nav (and optionally hero chips): three controls. **Windows** stays current
   page / current Get Started.
2. **CYVRA Mobile** is a link, not a new OTP modal:
   `https://mobile.cyvra.co.in` (until DNS exists: `https://cyvra-mobile.pages.dev`).
3. **Tablet** is the same origin with `?device=tablet`.
4. One line of copy: Samsung-compatible, in development. No Knox / IMEI / SOH.
5. Footer “Mobile: +91 …” is a **phone number**. Do not reuse that word for the
   product button.

That is a nav/link patch. The existing Create Account → email OTP → download
Windows package path does not change.

## Where OTP is generated

| Journey | Site | API | Resend | Database |
| --- | --- | --- | --- | --- |
| Windows Erase (today) | `www.cyvra.co.in` | `api.cyvra.co.in` | already sending | Erase DB |
| CYVRA Mobile | `mobile.cyvra.co.in` | `cyvra-mobile-api` | same verified domain `cyvra.co.in`, From `CYVRA Mobile <noreply@cyvra.co.in>` | Neon `floral-art-02749206` |

Same email address is allowed. **Not** the same cookie. Tell customers the
logins are separate until a later join.

Mobile OTP is already implemented (`POST /auth/request` + `/auth/verify`).
Turn it on by putting `RESEND_API_KEY` on Worker `cyvra-mobile-api` (domain is
verified). Keep `API_ENV=preview` until a real email arrives.

## Other “CYVRA Mobile” button (not www)

Ops serial keys: **CYVRA Mobile** section on `admin.cyvra.co.in` /
`accounts.cyvra.co.in` — [admin-mobile-section.md](./admin-mobile-section.md).
That is not the public www nav. Do not mix the two.

## Order

1. Finish mobile Worker Resend secrets (this repo / dashboard). Test OTP on
   `https://cyvra-mobile.pages.dev`.
2. Attach `mobile.cyvra.co.in` when you are ready.
3. **Last:** tiny `cyvra-www` nav patch in the Erase website repo. Do not start
   that until mobile registration emails work.
