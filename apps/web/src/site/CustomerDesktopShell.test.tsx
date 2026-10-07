/**
 * WS-K1-01 COMPLIANCE HOTFIX - PHASE 0.
 * =====================================
 *
 * The Chief Engineer's order asked for three assertions. Each one exists
 * because a grep cannot make it on its own.
 *
 * (a) NO CERTIFICATE WHILE BLOCKED - the defect was not that a string existed,
 *     it was that three `setTimeout`s could *produce* an erasure certificate.
 *     So this drives the whole operator workflow (pre-scan -> authorization ->
 *     method selection) and then checks the certificate tab, because "there is
 *     no button" is only meaningful if every button that could have existed has
 *     been offered and declined.
 *
 * (b) UI SHOWS THE BLOCKED TEXT - `BLOCKED_NOT_IMPLEMENTED` in source proves
 *     nothing to the customer standing at the screen. The banner has to carry
 *     the status and the plain-language limitation.
 *
 * (c) IST FORMATTER - the two renders previously used `toLocaleString()`, which
 *     takes the zone from the *browser*. A customer outside India saw a
 *     different calendar date for the same session than the admin did, which is
 *     exactly the §58 inconsistency §58's last line forbids. The assertion pins
 *     §19's worked example character for character, because a formatter that is
 *     merely "some IST format" can still drift on the punctuation.
 *
 * Out of scope, deliberately: device-connection state (WS-K1-02) and the
 * installer card (WS-K1-04). Those remain frozen under E15.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ADMIN_TIME_ZONE, formatDateTime } from "../admin/format/datetime";
import { CustomerDesktopShell } from "./CustomerDesktopShell";

const noop = () => {};

function renderShell(overrides: Partial<Parameters<typeof CustomerDesktopShell>[0]> = {}) {
  return render(
    <CustomerDesktopShell
      user={{ id: "u-1", email: "customer@example.com", fullName: "Test Customer" }}
      entitlement={null}
      sessions={[]}
      reports={[]}
      reportDetail={null}
      busy={false}
      onFreezeSession={noop}
      onOpenReport={noop}
      onCloseReport={noop}
      onLogout={noop}
      {...overrides}
    />,
  );
}

/** Opens the purge surface and walks it as far as the build allows. */
function walkPurgeWorkflow() {
  fireEvent.click(screen.getByRole("button", { name: /DATA PURGE/ }));
  fireEvent.click(screen.getByRole("button", { name: /Proceed to 2-Step Authorization/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /I acknowledge that device media will be purged/ }));
  fireEvent.change(screen.getByPlaceholderText("Type CONFIRM PURGE"), {
    target: { value: "CONFIRM PURGE" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Unlock Sanitization Execution/ }));
}

describe("WS-K1-01: the purge surface reports the provider's real status", () => {
  it("shows BLOCKED_NOT_IMPLEMENTED and its plain-language limitation", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /DATA PURGE/ }));

    const banner = screen.getByTestId("purge-blocked-banner");
    expect(banner.dataset.purgeStatus).toBe("BLOCKED_NOT_IMPLEMENTED");
    expect(screen.getByText("Purging is not yet enabled for this build.")).toBeTruthy();
    expect(
      screen.getByText(/there is no validated sanitization provider for this device target/i),
    ).toBeTruthy();

    // The status must name its source, so the customer can see this is the
    // engine speaking and not a UI preference.
    expect(screen.getByText(/Host sanitization engine/)).toBeTruthy();
    expect(screen.getByText(/D-1 \/ OUTCOME B/)).toBeTruthy();

    // Steps 4 and 5 are unreachable and must not read as pending work.
    expect(screen.getByTestId("purge-step-4-blocked").textContent).toContain(
      "BLOCKED_NOT_IMPLEMENTED",
    );
  });

  it("offers no execution control anywhere in the workflow", () => {
    renderShell();
    walkPurgeWorkflow();

    expect(screen.getByTestId("purge-execute-blocked")).toBeTruthy();
    expect(screen.getByTestId("purge-execute-blocked").dataset.purgeStatus).toBe(
      "BLOCKED_NOT_IMPLEMENTED",
    );
    expect(screen.queryByRole("button", { name: /Execute Sanitization/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate Final/ })).toBeNull();
  });
});

