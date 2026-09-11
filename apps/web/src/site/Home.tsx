import { Link } from "./router";
import { Photo } from "./Photo";

const trust = [
  "Verify Before Sanitization",
  "Evidence at Every Stage",
  "Controlled & Authorized Workflows",
  "Professional Device Reporting",
];

const idea = [
  ["VERIFY", "Understand the device before deciding what comes next."],
  [
    "EVIDENCE",
    "Capture what was observed, tested and verified — including limitations and unavailable evidence.",
  ],
  [
    "PROVE",
    "Create professional reports that explain the device condition and lifecycle outcome.",
  ],
] as const;

const lifecycle = [
  ["01", "IDENTIFY", "Establish the device and lifecycle record."],
  [
    "02",
    "VERIFY",
    "Collect supported identity, configuration, physical, hardware, functional, connectivity, power, storage and access evidence.",
  ],
  ["03", "REPORT", "Create the pre-sanitization Device Verification Report."],
  ["04", "AUTHORIZE", "Keep sanitization as a separately authorized lifecycle event."],
  ["05", "SANITIZE", "Perform supported sanitization according to the applicable workflow."],
  [
    "06",
    "VERIFY AGAIN",
    "Confirm the post-sanitization state and capture the resulting evidence.",
  ],
  ["07", "FINAL REPORT", "Document the completed lifecycle outcome."],
] as const;

const domains = [
  ["01", "Device Identity", "Understand the device model, configuration and available identity information."],
  ["02", "Physical Condition", "Record visible condition and relevant physical observations."],
  ["03", "Hardware", "Evaluate supported hardware components and available technical evidence."],
  ["04", "Function", "Verify supported device functions and operational behavior."],
  ["05", "Connectivity", "Assess supported wireless, network, communication and connectivity functions."],
  ["06", "Power & Storage", "Capture supported battery, charging, storage and related evidence."],
  ["07", "Access & Security", "Document device access state, security-related limitations and the scope of available verification."],
] as const;

const reportItems = [
  "Device identity",
  "Device configuration",
  "Verification status",
  "Physical condition",
  "Hardware evidence",
  "Functional evidence",
  "Connectivity evidence",
  "Power and storage evidence",
  "Access and security limitations",
  "Evidence exceptions",
  "Evidence conflicts",
  "Verification summary",
  "Technician declaration",
  "Evidence integrity information",
];

const industries = [
  ["Refurbishers", "Verify incoming devices, document condition and create evidence before refurbishment and resale."],
  ["IT Asset Disposition", "Bring structured verification, sanitization and reporting into mobile device disposition workflows."],
  ["Buyback & Trade-In", "Support device assessment with consistent evidence for downstream valuation and decision-making."],
  ["Wholesale & Distribution", "Create clearer device records across incoming and outgoing inventory."],
  ["Retail & Service", "Standardize device verification and reporting across operational teams."],
  ["Enterprise IT", "Support controlled device lifecycle processes for corporate smartphones and tablets."],
  ["Insurance & Claims", "Create structured condition evidence to support internal review and documentation."],
  ["Reuse & Sustainability", "Support responsible technology reuse by improving visibility into device condition and lifecycle outcomes."],
] as const;

const why = [
  ["Evidence First", "Capture the evidence before drawing the conclusion."],
  ["Verification Before Sanitization", "Preserve the pre-sanitization device record."],
  ["Clear Limitations", "Make unavailable and unsupported evidence visible."],
  ["Structured Reporting", "Turn device activity into professional documentation."],
  ["Lifecycle Continuity", "Follow the device from intake through final outcome."],
  ["Designed for Scale", "Support individual workflows and professional device-processing environments."],
] as const;

const faqs = [
  [
    "What is CYVRA Mobile?",
    "CYVRA Mobile is an evidence-led mobile device lifecycle platform designed to help organizations verify smartphones and tablets, collect structured evidence, manage authorized sanitization workflows and produce professional reports.",
  ],
  [
    "Is CYVRA Mobile only a diagnostic tool?",
    "No. Diagnostics are one part of the workflow. CYVRA Mobile focuses on the broader lifecycle of device verification, evidence, sanitization and reporting.",
  ],
  [
    "Does CYVRA Mobile bypass device locks?",
    "No. CYVRA Mobile does not bypass PINs, passwords, patterns, FRP or other device security controls.",
  ],
  [
    "What is Report 1?",
    "Report 1 is the CYVRA Device Verification Report, documenting the device state and evidence collected before sanitization. It does not prove sanitization.",
  ],
  [
    "Does verification happen before sanitization?",
    "Yes. Device Verification → Report 1 → Separate Sanitization Authorization → Sanitization → Post-Sanitization Verification → Final Report.",
  ],
  [
    "Is CYVRA Mobile a government certification platform?",
    "No. CYVRA Mobile is technology and evidence software. It should not be presented as government certification or as a guarantee of legal or regulatory compliance.",
  ],
] as const;

