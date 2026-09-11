import { useState } from "react";
import { Link } from "./router";

const platform = [
  { href: "/platform", label: "CYVRA Mobile Evidence" },
  { href: "/station", label: "CYVRA Station" },
  { href: "/enterprise", label: "CYVRA Enterprise" },
];

const resources = [
  { href: "/resources", label: "Resources" },
  { href: "/faq", label: "FAQs" },
  { href: "/contact", label: "Contact" },
];

export function Header(props: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-brand" onClick={() => setOpen(false)}>
          <img
            src="/brand/cyvoriq-logo.png"
            alt="CYVORIQ Solutions"
            className="site-logo"
          />
          <span className="site-brand-text">
            <strong>CYVRA</strong>
            <small>CYVORIQ Solutions Pvt. Ltd.</small>
          </span>
        </Link>

        <button
          type="button"
          className="site-menu-btn"
          aria-expanded={open}
          aria-label="Open menu"
          onClick={() => setOpen((value) => !value)}
        >
          Menu
        </button>

        <nav className={open ? "site-nav is-open" : "site-nav"} aria-label="Primary">
          <div className="site-drop">
            <span>Platform</span>
            <div className="site-drop-panel">
              {platform.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <Link href="/how-it-works" onClick={() => setOpen(false)}>
            How CYVRA Works
          </Link>
          <Link href="/device-verification" onClick={() => setOpen(false)}>
            Device Verification
          </Link>
          <Link href="/sanitization" onClick={() => setOpen(false)}>
            Sanitization
          </Link>
          <Link href="/reports" onClick={() => setOpen(false)}>
            Reports &amp; Evidence
          </Link>
          <Link href="/industries" onClick={() => setOpen(false)}>
            Industries
          </Link>
          <div className="site-drop">
            <span>Resources</span>
            <div className="site-drop-panel">
              {resources.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className="site-actions">
          {props.signedIn ? (
            <Link href="/dashboard" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Workspace
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Sign In
              </Link>
              <Link href="/create-account" className="btn btn-primary" onClick={() => setOpen(false)}>
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
