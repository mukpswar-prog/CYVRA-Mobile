import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Header } from "./Header";

export function Layout(props: { children: ReactNode; signedIn?: boolean }) {
  return (
    <div className="site">
      <Header signedIn={props.signedIn} />
      <main>{props.children}</main>
      <Footer />
    </div>
  );
}
