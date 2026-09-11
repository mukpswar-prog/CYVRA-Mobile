import type { ReactNode } from "react";
import { Link } from "./router";

function Page(props: {
  kicker?: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <article className="inner">
      <header className="inner-hero">
        {props.kicker ? <p className="eyebrow">{props.kicker}</p> : null}
        <h1>{props.title}</h1>
        {props.lead ? <p className="lead">{props.lead}</p> : null}
      </header>
      <div className="inner-body">{props.children}</div>
    </article>
  );
}

export function PlatformPage() {
  return (
    <Page
      kicker="CYVRA MOBILE EVIDENCE"
      title="From device check to provable outcome."
      lead="Verify the Device. Protect the Data. Prove the Outcome."
    >
      <p>
        CYVRA Mobile is a professional device verification and data-sanitization
        platform. It is not phone-grading software, buyback software, or a
        diagnostics gadget. The product is an evidence-led lifecycle.
      </p>
      <div className="compare">
        <article>
          <h3>Traditional process</h3>
          <p>Inspect → Test → Erase → Record manually</p>
        </article>
        <article>
          <h3>Diagnostic platforms</h3>
          <p>Test → Grade → Erase → Certificate</p>
        </article>
        <article className="is-cyvra">
          <h3>CYVRA</h3>
          <p>Identify → Verify → Report → Authorize → Sanitize → Verify → Final Report</p>
        </article>
      </div>
      <p className="callout">The difference is the evidence lifecycle.</p>
      <p>
        Identify → Verify → Report → Sanitize → Verify → Prove. That is the
        CYVRA Mobile story.
      </p>
      <Link href="/create-account" className="btn btn-primary">
        Create Your Account
      </Link>
    </Page>
  );
}

export function HowItWorksPage() {
  return (
    <Page
      kicker="HOW CYVRA WORKS"
      title="One device. One evidence-led lifecycle."
      lead="DEVICE → VERIFY → REPORT 1 → SANITIZE → VERIFY SANITIZATION → FINAL REPORT"
    >
      <p>
        CYVRA turns device processing into an evidence-led lifecycle. Every
        important result has a source. Every limitation is visible. Every major
        decision can be traced back to evidence.
      </p>
      <Link href="/#lifecycle" className="btn btn-ghost">
        See the six stages
      </Link>
    </Page>
  );
}

export function DeviceVerificationPage() {
  return (
    <Page
      kicker="DEVICE VERIFICATION"
      title="Understand the device before you decide its future."
      lead="A device should not move into resale, refurbishment, redeployment, return or retirement based only on appearance."
    >
      <div className="card-grid three">
        <article className="soft-card">
          <h3>Device Identity</h3>
          <p>Know what the device reports about itself.</p>
        </article>
        <article className="soft-card">
          <h3>Hardware</h3>
          <p>Understand the available hardware profile.</p>
        </article>
        <article className="soft-card">
          <h3>Functional Checks</h3>
          <p>Test what can legitimately be tested.</p>
        </article>
        <article className="soft-card">
          <h3>Connectivity</h3>
          <p>Verify supported communication functions.</p>
        </article>
        <article className="soft-card">
          <h3>Power &amp; Battery</h3>
          <p>Capture available power information.</p>
        </article>
        <article className="soft-card">
          <h3>Evidence Coverage</h3>
          <p>Know what was verified — and what was not.</p>
        </article>
      </div>
      <h2>Designed for Android. Built for Compatibility.</h2>
      <p>
        CYVRA Mobile is designed to work with supported Android devices using
        legitimate platform capabilities. Samsung devices are an important part
        of the compatibility roadmap. Deeper enterprise and OEM-authorized
        integration is a separate future capability. We do not claim Samsung
        Authorized.
      </p>
      <h2>One platform. Phones and tablets.</h2>
      <p>
        The test experience adapts to the device's actual capabilities. A
        feature that does not exist on a device is not automatically a failure.
      </p>
    </Page>
  );
}

export function SanitizationPage() {
  return (
    <Page
      kicker="SANITIZATION"
      title="Protect the data. Preserve the evidence."
      lead="Device sanitization is not an afterthought. It is a separate controlled lifecycle event."
    >
      <p>
        Before sanitization, the device verification record is established.
        Then, only through an authorized workflow and supported method,
        sanitization is performed and its outcome is recorded.
      </p>
      <p className="callout warn">
        CYVRA does not bypass device security or defeat device locks.
        Sanitization capabilities depend on the device, operating system,
        legitimate access state and supported authorization path.
      </p>
      <h2>Security is a boundary — not an obstacle to bypass.</h2>
      <p>
        CYVRA does not bypass PINs, passwords, patterns, Factory Reset
        Protection or other security controls. A forgotten credential does not
        create permission to bypass device security.
      </p>
      <p className="callout">Legitimate Access Only. Evidence Without Tampering.</p>
    </Page>
  );
}

export function ReportsPage() {
  return (
    <Page
      kicker="REPORTS & EVIDENCE"
      title="The first report starts before the wipe."
      lead="Report 1 is the pre-sanitization Device Verification Report. The Final Report is the lifecycle record after authorized sanitization."
    >
      <p>
        A public sample PDF will be published after the first production Report
        1 is frozen from real evidence. We do not show a decorative certificate
        that the product cannot yet issue.
      </p>
      <p>
        Report 1 records identity, access state, coverage, observations,
        hardware, function, connectivity, power and storage, limitations,
        evidence references, technician declaration and verification
        information.
      </p>
      <Link href="/create-account" className="btn btn-primary">
        Create an account to view your reports
      </Link>
    </Page>
  );
}

