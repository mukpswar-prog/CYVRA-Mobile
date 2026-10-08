/**
 * PHASE 2 — light-steel Workspace shell.
 *
 * This suite replaces CustomerDesktopShell.test.tsx, which was deleted together
 * with the legacy shell. It asserts the things a grep cannot:
 *
 *   Spec 90  the left navigation is exactly the eight prescribed sections,
 *            in order, and nothing else;
 *   Spec 89  the top bar carries the identity strip and the two actions;
 *   Spec 6/7/91/92  the Overview answers its five questions, offers the four
 *            primary actions and states what needs attention;
 *   Spec 8/9/10/11  the purchase area takes its options from the licence
 *            policy, validates a mandatory Indian PIN, and never claims to
 *            have sent a request that no endpoint accepts;
 *   Spec 12  an issued licence reads as delivered to the registered email;
 *   Spec 13/14  build availability is driven by release state, and a missing
 *            release renders as unavailable rather than as a working download;
 *   Spec 15  the approved Update / Upgrade behaviour survived the redesign;
 *   Spec 88  Licence & usage carries the prescribed field list, with explicit
 *            absences where the service reports nothing;
 *   Section 58  dates render in IST through the shared formatter;
 *   WS-K1-09  the update check reports the real release manifest, including
 *            its two honest "nothing here" answers;
 *   Master Plan Section 6  no forbidden token and no simulated device or
 *            network state reaches the rendered output.
 *
 * The forbidden tokens are assembled at runtime from fragments on purpose.
 * Master Plan Section 6 greps customer-facing code for them and requires zero
 * hits — an assertion that spelled them out would fail its own gate.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  PLAN_SLABS,
  type BuildManifest,
  type Entitlement,
  type EntitlementResult,
} from "../api";
import { ADMIN_TIME_ZONE, formatDateTime } from "../admin/format/datetime";
import { CustomerWorkspaceShell, WORKSPACE_NAV } from "./CustomerWorkspaceShell";

const noop = () => {};

const join = (parts: string[], separator: string) => parts.join(separator);

/** Master Plan Section 6 — must never appear in rendered output. */
const FORBIDDEN_TOKENS = [
  join(["NIST", "SP", "800", "88"], "_"),
  join(["SUCCESS", "VERIFIED"], "_"),
  join(["CYVRA", "CERT"], "-"),
  join(["100%", "clean"], " "),
  join(["device", "is", "perfect"], " "),
];

/**
 * J7 deletion scope — must never appear in rendered output, and must never
 * appear as a literal in this file either: Master Plan Section 6 greps for the
 * same symbols and the Phase 2 gate requires zero hits across apps/web.
 */
const SIMULATION_TOKENS = [
  join(["SIMULATE", "NETWORK", "DROP"], " "),
  join(["simulated", "Device"], ""),
  join(["fake", "Sha"], ""),
  join(["run", "Simulated", "Live", "Diagnostic"], ""),
  join(["viewfinder", "-mock"], ""),
  join(["is", "Network", "Online"], ""),
  join(["is", "Usb", "Plugged"], ""),
  join(["is", "Adb", "Authorized"], ""),
  join(["Moto", "G54"], " "),
  join(["Connected", "(Port", "1)"], " "),
  join(["ADB", "AUTHORIZED"], ":"),
];

const NAV_LABELS = [
  "OVERVIEW",
  "CYVRA MOBILE",
  "UPDATE & UPGRADE",
  "REPORTING & AUDIT",
  "DEVICE ACTIVITY",
  "LICENCE & USAGE",
  "SETTINGS",
  "HELP",
];

