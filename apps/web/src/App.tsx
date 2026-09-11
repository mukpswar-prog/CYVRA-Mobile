import { useEffect, useState } from "react";
import { api } from "./api";
import { Layout } from "./site/Layout";
import { Home } from "./site/Home";
import {
  AboutPage,
  ContactPage,
  DeviceVerificationPage,
  EnterprisePage,
  FaqPage,
  HowItWorksPage,
  IndustriesPage,
  LegalPage,
  PlatformPage,
  ReportsPage,
  ResourcesPage,
  SanitizationPage,
  StationPage,
} from "./site/Pages";
import { AdminApp } from "./site/AdminApp";
import { isAdminHost } from "./site/hosts";
import { usePath } from "./site/router";
import { WorkspaceApp } from "./site/WorkspaceApp";

function isOpsPath(path: string): boolean {
  if (path === "/ops") return true;
  if (typeof window === "undefined") return false;
  return (
    window.location.hash === "#ops" ||
    new URLSearchParams(window.location.search).has("ops")
  );
}

const TITLES: Record<string, string> = {
  "/": "CYVRA Mobile | Mobile Device Verification, Sanitization & Evidence",
  "/platform": "CYVRA Mobile Platform | Evidence-Led Device Lifecycle",
  "/device-verification": "Mobile Device Verification & Diagnostics | CYVRA Mobile",
  "/sanitization": "Mobile Device Sanitization | Controlled & Evidence-Led | CYVRA",
  "/reports": "Mobile Device Evidence Reports | CYVRA Mobile",
  "/station": "CYVRA Station | Professional Mobile Device Processing",
  "/industries": "Mobile Device Lifecycle Solutions | ITAD, Refurbishment & Enterprise",
  "/company": "CYVORIQ Solutions | Building Evidence-Led Technology",
  "/about": "CYVORIQ Solutions | Building Evidence-Led Technology",
  "/contact": "Contact CYVORIQ | CYVRA Mobile",
  "/create-account": "Create Your CYVRA Mobile Account",
  "/sign-in": "Sign In | CYVRA Mobile",
};

export function App() {
  const path = usePath();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    document.title = TITLES[path] ?? "CYVRA Mobile";
  }, [path]);

  useEffect(() => {
    api
      .me()
      .then((result) => setSignedIn(Boolean(result.user)))
      .catch(() => setSignedIn(false));
  }, [path]);

  if (isAdminHost()) return <AdminApp />;
  if (isOpsPath(path)) return <AdminApp />;
  if (path === "/create-account") return <WorkspaceApp mode="register" />;
  if (path === "/sign-in" || path === "/verify-email") {
    return <WorkspaceApp mode="signin" />;
  }
  if (path === "/dashboard" || path === "/devices" || path === "/settings") {
    return <WorkspaceApp mode="dashboard" />;
  }

  let page = <Home />;
  if (path === "/platform") page = <PlatformPage />;
  else if (path === "/how-it-works") page = <HowItWorksPage />;
  else if (path === "/device-verification") page = <DeviceVerificationPage />;
  else if (path === "/sanitization") page = <SanitizationPage />;
  else if (path === "/reports") page = <ReportsPage />;
  else if (path === "/station") page = <StationPage />;
  else if (path === "/enterprise") page = <EnterprisePage />;
  else if (path === "/industries") page = <IndustriesPage />;
  else if (path === "/company" || path === "/about") page = <AboutPage />;
  else if (path === "/resources") page = <ResourcesPage />;
  else if (path === "/faq") page = <FaqPage />;
  else if (path === "/contact") page = <ContactPage />;
  else if (path === "/privacy") page = <LegalPage title="Privacy Policy" />;
  else if (path === "/terms") page = <LegalPage title="Terms of Use" />;
  else if (path === "/licence") page = <LegalPage title="Licence Terms" />;
  else if (path === "/cookies") page = <LegalPage title="Cookie Policy" />;
  else if (path !== "/") page = <Home />;

  return <Layout signedIn={signedIn}>{page}</Layout>;
}