describe("WS-K1-01: no certificate artifact is producible while BLOCKED", () => {
  it("keeps the certificate tab blocked after the full workflow is driven", () => {
    renderShell();
    walkPurgeWorkflow();

    // Walk back out again so every control in the view has been exercised.
    fireEvent.click(screen.getByRole("button", { name: /Back to Authorization/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));

    fireEvent.click(screen.getByRole("button", { name: /RESULTS & REPORTS/ }));
    fireEvent.click(screen.getByRole("button", { name: /NIST Sanitization Certificate/ }));

    const cert = screen.getByTestId("sanitization-cert-blocked");
    expect(cert.dataset.purgeStatus).toBe("BLOCKED_NOT_IMPLEMENTED");
    expect(screen.getByText(/No erasure certificate is issued by this build/)).toBeTruthy();
    expect(screen.getByText(/— \(none exists\)/)).toBeTruthy();

    // Nothing to download, nothing to print, no document to hand over.
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Print/ })).toBeNull();
    expect(screen.queryByText(/CYVRA DATA SANITIZATION & VERIFICATION CERTIFICATE/)).toBeNull();
    expect(screen.queryByText(/SEALED & IMMUTABLE/)).toBeNull();
    expect(screen.queryByText(/COMPLIANT/)).toBeNull();
  });

  it("never claims a NIST assurance level on any rendered surface", () => {
    renderShell();
    walkPurgeWorkflow();
    fireEvent.click(screen.getByRole("button", { name: /RESULTS & REPORTS/ }));
    fireEvent.click(screen.getByRole("button", { name: /NIST Sanitization Certificate/ }));

    // Every rendered string, flattened: no success status, no assurance string,
    // no hard-coded digest may appear anywhere in the DOM.
    const flat = document.body.textContent ?? "";
    expect(flat).not.toContain("SUCCESS_VERIFIED");
    expect(flat).not.toContain("NIST_SP_800_88");
    expect(flat).not.toContain("CYVRA-CERT");
    expect(flat).not.toContain("c4f92d8e578a10b91e92da94017a421b9c7e0984a92e1059f03d162812ef6412");
  });
});

describe("section 58: the customer dashboard renders IST, not the browser's zone", () => {
  it("pins section 19's worked example character for character", () => {
    // 04:12Z is 09:42 IST. §19 shows `05-Oct-2026 09:42 IST`.
    expect(ADMIN_TIME_ZONE).toBe("Asia/Kolkata");
    expect(formatDateTime("2026-10-05T04:12:00.000Z")).toBe("05-Oct-2026 09:42 IST");
  });

  it("renders the session's created date through the shared formatter", () => {
    renderShell({
      sessions: [
        {
          processingSessionId: "sess-0001",
          deviceLifecycleId: "dev-0001",
          createdAt: "2026-10-05T04:12:00.000Z",
          manufacturer: "Motorola",
          model: "Moto G54",
        },
      ],
    });

    // On the default OVERVIEW tab, no navigation needed.
    const cell = screen.getByText("05-Oct-2026 09:42 IST");
    expect(cell).toBeTruthy();

    // Hyphen style and an explicit zone label - §19's punctuation, not a
    // locale's. A bare `00:42` would invite the reader to assume their own zone.
    expect(cell.textContent).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST$/);
  });

  it("agrees with the formatter rather than recomputing the date itself", () => {
    const createdAt = "2026-10-05T04:12:00.000Z";
    renderShell({
      sessions: [
        {
          processingSessionId: "sess-0002",
          deviceLifecycleId: "dev-0002",
          createdAt,
          manufacturer: null,
          model: null,
        },
      ],
    });

    const table = screen.getByText(/sess-0002/).closest("tr");
    expect(table).not.toBeNull();
    expect(within(table as HTMLElement).getByText(formatDateTime(createdAt))).toBeTruthy();
  });
});