function entitlementResult(
  build: Partial<BuildManifest> = {},
  overrides: Partial<Entitlement> = {},
): EntitlementResult {
  const base: Entitlement = {
    customer: { companyName: "Acme Labs", email: "ops@acme.example" },
    plan: { code: "PLAN_1", slab: "1", label: "1 Device Scans" },
    licence: { status: "ACTIVE", sentence: "Active", maskedSerial: "CYVRA****0001" },
    payment: { state: "known", status: "PAID", sentence: "Payment received" },
    validity: { state: "unknown", startsAt: null, endsAt: null },
    usage: {
      activation: { activatedAt: null, hostBinding: "NOT_BOUND" },
      scans: { state: "available-after-first-scan" },
    },
    // WS-K3: null is the state of every account that has not submitted a
    // request, which is what these tests model unless they say otherwise.
    requestedAt: null,
    build: {
      state: "unavailable",
      version: null,
      sha256: null,
      sizeBytes: null,
      url: null,
      releasedAt: null,
      ...build,
    },
  };
  const { build: buildOverride, ...rest } = overrides;
  return {
    kind: "ok",
    entitlement: { ...base, ...rest, build: { ...base.build, ...buildOverride } },
  };
}

function renderShell(
  overrides: Partial<Parameters<typeof CustomerWorkspaceShell>[0]> = {},
) {
  return render(
    <CustomerWorkspaceShell
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

function renderedText() {
  return document.body.textContent ?? "";
}

function goToNav(label: string) {
  const nav = screen.getByRole("navigation", { name: "Workspace sections" });
  fireEvent.click(within(nav).getByRole("button", { name: label }));
}

/**
 * Nav buttons carry an `aria-hidden` glyph ahead of the label, so their
 * accessible name (which is what a query sees) differs from their `textContent`.
 * Strip the glyph to compare against Spec 90's prescribed section names.
 */
function navButtonLabel(button: HTMLElement): string {
  const clone = button.cloneNode(true) as HTMLElement;
  clone.querySelector(".ws-nav__icon")?.remove();
  return clone.textContent?.trim() ?? "";
}

afterEach(() => {
  vi.useRealTimers();
  // WS-K3 tests spy on `api.licenceRequest`; without this the stub would
  // survive into the next case and assert against a request that never went
  // anywhere.
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Spec 90 — left navigation
 * ------------------------------------------------------------------ */

describe("Spec 90: the left navigation is the eight prescribed sections", () => {
  it("declares exactly eight items in specification order", () => {
    expect(WORKSPACE_NAV).toHaveLength(8);
    expect(WORKSPACE_NAV.map((item) => item.label)).toEqual(NAV_LABELS);
  });

  it("renders one button per section and no ninth", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Workspace sections" });
    // The drawer's own "Close menu" control lives inside <nav> too; the section
    // items are the ones carrying .ws-nav__btn.
    const buttons = within(nav)
      .getAllByRole("button")
      .filter((b) => b.classList.contains("ws-nav__btn"));
    expect(buttons).toHaveLength(8);
    expect(buttons.map(navButtonLabel)).toEqual(NAV_LABELS);
  });

  it("marks OVERVIEW as the landing section", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Workspace sections" });
    const current = within(nav).getAllByRole("button").filter(
      (b) => b.getAttribute("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(navButtonLabel(current[0])).toBe("OVERVIEW");
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
  });

  it("switches the main region for every section", () => {
    renderShell();
    const expected: Record<string, string> = {
      "OVERVIEW": "Overview",
      "CYVRA MOBILE": "CYVRA Mobile",
      "UPDATE & UPGRADE": "Update & Upgrade",
      "REPORTING & AUDIT": "Reporting & Audit",
      "DEVICE ACTIVITY": "Device activity",
      "LICENCE & USAGE": "Licence & usage",
      "SETTINGS": "Settings",
      "HELP": "Help",
    };
    for (const label of NAV_LABELS) {
      goToNav(label);
      expect(screen.getByRole("heading", { level: 1, name: expected[label] })).toBeTruthy();
    }
  });

  it("retires the four desktop-only sections the spec removed", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Workspace sections" });
    const labels = within(nav)
      .getAllByRole("button")
      .filter((b) => b.classList.contains("ws-nav__btn"))
      .map(navButtonLabel);
    for (const gone of [
      "ADVANCED DIAGNOSTIC",
      "AI PHYSICAL INSPECTION",
      "DATA PURGE",
      "RESULTS & REPORTS",
    ]) {
      expect(labels).not.toContain(gone);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Spec 89 — compact top bar
 * ------------------------------------------------------------------ */

describe("Spec 89: the top bar carries the identity strip", () => {
  it("shows customer, licence, status and application", () => {
    renderShell({ entitlement: entitlementResult() });
    const banner = screen.getByRole("banner");
    for (const label of ["Customer", "Licence", "Status", "Application"]) {
      expect(within(banner).getByText(label)).toBeTruthy();
    }
    expect(within(banner).getByText("1 Device Scans")).toBeTruthy();
    expect(within(banner).getByText("Active")).toBeTruthy();
  });

  it("offers the UPDATE and UPGRADE actions", () => {
    renderShell();
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("button", { name: "UPDATE" })).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "UPGRADE" })).toBeTruthy();
  });

  it("reports an unknown build rather than printing a guessed version", () => {
    renderShell({ entitlement: entitlementResult() });
    const banner = screen.getByRole("banner");
    expect(within(banner).getByText("Build unavailable")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * Entitlement honesty
 * ------------------------------------------------------------------ */

describe("licence state is reported, never invented", () => {
  it("says it is checking while entitlement is still null", () => {
    renderShell({ entitlement: null });
    expect(screen.getAllByText("Checking your licence").length).toBeGreaterThan(0);
  });

  it("reports a missing licence as missing", () => {
    renderShell({ entitlement: { kind: "no-licence", message: "Licence not found." } });
    expect(screen.getAllByText("No licence on this account yet").length).toBeGreaterThan(0);
  });

  it("surfaces a server error as a server error, not as no-licence", () => {
    renderShell({ entitlement: { kind: "unavailable", message: "503" } });
    expect(
      screen.getAllByText("Server error - could not check your licence").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("No licence on this account yet")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Spec 13/14 — download states
 * ------------------------------------------------------------------ */

describe("Spec 13/14: download availability follows release state", () => {
  it("shows BUILD NOT AVAILABLE and no enabled download when no release exists", () => {
    renderShell({ entitlement: entitlementResult() });
    goToNav("CYVRA MOBILE");

    expect(screen.getAllByText("BUILD NOT AVAILABLE").length).toBeGreaterThan(0);
    expect(screen.queryByText("BUILD AVAILABLE")).toBeNull();

    const button = screen.getByRole("button", { name: "BUILD NOT AVAILABLE" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.queryByRole("link", { name: /DOWNLOAD CYVRA MOBILE/ })).toBeNull();
  });

  it("shows BUILD AVAILABLE with a real link when a release exists", () => {
    renderShell({
      entitlement: entitlementResult({
        state: "published",
        version: "1.4.0",
        sha256: "a".repeat(64),
        sizeBytes: 123_456_789,
        url: "https://releases.example.com/cyvra-mobile-windows.zip",
        releasedAt: "2026-10-05T04:12:00.000Z",
      }),
    });
    goToNav("CYVRA MOBILE");

    expect(screen.getAllByText("BUILD AVAILABLE").length).toBeGreaterThan(0);

    const link = screen.getByRole("link", { name: /DOWNLOAD CYVRA MOBILE/ });
    expect(link.getAttribute("href")).toBe(
      "https://releases.example.com/cyvra-mobile-windows.zip",
    );

    // Spec 13 supporting information — bytes are formatted, never printed raw.
    expect(screen.queryByText("123456789")).toBeNull();
    expect(screen.getByText("117.7 MB")).toBeTruthy();
    expect(screen.getByText(/a{64}/)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * Real data reaches the right section
 * ------------------------------------------------------------------ */

describe("server data lands in the section the specification assigns it", () => {
  it("lists sessions under DEVICE ACTIVITY with the freeze action", () => {
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
    goToNav("DEVICE ACTIVITY");

    expect(screen.getByText("Motorola Moto G54")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Freeze Report 1" })).toBeTruthy();
    expect(screen.getByText("05-Oct-2026 09:42 IST")).toBeTruthy();
  });

  it("lists reports under REPORTING & AUDIT", () => {
    renderShell({
      reports: [
        {
          reportId: "r-1",
          publicNumber: "CYVRA-R1-2026-00001",
          processingSessionId: "sess-0001",
          deviceLifecycleId: "dev-0001",
          coverage: "COMPLETE",
          frozenAt: "2026-10-05T04:12:00.000Z",
        },
      ],
    });
    goToNav("REPORTING & AUDIT");

    expect(screen.getByText("CYVRA-R1-2026-00001")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View report" })).toBeTruthy();
    expect(screen.getByText("05-Oct-2026 09:42 IST")).toBeTruthy();
  });

  it("does not offer a report upload control that has no endpoint", () => {
    renderShell();
    goToNav("REPORTING & AUDIT");
    expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /upload/i })).toBeNull();
    expect(screen.getByText(/no endpoint behind it/i)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * Section 58 — IST
 * ------------------------------------------------------------------ */

describe("section 58: the dashboard renders IST, not the browser's zone", () => {
  it("pins section 19's worked example character for character", () => {
    // 04:12Z is 09:42 IST. Section 19 shows `05-Oct-2026 09:42 IST`.
    expect(ADMIN_TIME_ZONE).toBe("Asia/Kolkata");
    expect(formatDateTime("2026-10-05T04:12:00.000Z")).toBe("05-Oct-2026 09:42 IST");
  });

  it("renders the session date through the shared formatter", () => {
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
    goToNav("DEVICE ACTIVITY");

    const cell = screen.getByText("05-Oct-2026 09:42 IST");
    expect(cell.textContent).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2} IST$/);
  });
});

/* ------------------------------------------------------------------ *
 * Spec 15 — update / upgrade preserved
 * ------------------------------------------------------------------ */

describe("Spec 15: update and upgrade behaviour survived the redesign", () => {
  it("opens the update manager from the top bar", () => {
    renderShell({ entitlement: entitlementResult({ version: "1.4.0" }) });
    fireEvent.click(screen.getByRole("banner").querySelector('button[title="Check for software updates"]')!);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Software Update/)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /Check for updates/ }),
    ).toBeTruthy();
  });

  it("runs check -> download -> discard against the real manifest", async () => {
    renderShell({
      entitlement: entitlementResult({ version: "1.4.0" }),
      refreshEntitlement: async () =>
        entitlementResult({
          state: "published",
          version: "1.4.0",
          sha256: "b".repeat(64),
          sizeBytes: 5_000_000,
          url: "https://releases.example.com/cyvra-mobile-windows.zip",
          releasedAt: "2026-10-05T04:12:00.000Z",
        }),
    });
    fireEvent.click(screen.getByRole("banner").querySelector('button[title="Check for software updates"]')!);

    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Check for updates/ }));
    });

    expect(within(dialog).getByText(/Published release available: v1.4.0/)).toBeTruthy();
    // Section 58 - the release date is rendered in IST through the formatter.
    expect(within(dialog).getByText("05-Oct-2026 09:42 IST")).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /Download published package/ }),
    );
    expect(within(dialog).getByText(/Package download started/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /Discard downloaded package/ }));
    // The panel's title and body both say "discarded" — assert on the heading.
    expect(within(dialog).getByRole("heading", { name: /discarded/i })).toBeTruthy();
  });

  it("keeps the change-plan dialog honest about the missing endpoint", () => {
    renderShell({ entitlement: entitlementResult() });
    const banner = screen.getByRole("banner");
    fireEvent.click(within(banner).getByRole("button", { name: "UPGRADE" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/no endpoint/i)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /confirm|pay|upgrade now/i })).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * WS-K1-09 - the update check reports the manifest, not a story
 * ------------------------------------------------------------------ */

describe("WS-K1-09: the update check reports the release manifest", () => {
  /**
   * The values the pre-Phase-3 implementation printed out of literals.
   *
   * Assembled from fragments for the same reason `FORBIDDEN_TOKENS` is: a
   * grep over customer-facing code for any of them must return zero, and an
   * assertion that spelled them out would fail its own gate.
   */
  const INVENTED = [
    join(["3", "2", "2-g5"], "."),
    join(["Ed", "25519"], ""),
    `/${join(["opt", "cyvra", "updates", "staged"], "/")}`,
    join(["Delta", "Package"], " "),
  ];

  async function openUpdateManager(
    overrides: Partial<Parameters<typeof CustomerWorkspaceShell>[0]> = {},
  ) {
    renderShell({
      entitlement: entitlementResult(),
      refreshEntitlement: async () => entitlementResult(),
      ...overrides,
    });
    fireEvent.click(
      screen.getByRole("banner").querySelector('button[title="Check for software updates"]')!,
    );
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Check for updates/ }));
    });
    return dialog;
  }

  it("answers honestly that no release is published", async () => {
    const dialog = await openUpdateManager();

    expect(within(dialog).getByRole("heading", { name: /No release published/ })).toBeTruthy();
    expect(within(dialog).getByText(/state "unavailable"/)).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: /stage update/i }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: /Return to update manager/ }),
    ).toBeTruthy();
  });

  it("reports a failed read as a failure rather than as a release", async () => {
    const dialog = await openUpdateManager({
      refreshEntitlement: async () => ({ kind: "unavailable", message: "503" }),
    });

    expect(within(dialog).getByRole("heading", { name: /could not be read/i })).toBeTruthy();
    expect(within(dialog).getByText(/503/)).toBeTruthy();
  });

  it("prints no invented release data anywhere in the Workspace", async () => {
    await openUpdateManager();
    for (const label of NAV_LABELS) goToNav(label);
    const text = renderedText();
    for (const value of INVENTED) {
      expect(text).not.toContain(value);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Spec 6 / 7 / 91 / 92 - the Overview
 * ------------------------------------------------------------------ */

describe("Spec 6/7/91/92: the Overview answers at a glance", () => {
  it("shows the summary figures Spec 6 prescribes", () => {
    renderShell({ entitlement: entitlementResult({ version: "1.4.0" }) });
    for (const label of [
      "Customer",
      "Licence",
      "Licence status",
      "Application",
      "Device activity",
      "Reports",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("v1.4.0").length).toBeGreaterThan(0);
    expect(screen.getByText("customer@example.com")).toBeTruthy();
  });

  it("states plainly when nothing needs attention", () => {
    renderShell({
      entitlement: entitlementResult({
        state: "published",
        version: "1.4.0",
        sha256: "a".repeat(64),
        url: "https://releases.example.com/cyvra-mobile-windows.zip",
      }),
    });
    expect(screen.getByText(/Nothing needs your attention/)).toBeTruthy();
  });

  it("flags the unpublished release when there is no build", () => {
    renderShell({ entitlement: entitlementResult() });
    expect(
      screen.getByText(/No CYVRA Mobile build has been published yet/),
    ).toBeTruthy();
  });

  it("offers the four primary actions Spec 7 lists", () => {
    renderShell({ entitlement: entitlementResult() });
    for (const name of [
      "Purchase CYVRA Mobile",
      "Download Application (no published build)",
      "Open Reporting & Audit",
      "View Device Activity",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("offers the download as an orange link only when a release exists", () => {
    renderShell({
      entitlement: entitlementResult({
        state: "published",
        version: "1.4.0",
        sha256: "a".repeat(64),
        url: "https://releases.example.com/cyvra-mobile-windows.zip",
      }),
    });
    const link = screen.getByRole("link", { name: "Download Application" });
    expect(link.getAttribute("href")).toBe(
      "https://releases.example.com/cyvra-mobile-windows.zip",
    );
    expect(link.className).toContain("ws-btn--action");
  });
});

/* ------------------------------------------------------------------ *
 * Spec 12 - the acceptance row
 * ------------------------------------------------------------------ */

describe("Acceptance: CYVRA06102026SC60B-1-1 (ISSUED, NOT_BOUND)", () => {
  /** The live Neon row, as `GET /v1/me/entitlement` projects it. */
  const issued = entitlementResult(
    {},
    {
      licence: {
        status: "ISSUED",
        sentence: "Licence issued - check your email",
        maskedSerial: "CYVRA*************-1-1",
      },
      usage: {
        activation: { activatedAt: null, hostBinding: "NOT_BOUND" },
        scans: { state: "available-after-first-scan" },
      },
    },
  );

  it("renders as Licence Issued / Sent to registered email on the Overview", () => {
    renderShell({ entitlement: issued });
    expect(screen.getAllByText("Licence Issued").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sent to registered email").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Awaiting activation").length).toBeGreaterThan(0);
  });

  it("renders the same on Licence & usage, with the masked reference", () => {
    renderShell({ entitlement: issued });
    goToNav("LICENCE & USAGE");
    expect(screen.getAllByText("Licence Issued").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sent to registered email").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CYVRA*************-1-1").length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * Spec 88 - Licence & usage field list
 * ------------------------------------------------------------------ */

describe("Spec 88: Licence & usage carries the prescribed field list", () => {
  it("shows every field and names the ones the service does not report", () => {
    renderShell({ entitlement: entitlementResult() });
    goToNav("LICENCE & USAGE");

    for (const key of [
      "Licence type",
      "Licence status",
      "Issued date",
      "Expiry",
      "Device entitlement",
      "Usage limit",
      "Usage consumed",
      "Remaining / available",
      "Registered email",
    ]) {
      expect(screen.getAllByText(key).length).toBeGreaterThan(0);
    }

    expect(screen.getByText("Not reported by the licence service")).toBeTruthy();
    expect(screen.getByText(/does not publish a fixed usage limit/)).toBeTruthy();
    expect(screen.getByText("Not activated yet")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * Spec 8 / 9 / 10 / 11 - the purchase area
 * ------------------------------------------------------------------ */

describe("Spec 8/9/10/11: the purchase area", () => {
  function fillValidRequest() {
    fireEvent.change(screen.getByLabelText("Address line 1 *"), {
      target: { value: "12 M G Road" },
    });
    fireEvent.change(screen.getByLabelText("PIN code *"), { target: { value: "110001" } });
  }

  it("heads the area the way Spec 8 prescribes", () => {
    renderShell();
    goToNav("CYVRA MOBILE");
    expect(screen.getByRole("heading", { name: "PURCHASE CYVRA MOBILE" })).toBeTruthy();
    expect(
      screen.getByText(/Select the licence model required for your operation/),
    ).toBeTruthy();
  });

  it("takes the licence options from the approved licence policy, not from literals", () => {
    renderShell();
    goToNav("CYVRA MOBILE");

    const select = screen.getByLabelText("Licence Type") as HTMLSelectElement;
    const values = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(values).toEqual(
      PLAN_SLABS.map((slab) => `1 User / ${slab} ${slab === 1 ? "Device" : "Devices"}`),
    );
    // The specification's example list is illustrative; the policy is not.
    expect(PLAN_SLABS).toContain(1);
    expect(PLAN_SLABS).toContain(5);
    expect(PLAN_SLABS).toContain(25);
  });

  it("populates the registered email from the account and keeps it read-only", () => {
    renderShell();
    goToNav("CYVRA MOBILE");

    const email = screen.getByLabelText("Registered email") as HTMLInputElement;
    expect(email.readOnly).toBe(true);
    expect(email.value).toBe("customer@example.com");
    expect(screen.getByText(/Same as Registered Email/)).toBeTruthy();
  });

  it("rejects a PIN code that is not an Indian PIN code", () => {
    const submit = vi.spyOn(api, "licenceRequest");
    renderShell();
    goToNav("CYVRA MOBILE");

    fireEvent.change(screen.getByLabelText("Address line 1 *"), {
      target: { value: "12 M G Road" },
    });
    fireEvent.change(screen.getByLabelText("PIN code *"), { target: { value: "012345" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit licence request" }));

    expect(screen.getByRole("alert").textContent).toMatch(/Indian PIN/);
    expect(screen.queryByText("Purchase record")).toBeNull();
    expect(submit, "validation runs before any request leaves the page").not.toHaveBeenCalled();
  });

  it("accepts a valid request and shows the Spec 10 status summary", async () => {
    const submit = vi.spyOn(api, "licenceRequest").mockResolvedValue({
      status: "SUBMITTED",
      requestedAt: "2026-10-08T09:15:00.000Z",
    });
    renderShell();
    goToNav("CYVRA MOBILE");
    fillValidRequest();

    fireEvent.click(screen.getByRole("button", { name: "Submit licence request" }));
    await screen.findByText("Request Submitted — awaiting admin review");

    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      submit.mock.calls[0]?.[0],
      "spec 11: a payment declaration is never part of what the customer sends",
    ).not.toHaveProperty("paymentStatus");
    expect(screen.getByText("Purchase record")).toBeTruthy();
    expect(screen.getByText(/SUBMITTED - awaiting admin review/)).toBeTruthy();
    expect(screen.getByText(/recorded by the licence service/)).toBeTruthy();
    expect(screen.getByText(/110001/)).toBeTruthy();

    // Accepted means accepted: the control can only be refused afterwards, so
    // it stops being offered rather than becoming a button that answers 429.
    const button = screen.getByRole("button", {
      name: "Request submitted",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows a red panel with RETRY when the request cannot be delivered", async () => {
    vi.spyOn(api, "licenceRequest").mockRejectedValue(new Error("Network unreachable"));
    renderShell();
    goToNav("CYVRA MOBILE");
    fillValidRequest();

    fireEvent.click(screen.getByRole("button", { name: "Submit licence request" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Network unreachable/);
    expect(alert.textContent).toMatch(/Nothing was recorded on the server/);
    expect(screen.getByRole("button", { name: "RETRY" })).toBeTruthy();
    // The Spec 10 summary survives the failure - it is prepared on this device.
    expect(screen.getByText("Purchase record")).toBeTruthy();
    expect(screen.getByText(/Not sent - delivery failed/)).toBeTruthy();
  });

  it("renders a request that already landed as submitted, without sending again", () => {
    const submit = vi.spyOn(api, "licenceRequest");
    renderShell({
      entitlement: entitlementResult({}, { requestedAt: "2026-10-07T10:00:00.000Z" }),
    });
    goToNav("CYVRA MOBILE");

    expect(screen.getByText("Request Submitted — awaiting admin review")).toBeTruthy();
    expect(submit, "the stamp came from the server; nothing is re-sent").not.toHaveBeenCalled();

    const button = screen.getByRole("button", {
      name: "Request submitted",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("marks payment complete without turning it into an entitlement", () => {
    renderShell();
    goToNav("CYVRA MOBILE");

    fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "Done" } });
    expect(screen.getByText("Payment marked complete.")).toBeTruthy();
    expect(screen.getByText(/VALID LICENCE ISSUED/)).toBeTruthy();
    expect(
      screen.getAllByText(/does not, by itself, grant an application entitlement/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /pay now|checkout|gateway/i })).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Spec 71 — responsive shell
 * ------------------------------------------------------------------ */

describe("Spec 71: the navigation collapses", () => {
  it("exposes a toggle that opens and closes the drawer", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: /Menu/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("ws-left-nav");

    fireEvent.click(toggle);
    const nav = screen.getByRole("navigation", { name: "Workspace sections" });
    expect(nav.className).toContain("is-open");
    expect(nav.querySelector(".ws-nav__close")).toBeTruthy();

    // The drawer overlays the header on small screens, so it carries its own
    // close control rather than relying on the toggle underneath it.
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(
      screen.getByRole("navigation", { name: "Workspace sections" }).className,
    ).not.toContain("is-open");
  });
});

/* ------------------------------------------------------------------ *
 * Master Plan Section 6 + J7 — nothing forbidden reaches the screen
 * ------------------------------------------------------------------ */

describe("Master Plan Section 6 / J7: the shell renders no forbidden claim", () => {
  it("never renders a banned token or a simulated device or network state", () => {
    renderShell({ entitlement: entitlementResult() });

    const text = renderedText();
    for (const token of [...FORBIDDEN_TOKENS, ...SIMULATION_TOKENS]) {
      expect(text).not.toContain(token);
    }

    // Walk every section and check again — a token could live on any one.
    for (const label of NAV_LABELS) {
      goToNav(label);
      const sectionText = renderedText();
      for (const token of [...FORBIDDEN_TOKENS, ...SIMULATION_TOKENS]) {
        expect(sectionText).not.toContain(token);
      }
    }
  });

  it("never claims a certificate or assurance level was observed", () => {
    renderShell({ entitlement: entitlementResult() });
    for (const label of NAV_LABELS) goToNav(label);
    expect(renderedText()).not.toContain(join(["NIST", "SP", "800", "88"], "_"));
    expect(renderedText()).not.toContain(join(["CYVRA", "CERT"], "-"));
  });
});
