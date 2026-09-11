import { useState } from "react";
import { Link } from "./router";

const howItWorks = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/device-verification", label: "Device Verification" },
  { href: "/sanitization", label: "Sanitization" },
  { href: "/reports", label: "Reports" },
];

export function Header(props: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-brand" onClick={() => setOpen(false)}>
          <img
            src="/brand/cyvoriq-logo.png"
            alt="CYVRA Mobile"
            className="site-logo"
          />
          <span className="site-brand-text">
            <strong>CYVRA Mobile</strong>
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
          <Link href="/" onClick={() => setOpen(false)}>
            Home
          </Link>
          <Link href="/platform" onClick={() => setOpen(false)}>
            Platform
          </Link>
          <div className="site-drop">
            <button type="button" className="site-drop-btn" aria-haspopup="true">
              How It Works
            </button>
            <div className="site-drop-panel">
              {howItWorks.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <Link href="/station" onClick={() => setOpen(false)}>
            CYVRA Station
          </Link>
          <Link href="/industries" onClick={() => setOpen(false)}>
            Industries
          </Link>
          <Link href="/resources" onClick={() => setOpen(false)}>
            Resources
          </Link>
        </nav>

        <div className="site-actions">
          {props.signedIn ? (
            <Link href="/dashboard" className="btn btn-primary" onClick={() => setOpen(false)}>
              Workspace
            </Link>
          ) : (
            <Link href="/create-account" className="btn btn-primary" onClick={() => setOpen(false)}>
              Get Started
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
