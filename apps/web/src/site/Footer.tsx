import { Link } from "./router";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div>
          <img
            src="/brand/cyvoriq-logo.png"
            alt="CYVRA Mobile"
            className="site-logo site-logo-footer"
          />
          <p className="site-markline">CYVRA Mobile</p>
          <p>Know the Device. Prove the Result.</p>
          <p className="muted small">CYVORIQ Solutions Pvt. Ltd. · India</p>
        </div>
        <div>
          <h3>Product</h3>
          <Link href="/platform">Platform</Link>
          <Link href="/device-verification">Device Verification</Link>
          <Link href="/sanitization">Sanitization</Link>
          <Link href="/reports">Reports</Link>
          <Link href="/station">CYVRA Station</Link>
        </div>
        <div>
          <h3>Company</h3>
          <Link href="/industries">Industries</Link>
          <Link href="/resources">Resources</Link>
          <Link href="/company">Company</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div>
          <h3>Account</h3>
          <Link href="/create-account">Create Account</Link>
          <Link href="/sign-in">Sign In</Link>
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
        CYVRA Mobile is technology and evidence software. Use of CYVRA does not
        constitute government certification, legal advice or a guarantee of
        compliance with any particular law or regulation.
      </p>
      <p className="muted small">© 2026 CYVORIQ Solutions Pvt. Ltd. All rights reserved.</p>
    </footer>
  );
}
