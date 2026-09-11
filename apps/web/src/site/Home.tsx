import { Link } from "./router";

const lifecycle = [
  ["01", "IDENTIFY", "Establish the device identity and available configuration."],
  ["02", "VERIFY", "Evaluate supported hardware, functions, connectivity and device state."],
  ["03", "REPORT", "Create the first evidence-backed Device Verification Report."],
  ["04", "SANITIZE", "Perform authorized data sanitization using supported methods."],
  ["05", "VERIFY SANITIZATION", "Record the sanitization outcome and applicable evidence."],
  ["06", "FINAL REPORT", "Bring the lifecycle evidence together into a professional final record."],
] as const;

const domains = [
  ["01", "Device Identity", "Device Identity & Configuration"],
  ["02", "Physical Condition", "Physical Condition Observation"],
  ["03", "Hardware", "Hardware Configuration Verification"],
  ["04", "Function", "Functional Verification"],
  ["05", "Connectivity", "Connectivity & Communication Verification"],
  ["06", "Power & Storage", "Power, Battery & Storage Verification"],
  ["07", "Access & Security", "Security, Access & Verification Limitations"],
] as const;

const industries = [
  ["Refurbishment", "Verify devices before they enter the resale workflow."],
  ["Wholesale", "Standardize device verification across incoming inventory."],
  ["Buyback & Trade-In", "Create evidence before assigning downstream value."],
  ["IT Asset Disposition", "Document device condition and sanitization activity."],
  ["Retail", "Bring structured device verification into store and service workflows."],
  ["Repair & Service", "Establish evidence before and after service operations."],
  ["Enterprise IT", "Create controlled device records across lifecycle operations."],
  ["Insurance & Claims", "Document device condition using structured verification evidence."],
] as const;

const why = [
  ["Evidence-Led", "Every important decision is connected to evidence."],
  ["Verification First", "Understand the device before sanitization."],
  ["Sanitization Built In", "Data protection is part of the lifecycle — not a separate afterthought."],
  ["Transparent Limitations", "Unknown is not automatically failure."],
  ["Professional Reporting", "Generate structured reports designed for operational and audit workflows."],
  ["Built for the Lifecycle", "One device record can follow the device through verification and sanitization."],
  ["India Built", "Developed by CYVORIQ Solutions Pvt. Ltd."],
] as const;

const faqs = [
  [
    "What is CYVRA Mobile?",
    "CYVRA Mobile is CYVORIQ Solutions' platform for structured smartphone and tablet device verification, evidence collection, authorized sanitization workflows and reporting.",
  ],
  [
    "Does CYVRA bypass device locks?",
    "No. CYVRA does not bypass PINs, passwords, patterns, FRP or other device security controls.",
  ],
  [
    "What is Report 1?",
    "Report 1 is the pre-sanitization CYVRA Device Verification Report.",
  ],
  [
    "Does every unavailable test mean failure?",
    "No. CYVRA distinguishes unavailable, unsupported, limited and failed results.",
  ],
] as const;