export function StationPage() {
  return (
    <Page
      kicker="CYVRA STATION"
      title="Professional workstation support"
      lead="CYVRA Station is the planned Windows workstation for structured, USB-connected verification. It is not available to download in this launch."
    >
      <p>
        Station will connect the professional workstation experience with CYVRA
        Mobile Evidence for controlled device sessions, authorized ADB
        capabilities where legitimately available, evidence synchronization and
        technician workflow. We do not use the name “CYVRA Bench”.
      </p>
      <p>
        Gate G9 in the engineering guideline has not started. This page is the
        honest product story, not a shipping claim.
      </p>
    </Page>
  );
}

export function EnterprisePage() {
  return (
    <Page
      kicker="CYVRA ENTERPRISE"
      title="Enterprise and OEM-authorized paths"
      lead="Deeper enterprise, UEM and OEM-authorized integration is a later capability (G10). It is not live today."
    >
      <p>
        CYVRA Enterprise will cover organization-scale device records when a
        real enterprise or OEM path exists. We do not claim Knox, Samsung
        Authorized, or any OEM partnership we do not have.
      </p>
    </Page>
  );
}

export function IndustriesPage() {
  return (
    <Page
      kicker="INDUSTRIES"
      title="Built for the device lifecycle."
    >
      <div className="card-grid four">
        {[
          ["Refurbishment", "Verify devices before they enter the resale workflow."],
          ["Wholesale", "Standardize device verification across incoming inventory."],
          ["Buyback & Trade-In", "Create evidence before assigning downstream value."],
          ["IT Asset Disposition", "Document device condition and sanitization activity."],
          ["Retail", "Bring structured verification into store and service workflows."],
          ["Repair & Service", "Establish evidence before and after service."],
          ["Enterprise IT", "Create controlled device records across operations."],
          ["Insurance & Claims", "Document condition using structured verification evidence."],
        ].map(([title, copy]) => (
          <article key={title} className="soft-card">
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </Page>
  );
}

export function AboutPage() {
  return (
    <Page
      kicker="COMPANY"
      title="CYVORIQ Solutions Pvt. Ltd."
      lead="An Indian technology company developing CYVRA — an evidence-led platform for modern technology lifecycle operations."
    >
      <p>
        Our focus is simple: make device decisions more structured, more
        transparent and more defensible through technology.
      </p>
      <p className="site-markline">Know Every Device. Prove Every Decision.</p>
    </Page>
  );
}

export function ResourcesPage() {
  return (
    <Page
      kicker="RESOURCES"
      title="Guides and knowledge"
      lead="These pages will grow into an SEO and operator channel. Today they point at the live product story."
    >
      <ul className="tick-list">
        <li>
          <Link href="/device-verification">Device Verification Guide</Link>
        </li>
        <li>
          <Link href="/sanitization">Sanitization Guide</Link>
        </li>
        <li>
          <Link href="/reports">Evidence &amp; Reporting</Link>
        </li>
        <li>
          <Link href="/device-verification">Android Device Compatibility</Link>
        </li>
        <li>
          <Link href="/faq">FAQs</Link>
        </li>
      </ul>
    </Page>
  );
}

export function FaqPage() {
  const items = [
    [
      "What is CYVRA Mobile?",
      "CYVRA Mobile is CYVORIQ Solutions' platform for structured smartphone and tablet device verification, evidence collection, authorized sanitization workflows and reporting.",
    ],
    [
      "Does CYVRA bypass device locks?",
      "No. CYVRA does not bypass PINs, passwords, patterns, FRP or other device security controls.",
    ],
    [
      "Does CYVRA work with Samsung devices?",
      "CYVRA is being developed for supported Android devices, including Samsung devices, using legitimate platform capabilities. Deeper enterprise/OEM integration is a separate future capability.",
    ],
    [
      "Does CYVRA erase data?",
      "CYVRA includes a dedicated sanitization lifecycle. The exact method and available capabilities depend on device state, operating system and legitimate authorization.",
    ],
    [
      "What is Report 1?",
      "Report 1 is the pre-sanitization CYVRA Device Verification Report.",
    ],
    [
      "What is the Final Report?",
      "The Final Report combines the applicable verification and authorized sanitization evidence into the final lifecycle record.",
    ],
    [
      "Does every unavailable test mean failure?",
      "No. CYVRA distinguishes unavailable, unsupported, limited and failed results.",
    ],
    [
      "Does CYVRA support tablets?",
      "Yes. Tablets are part of CYVRA Mobile Evidence and are not a separate product.",
    ],
  ] as const;
  return (
    <Page kicker="FAQ" title="Questions, answered plainly">
      <dl className="faq-list">
        {items.map(([q, a]) => (
          <div key={q}>
            <dt>{q}</dt>
            <dd>{a}</dd>
          </div>
        ))}
      </dl>
    </Page>
  );
}

export function ContactPage() {
  return (
    <Page
      kicker="CONTACT"
      title="Talk to CYVRA"
      lead="A public sales inbox is not published on this page until privacy terms are approved."
    >
      <p>
        Create an account to start the workspace. Operational access is gated
        separately on admin.cyvoriq.co.in (not live yet).
      </p>
      <Link href="/create-account" className="btn btn-primary">
        Create Your Account
      </Link>
    </Page>
  );
}

export function LegalPage(props: { title: string }) {
  return (
    <Page kicker="LEGAL" title={props.title}>
      <p>
        This is a placeholder. Counsel has not approved the public wording.
        CYVRA Mobile Evidence accounts are separate from Windows Erase
        (cyvra.co.in) accounts.
      </p>
      <p>
        Use of CYVRA does not by itself constitute government certification,
        legal advice or a guarantee of compliance with any specific law or
        regulation.
      </p>
    </Page>
  );
}
