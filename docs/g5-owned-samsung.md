# G5 — one owned Samsung (you run this)

G7 inbox proof is done. Customer and ops OTP land in real inboxes.
Keep `API_ENV=preview`. Do not start Station or Knox.
Do not Create PENDING with dummy payment on live.

This gate is **G5-A**: Windows host + USB + controlled ADB + **one owned Samsung**.
The APK is a supporting component (install later). Share
`cyvra-g5-batch.json` only from a real device, then `POST` that file to
`https://api.cyvoriq.co.in/evidence/batches` as the **customer** you
already signed in as.

Freeze: [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md).
Do not treat emulator compile as OEM compatibility.

USB file copy is **not** device authorization. No IMEI. No Knox.
Do not paste the session token, the JSON, or OTP codes in chat.

---

## What you need

| Item | Why |
|---|---|
| Windows laptop with **Android Studio** configured | First-run: [android-studio-laptop.md](./android-studio-laptop.md). Codespaces cannot build `:app` |
| This repo on the laptop, branch `cursor/g0-g3-mobile-slice-7474` | Same code that just deployed |
| **One Samsung you own** and can unlock | Owner PIN/password/biometric only |
| Git Bash (ships with Git for Windows) | Runs `scripts/post-g5-batch.sh` |
| The customer session on `https://cyvoriq.co.in/dashboard` | Not the ops admin login |

If the lock is unknown: **stop**. No bypass.

---

## Step 1 — Pull the branch on the laptop

In Git Bash, in the repo folder:

```bash
git checkout cursor/g0-g3-mobile-slice-7474
git pull
```

You should see recent commits including the Resend runbook.

---

## Step 2 — Open the Android project in Android Studio

If Studio is newly installed, do the full first-run in
[android-studio-laptop.md](./android-studio-laptop.md) (SDK Platform 35,
JDK 21, open `apps/android`, prove `:app:assembleDebug`). Then return here.

If that is already done:

1. **File → Open** → folder `apps/android` (not the monorepo root).
2. Confirm Gradle shows **`:app`** and `local.properties` has `sdk.dir=`.
   Do not commit that file.

---

## Step 3 — Build the debug APK

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Or in Git Bash:

```bash
cd apps/android
./gradlew.bat :app:assembleDebug
```

Success file:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Application id is `co.in.cyvra.mobile`. This is a debug S1 scaffold, not a
Play Store build and not a sanitization tool.

---

## Step 4 — Put the APK on the owned Samsung

1. Unlock the phone with the **owner’s** credentials.
2. Copy `app-debug.apk` onto the phone (USB file copy, Drive, or email).
   USB debugging can stay **off**.
3. On the phone: open the file → **Install**. Allow install from that
   source if Android asks.
4. Open **CYVRA Mobile Evidence**.

Expected on screen:

- Title `CYVRA Mobile Evidence`
- `S1 planned batch — not a sanitization report.`
- `Build: <manufacturer> <model> / SDK <number>`
- `Android ID (not IMEI):` a hex string
- `PASS count: 0` (must stay 0)
- `Saved files/cyvra-g5-batch.json`
- A list of catalog rows with planned results (not live camera grades)

If you see an IMEI, Knox enrollment, or a lock-bypass screen: **stop** and
tell me. That is the wrong app.

---

## Step 5 — Share the batch JSON to the laptop

1. Tap **Share batch JSON**.
2. Send it to yourself (Gmail, Drive, Nearby Share).
3. On the laptop, save it as `cyvra-g5-batch.json` in the repo root
   (same folder as `package.json`), or in Downloads.
4. Open the file in Notepad. Confirm it is JSON and starts with `{`.
   Confirm there is **no** IMEI field with a real number. Close the file.

USB copy of this JSON is still not authorization. The Worker only accepts
it with a **customer** session.

---

## Step 6 — Copy the customer session (not the ops token)

Stay signed in at `https://cyvoriq.co.in/dashboard` as the customer who
already received the OTP (the account that shows **You're signed in**).

Do **not** use `https://admin.cyvoriq.co.in/`.
Do **not** use Worker secret `ADMIN_API_TOKEN`.

In Chrome or Edge on that dashboard tab:

1. Press `F12`.
2. Open **Application**.
3. **Session Storage** → `https://cyvoriq.co.in`.
4. Click key `cyvra_mobile_session`.
5. Copy the value into a password manager or a local env var only.

Do not paste that value in chat, email, or a GitHub issue.

If the key is missing: sign out, sign in again at
`https://cyvoriq.co.in/sign-in`, then repeat. The token lives in
sessionStorage, so a new tab on the same origin after a refresh is fine;
a different browser profile is a different session.

---

## Step 7 — POST the batch to the live API

In **Git Bash**, from the repo root. Replace the path if your JSON is in
Downloads. Paste the token only into this terminal.

```bash
export API_URL=https://api.cyvoriq.co.in
export CYVRA_SESSION_TOKEN='paste-customer-session-here'
bash scripts/post-g5-batch.sh --live ./cyvra-g5-batch.json
```

Expected:

```text
[g5] POST https://api.cyvoriq.co.in/evidence/batches (token not printed)
[g5] HTTP 200
```

The script prints the JSON body (ids only). It never prints the token.

| Result | Meaning |
|---|---|
| HTTP 200 | Batch accepted. Go to Step 8. |
| HTTP 401 | Wrong or expired customer session. Repeat Step 6. |
| HTTP 400 mentioning IMEI | JSON claimed IMEI PASS. Do not edit it to fake a pass. Tell me. |
| Script refuses without `--live` | You omitted `--live` or `API_URL` is not `https://api.cyvoriq.co.in`. |

---

## Step 8 — Confirm the dashboard session

1. Refresh `https://cyvoriq.co.in/dashboard`.
2. **Processing sessions** should list the Samsung manufacturer + model
   instead of “No sessions yet.”
3. **Stop here.** Do **not** click **Freeze Report 1** until that next
   slice. Do not flip `API_ENV`. Do not open Station or Knox.

Reply with only: HTTP status (200/401/400) and whether the dashboard
shows a session row. Do not paste the token or the JSON.

---

## Do not

- Use a phone you do not own, or one whose lock you do not know
- Enable Knox / UEM, collect IMEI, or root
- POST with `ADMIN_API_TOKEN` or an ops staff session
- Flip Worker `API_ENV` to `production` in this slice
- Create a licence PENDING with dummy payment text
- Polish `www.cyvoriq.co.in`
- Start Station