export function Home() {
  return (
    <>
      <section className="hero-block">
        <div className="hero-copy">
          <p className="eyebrow">CYVRA MOBILE EVIDENCE</p>
          <h1>
            Know the Device.
            <br />
            Prove the Result.
          </h1>
          <p className="lead">
            CYVRA Mobile Evidence brings device verification, evidence
            collection, authorized sanitization and professional reporting into
            one structured lifecycle.
          </p>
          <div className="hero-ctas">
            <Link href="/create-account" className="btn btn-primary">
              Create Your Account
            </Link>
            <Link href="/platform" className="btn btn-ghost">
              Explore CYVRA Mobile
            </Link>
          </div>
          <p className="trust-line">
            Built for professional device processing, refurbishment, resale, IT
            asset operations and audit-ready workflows.
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="desk">
            <div className="device tablet">
              <span>Tablet</span>
            </div>
            <div className="device phone">
              <span>Phone</span>
            </div>
            <div className="float f1">Device Identity</div>
            <div className="float f2">Verification</div>
            <div className="float f3">Evidence</div>
            <div className="float f4">Sanitization</div>
            <div className="float f5">Report</div>
          </div>
        </div>
      </section>

      <ol className="micro-life">
        <li>IDENTIFY</li>
        <li>VERIFY</li>
        <li>REPORT</li>
        <li>SANITIZE</li>
        <li>PROVE</li>
      </ol>

      <section className="band" id="lifecycle">
        <p className="eyebrow">THE CYVRA DEVICE LIFECYCLE</p>
        <h2>One Device. One Evidence-Led Lifecycle.</h2>
        <div className="life-grid">
          {lifecycle.map(([n, title, copy]) => (
            <article key={n} className="life-card">
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band alt">
        <p className="eyebrow">WHAT IS CYVRA MOBILE?</p>
        <h2>More Than Device Testing</h2>
        <p className="lead narrow">
          CYVRA Mobile is built for organizations that need a reliable record of
          what happened to a device — not just a screen full of test results.
          The platform connects device verification, evidence collection,
          controlled sanitization and professional reporting into one structured
          lifecycle.
        </p>
        <p className="callout">Measured. Recorded. Explained. Never Guessed.</p>
      </section>

      <section className="band">
        <h2>Verification Before Sanitization</h2>
        <p className="lead narrow">
          CYVRA separates device verification from data sanitization. That
          separation matters. Before data is removed, CYVRA can establish the
          device's identity, condition and verification state.
        </p>
        <div className="two-plus">
          <article className="steel-card">
            <p className="eyebrow">REPORT 1</p>
            <h3>Device Verification Report</h3>
            <p>Before sanitization.</p>
          </article>
          <div className="bridge">AUTHORIZED SANITIZATION</div>
          <article className="steel-card">
            <p className="eyebrow">FINAL REPORT</p>
            <h3>Verified Lifecycle Outcome</h3>
            <p>After sanitization.</p>
          </article>
        </div>
      </section>

      <section className="band alt">
        <h2>Seven Evidence Domains. One Device Record.</h2>
        <div className="card-grid seven">
          {domains.map(([n, title, objective]) => (
            <article key={n} className="soft-card">
              <span>{n}</span>
              <h3>{title}</h3>
              <p>{objective}</p>
              <p className="chain">Available → Tested → Evidence → Report</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band split">
        <div>
          <h2>The First Report Starts Before the Wipe.</h2>
          <p>
            CYVRA Report 1 is the pre-sanitization Device Verification Report.
            It records the device state established during the verification
            workflow — including what was tested, what was observed and what
            could not be verified.
          </p>
          <Link href="/reports" className="btn btn-primary">
            See Report 1
          </Link>
        </div>
        <ul className="tick-list">
          <li>Device identity</li>
          <li>Access state</li>
          <li>Verification coverage</li>
          <li>Physical observations</li>
          <li>Hardware information</li>
          <li>Functional test results</li>
          <li>Connectivity results</li>
          <li>Power and storage information</li>
          <li>Limitations</li>
          <li>Evidence references</li>
          <li>Technician declaration</li>
          <li>Report verification information</li>
        </ul>
      </section>

      <section className="band alt">
        <h2>Protect the Data. Preserve the Evidence.</h2>
        <p className="lead narrow">
          CYVRA treats sanitization as a separate controlled lifecycle event.
          Then, only through an authorized workflow and supported method,
          sanitization is performed and its outcome is recorded.
        </p>
        <div className="card-grid three">
          <article className="soft-card">
            <h3>AUTHORIZE</h3>
            <p>Confirm the legitimate sanitization workflow.</p>
          </article>
          <article className="soft-card">
            <h3>SANITIZE</h3>
            <p>Perform the supported sanitization method.</p>
          </article>
          <article className="soft-card">
            <h3>VERIFY</h3>
            <p>Capture evidence of the sanitization outcome.</p>
          </article>
        </div>
        <p className="callout warn">
          CYVRA does not bypass device security or defeat device locks.
        </p>
      </section>

      <section className="band">
        <h2>Evidence You Can Trace.</h2>
        <p className="lead narrow">
          CYVRA does not simply show a result. It records where that result
          came from — source, method, timestamp, test, result, limitation,
          session and integrity reference.
        </p>
        <p className="callout">
          What was tested. How it was tested. When it was tested. What the
          evidence actually supports.
        </p>
      </section>

      <section className="band alt">
        <h2>Missing Evidence Is Not a Failure.</h2>
        <p className="lead narrow">
          Permissions may be unavailable. Hardware may not exist. A device may
          be legitimately restricted. CYVRA records those conditions instead of
          turning uncertainty into a false PASS or FAIL.
        </p>
        <ul className="status-row">
          <li>VERIFIED</li>
          <li>LIMITED</li>
          <li>NOT AVAILABLE</li>
          <li>NOT SUPPORTED</li>
          <li>NOT TESTED</li>
          <li>REVIEW REQUIRED</li>
        </ul>
      </section>

      <section className="band">
        <p className="eyebrow">PROFESSIONAL WORKSTATION</p>
        <h2>CYVRA Station</h2>
        <p className="lead narrow">
          Professional workstation support for structured device verification.
          Station is the planned Windows bench that coordinates USB-connected
          workflows with CYVRA Mobile Evidence. It is not shipping in this
          public launch.
        </p>
        <Link href="/station" className="btn btn-ghost">
          Explore CYVRA Station
        </Link>
      </section>

      <section className="band alt">
        <h2>Built for the Device Lifecycle.</h2>
        <div className="card-grid four">
          {industries.map(([title, copy]) => (
            <article key={title} className="soft-card">
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
        <Link href="/industries" className="btn btn-ghost">
          All industries
        </Link>
      </section>

      <section className="band">
        <h2>Why CYVRA?</h2>
        <div className="card-grid four">
          {why.map(([title, copy]) => (
            <article key={title} className="soft-card">
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="band alt">
        <h2>Better Evidence Supports Better Reuse.</h2>
        <p className="callout">
          Verify Before You Replace. Sanitize Before You Reuse. Document Before
          You Decide.
        </p>
      </section>

      <section className="band">
        <h2>Built in India. Designed for the Modern Device Lifecycle.</h2>
        <p className="lead narrow">
          CYVRA is developed by <strong>CYVORIQ Solutions Pvt. Ltd.</strong> We
          are building evidence-led technology for organizations that manage
          devices across their lifecycle.
        </p>
        <p className="site-markline">Know Every Device. Prove Every Decision.</p>
        <Link href="/about" className="btn btn-ghost">
          About CYVORIQ Solutions
        </Link>
      </section>

      <section className="band alt">
        <h2>Questions, answered plainly</h2>
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
        <h2>Ready to Know Every Device?</h2>
        <p>Start building a more evidence-led device verification workflow.</p>
        <div className="hero-ctas">
          <Link href="/create-account" className="btn btn-primary">
            Create Your Account
          </Link>
          <Link href="/contact" className="btn btn-ghost light">
            Talk to CYVRA
          </Link>
        </div>
      </section>
    </>
  );
}
