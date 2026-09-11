import { useState } from "react";
import { Link } from "./router";

const links = [
  { href: "/platform", label: "Platform" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/device-verification", label: "Device Verification" },
  { href: "/sanitization", label: "Sanitization" },
  { href: "/reports", label: "Reports" },
  { href: "/station", label: "CYVRA Station" },
  { href: "/industries", label: "Industries" },
  { href: "/resources", label: "Resources" },
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
          {links.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
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
