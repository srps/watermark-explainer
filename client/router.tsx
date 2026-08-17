// Minimal history router standing in for the platform router this app was
// originally written against (Router, Routes, Route, Link). It matches on
// pathname only; query strings belong to urlState.ts.

import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";

const PathContext = createContext("/");

function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || "/";
}

export function Router({ children }: { children: ComponentChildren }) {
  const [path, setPath] = useState(() => normalize(window.location.pathname));

  useEffect(() => {
    const sync = () => setPath(normalize(window.location.pathname));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return <PathContext.Provider value={path}>{children}</PathContext.Provider>;
}

export function Routes({ children }: { children: ComponentChildren }) {
  const path = useContext(PathContext);
  const routes = (Array.isArray(children) ? children : [children]).filter(Boolean) as JSX.Element[];
  const match = routes.find(
    (route) => route.props.path === "*" || normalize(route.props.path) === path
  );
  return match ?? null;
}

export function Route({ element, path: _path }: { element: ComponentChildren; path: string }) {
  return <>{element}</>;
}

type LinkProps = JSX.HTMLAttributes<HTMLAnchorElement> & {
  to: string;
  children?: ComponentChildren;
};

export function Link({ to, children, onClick, ...props }: LinkProps) {
  return (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        // Skip pushState for the page we are on: same-page clicks mean
        // "back to top", not a new history entry.
        if (window.location.pathname !== to) window.history.pushState(null, "", to);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      {children}
    </a>
  );
}
