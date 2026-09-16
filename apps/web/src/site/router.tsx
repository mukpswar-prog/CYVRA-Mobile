import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

export function currentPath(): string {
  const raw = window.location.pathname.replace(/\/+$/, "");
  return raw === "" ? "/" : raw;
}

export function navigate(to: string) {
  if (to === currentPath() && !to.includes("#")) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    function onChange() {
      setPath(currentPath());
    }
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

export function Link(props: {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    props.onClick?.();
    navigate(props.href);
  }
  return (
    <a href={props.href} className={props.className} onClick={onClick}>
      {props.children}
    </a>
  );
}