export function Home() {
  return (
    <>
      <section className="hero-block">
        <div className="hero-copy">
          <p className="eyebrow">Evidence-led mobile device lifecycle</p>
          <h1>
            Know the Device.
            <br />
            Prove the Result.
          </h1>
          <p className="lead">
            CYVRA Mobile brings device verification, evidence collection,
            authorized sanitization and professional reporting into one
            structured lifecycle for smartphones and tablets.
          </p>
          <div className="hero-ctas">
            <Link href="/create-account" className="btn btn-primary">
              Create Account
            </Link>
            <Link href="/platform" className="btn btn-ghost">
              Explore CYVRA Mobile
            </Link>
          </div>
          <p className="trust-line">
            Built for refurbishment, ITAD, buyback, trade-in, enterprise and
            device lifecycle operations.
          </p>
        </div>
        <Photo
          src="/media/01-cyvra-mobile-hero.webp"
          alt="Smartphone and tablet in a CYVRA Mobile evidence-led verification workflow"
          className="photo hero-photo"
          priority
        />
      </section>

      <ul className="trust-strip">
        {trust.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <section className="band">
        <h2>A Better Way to Understand Every Device</h2>
        <p className="lead narrow">
          A device should not move to its next lifecycle stage based only on
          appearance, assumptions or disconnected test results. CYVRA Mobile
          creates a structured evidence trail around the device — from initial
          verification through sanitization and final reporting.
        </p>
        <div className="card-grid three">
          {idea.map(([title, copy]) => (
            <article key={title} className="soft-card">
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band alt" id="lifecycle">
        <h2>One Device. One Structured Lifecycle.</h2>
        <p className="lead narrow">
          CYVRA Mobile follows a clear sequence designed to keep verification
          evidence separate from sanitization evidence.
        </p>
        <div className="life-grid seven-life">
          {lifecycle.map(([n, title, copy]) => (
            <article key={n} className="life-card">
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
        <p className="callout">Verification comes before sanitization.</p>
      </section>

      <section className="band split">
        <Photo
          src="/media/02-cyvra-mobile-device-verification.webp"
          alt="Technician collecting structured device verification evidence on a professional bench"
          className="photo"
        />
        <div>
          <h2>Verify the Device Before You Decide Its Future</h2>
          <p>
            Before a smartphone or tablet is refurbished, resold, redeployed or
            retired, organizations need to understand its actual condition.
            CYVRA Mobile collects structured evidence from the device and makes
            the scope of verification visible.
          </p>
          <p>
            The objective is not to claim that everything was tested. The
            objective is to clearly show what was verified, what was
            unavailable, what was unsupported and what requires review.
          </p>
          <Link href="/device-verification" className="btn btn-primary">
            Explore Device Verification
          </Link>
        </div>
      </section>

      <section className="band alt split">
        <div>
          <h2>Evidence Across the Device</h2>
          <p>
            CYVRA Mobile organizes Device Verification into seven evidence
            domains.
          </p>
          <div className="card-grid two">
            {domains.map(([n, title, copy]) => (
              <article key={n} className="soft-card">
                <span>{n}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
          <p className="callout">
            If evidence is unavailable, CYVRA Mobile makes the limitation
            visible. It does not silently convert missing evidence into a pass
            or failure.
          </p>
        </div>
        <Photo
          src="/media/03-cyvra-mobile-diagnostics-workspace.webp"
          alt="Device hardware domains used in CYVRA Mobile verification: camera, chip, battery, connectivity and storage"
          className="photo"
        />
      </section>

      <section className="band split">
        <div>
          <p className="eyebrow">Report 1</p>
          <h2>Turn Device Evidence Into a Professional Record</h2>
          <p>
            CYVRA Device Verification Report records the device state before
            sanitization. It brings together the evidence collected during
            verification and presents it in a structured, reviewable format.
          </p>
          <ul className="tick-list compact">
            {reportItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="callout warn">
            Report 1 does not authorize sanitization. It is the evidence record
            of the device before the sanitization event.
          </p>
          <Link href="/reports" className="btn btn-primary">
            Explore Reports
          </Link>
        </div>
        <Photo
          src="/media/06-cyvra-mobile-device-verification-report.webp"
          alt="CYVRA Device Verification Report shown beside a smartphone as a professional evidence record"
          className="photo"
        />
      </section>

      <section className="band dark split">
        <Photo
          src="/media/04-cyvra-mobile-sanitization.webp"
          alt="Controlled sanitization workflow moving device data through a secure processing boundary"
          className="photo"
        />
        <div>
          <h2>Sanitization as a Controlled Lifecycle Event</h2>
          <p>
            Data sanitization should never be assumed simply because a device
            was processed. CYVRA Mobile treats sanitization as a separate,
            controlled event.
          </p>
          <p className="site-markline light">
            Verify first. Authorize separately. Sanitize. Verify again. Report
            the outcome.
          </p>
          <Link href="/sanitization" className="btn btn-primary">
            Explore Sanitization
          </Link>
        </div>
      </section>

      <section className="band split">
        <div>
          <h2>The Process Does Not End With Sanitization</h2>
          <p>
            A sanitization event is not the same as proof of the resulting
            device state. CYVRA Mobile provides a structured post-sanitization
            verification stage so organizations can record what was observed
            after the process.
          </p>
          <p className="chain">
            Before → Authorized → Sanitized → Verified → Reported
          </p>
          <p className="callout">
            The final result should be supported by evidence — not assumption.
          </p>
        </div>
        <Photo
          src="/media/05-cyvra-mobile-post-sanitization-verification.webp"
          alt="Post-sanitization verification: personal data removed through a controlled boundary, then the resulting device state recorded"
          className="photo"
        />
      </section>

      <section className="band alt">
        <h2>Evidence You Can Trace</h2>
        <p className="lead narrow">
          Every important device decision should be supported by information
          that can be understood later. CYVRA Mobile is designed around evidence
          rather than unsupported conclusions.
        </p>
        <p className="callout">Measured. Recorded. Explained. Never guessed.</p>
      </section>

      <section className="band dark station-band">
        <div className="station-copy">
          <h2>CYVRA Station</h2>
          <p className="subhead">
            Professional workstation support for structured mobile device
            verification.
          </p>
          <p>
            CYVRA Station extends CYVRA Mobile into professional
            device-processing environments where multiple smartphones and
            tablets need to be handled in a structured workflow. Station is the
            planned Windows workstation. It is not available to download in this
            public launch.
          </p>
          <Link href="/station" className="btn btn-primary">
            Explore CYVRA Station
          </Link>
        </div>
        <Photo
          src="/media/07-cyvra-mobile-station-workflow.webp"
          alt="CYVRA Station floor: device rack, scanner and workstation dashboard for structured mobile processing"
          className="photo station-photo"
        />
      </section>

      <section className="band">
        <h2>Security Boundaries Are Part of the Evidence</h2>
        <p className="lead narrow">
          CYVRA Mobile works within legitimate device access and supported
          platform capabilities. It does not bypass PINs, passwords, patterns,
          FRP or other device security controls.
        </p>
        <p className="callout warn">
          No legitimate access does not automatically mean device failure.
        </p>
      </section>

      <section className="band alt">
        <h2>Designed for Real-World Android Device Diversity</h2>
        <p className="lead narrow">
          Android devices differ by manufacturer, model, operating system,
          hardware, permission state and enterprise management. CYVRA Mobile
          follows a capability-aware approach: capability is recorded separately
          from test result. We do not claim Samsung Authorized.
        </p>
        <Link href="/device-verification" className="btn btn-ghost">
          View Compatibility
        </Link>
      </section>

      <section className="band split">
        <Photo
          src="/media/08-cyvra-mobile-enterprise-device-lifecycle.webp"
          alt="Professional device-processing floor in India supporting refurbishment, ITAD and enterprise lifecycle operations"
          className="photo"
        />
        <div>
          <h2>Built for the Modern Device Lifecycle</h2>
          <p>
            CYVRA Mobile is designed for organizations that process devices at
            scale and need consistent evidence across people, locations and
            workflows.
          </p>
          <div className="card-grid two">
            {industries.map(([title, copy]) => (
              <article key={title} className="soft-card">
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
          <Link href="/industries" className="btn btn-ghost">
            Explore industries
          </Link>
        </div>
      </section>

      <section className="band alt">
        <h2>Why Organizations Choose an Evidence-Led Approach</h2>
        <div className="card-grid three">
          {why.map(([title, copy]) => (
            <article key={title} className="soft-card">
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band">
        <h2>Better Evidence Supports Better Device Decisions</h2>
        <p className="lead narrow">
          A device cannot be responsibly reused if its condition and lifecycle
          history are unclear. CYVRA Mobile does not claim environmental
          certification. It helps organizations make more informed reuse,
          refurbishment, resale, redeployment and retirement decisions.
        </p>
        <p className="callout">
          Extend useful device life. Reduce uncertainty. Support responsible
          technology reuse.
        </p>
      </section>

      <section className="band alt">
        <h2>Built in India. Designed for the Global Technology Lifecycle.</h2>
        <p className="lead narrow">
          CYVRA Mobile is developed by <strong>CYVORIQ Solutions Pvt. Ltd.</strong>
          , an Indian technology company building evidence-led software for
          modern device and IT asset lifecycle operations.
        </p>
        <p className="site-markline">Technology moves fast. Evidence should move with it.</p>
        <Link href="/company" className="btn btn-ghost">
          About CYVORIQ
        </Link>
      </section>

      <section className="band">
        <h2>Frequently Asked Questions</h2>
        <dl className="faq-list">
          {faqs.map(([q, a]) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
        <Link href="/faq" className="btn btn-ghost">
          Full FAQ
        </Link>
      </section>

      <section className="cta-band">
        <h2>Ready to Know Every Device and Prove Every Decision?</h2>
        <p>
          CYVRA Mobile brings evidence, verification, sanitization and reporting
          together to help organizations make better decisions across the device
          lifecycle.
        </p>
        <div className="hero-ctas">
          <Link href="/create-account" className="btn btn-primary">
            Create Account
          </Link>
          <Link href="/contact" className="btn btn-ghost light">
            Talk to Our Team
          </Link>
        </div>
        <p className="trust-line light">
          Built for smartphones, tablets and professional device lifecycle
          operations.
        </p>
      </section>
    </>
  );
}
