import { useState } from "react";
import {
  adminApi,
  readAdminEmail,
  readAdminToken,
  writeAdminEmail,
  writeAdminToken,
  type MobileSerial,
} from "./api";

/**
 * Serials console for admin.cyvoriq.co.in.
 * Token stays in sessionStorage. Never commit it.
 */
export function OpsTest() {
  const [token, setToken] = useState(readAdminToken());
  const [email, setEmail] = useState(readAdminEmail());
  const [customerEmail, setCustomerEmail] = useState("");
  const [paymentNoted, setPaymentNoted] = useState("");
  const [serials, setSerials] = useState<MobileSerial[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function persist() {
    writeAdminToken(token);
    writeAdminEmail(email);
  }

  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    persist();
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signed-in">
      <h2>Mobile serials</h2>
      <p className="muted small">
        Super admin is <code>ceo@cyvoriq.com</code>. Type{" "}
        <code>ADMIN_API_TOKEN</code> from Worker <code>cyvra-mobile-api</code>{" "}
        (browser only — never Pages, never chat). Refresh the list first.
        Create PENDING only after a real payment note. Issue once. Revoke if
        needed. This is not a payment gateway.
      </p>

      <label htmlFor="adminToken">ADMIN_API_TOKEN</label>
      <input
        id="adminToken"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />

      <label htmlFor="adminEmail">X-Admin-Email</label>
      <input
        id="adminEmail"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <div className="admin-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const list = await adminApi.listSerials();
              setSerials(list.serials);
              setNotice(`Listed ${list.serials.length} serials`);
            })
          }
        >
          Refresh list
        </button>
      </div>

      <label htmlFor="customerEmail">Customer email</label>
      <input
        id="customerEmail"
        type="email"
        value={customerEmail}
        onChange={(e) => setCustomerEmail(e.target.value)}
      />

      <label htmlFor="paymentNoted">Payment noted (human text, not a gateway)</label>
      <input
        id="paymentNoted"
        value={paymentNoted}
        onChange={(e) => setPaymentNoted(e.target.value)}
        placeholder="e.g. UPI transferred 2026-09-11"
      />

      <div className="admin-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const created = await adminApi.createSerial(customerEmail, paymentNoted);
              setNotice(`Created ${created.serial.publicNumber} (${created.serial.status})`);
              const list = await adminApi.listSerials();
              setSerials(list.serials);
            })
          }
        >
          Create PENDING
        </button>
      </div>

      {notice && <p className="dev-code">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <ul className="session-list">
        {serials.map((serial) => (
          <li key={serial.serialId}>
            <div>
              <strong>{serial.publicNumber}</strong>
              <div className="muted small">
                {serial.status} · {serial.customerEmail}
              </div>
            </div>
            {serial.status === "PENDING" ? (
              <button
                type="button"
                className="btn btn-primary compact"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const issued = await adminApi.issueSerial(serial.serialId);
                    setNotice(
                      `${issued.serial.publicNumber} issued${issued.replayed ? " (replay)" : ""}`,
                    );
                    const list = await adminApi.listSerials();
                    setSerials(list.serials);
                  })
                }
              >
                Issue
              </button>
            ) : serial.status === "ISSUED" ? (
              <button
                type="button"
                className="btn btn-ghost compact"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const revoked = await adminApi.revokeSerial(serial.serialId);
                    setNotice(`${revoked.serial.publicNumber} revoked`);
                    const list = await adminApi.listSerials();
                    setSerials(list.serials);
                  })
                }
              >
                Revoke
              </button>
            ) : (
              <span className="muted small">revoked</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
