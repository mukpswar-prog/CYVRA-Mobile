import { Link } from "./router";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div>
          <img
            src="/brand/cyvoriq-logo.png"
            alt="CYVORIQ Solutions"
            className="site-logo site-logo-footer"
          />
          <p className="site-markline">Know Every Device. Prove Every Decision.</p>
          <p className="muted small">
            CYVRA is developed by CYVORIQ Solutions Pvt. Ltd.
          </p>
        </div>
        <div>
          <h3>Platform</h3>
          <Link href="/platform">CYVRA Mobile Evidence</Link>
          <Link href="/station">CYVRA Station</Link>
          <Link href="/enterprise">CYVRA Enterprise</Link>
        </div>
        <div>
          <h3>Solutions</h3>
          <Link href="/device-verification">Device Verification</Link>
          <Link href="/sanitization">Sanitization</Link>
          <Link href="/reports">Evidence &amp; Reporting</Link>
          <Link href="/how-it-works">Device Lifecycle</Link>
        </div>
        <div>
          <h3>Company</h3>
          <Link href="/about">About CYVORIQ</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/resources">Resources</Link>
          <Link href="/faq">FAQ</Link>
        </div>
        <div>
          <h3>Legal</h3>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
          <Link href="/licence">Licence Terms</Link>
          <Link href="/cookies">Cookie Policy</Link>
        </div>
      </div>
      <p className="site-legal-note">
        CYVRA is a technology and evidence platform. Use of CYVRA does not by
        itself constitute government certification, legal advice or a guarantee
        of compliance with any specific law or regulation.
      </p>
      <p className="muted small">© 2026 CYVORIQ Solutions Pvt. Ltd. All rights reserved.</p>
    </footer>
  );
}
