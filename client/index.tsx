import { Link, Route, Router, Routes } from "./router";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Detect } from "./Detect";
import { Home } from "./Home";
import { Limits } from "./Limits";
import { Scenarios } from "./Scenarios";
import { ExternalLink } from "./ui";

const NAV = [
  { to: "/", label: "How it works" },
  { to: "/scenarios", label: "Content types" },
  { to: "/detect", label: "Detect it" },
  { to: "/limits", label: "Limits & sources" }
];

export function App() {
  const [currentPath, setCurrentPath] = useState("/");
  const [headerHidden, setHeaderHidden] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const lastPathRef = useRef(window.location.pathname);
  const pathInitRef = useRef(false);
  const lastYRef = useRef(window.scrollY);
  // Wheel/touch inertia can keep scrolling briefly after a navigation lands
  // at the top; don't let that residual drift hide the freshly shown header.
  const navGraceUntilRef = useRef(0);

  const jumpToTop = () => {
    window.scrollTo(0, 0);
    lastYRef.current = 0;
    navGraceUntilRef.current = Date.now() + 800;
    setHeaderHidden(false);
    mainRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const syncPath = () => {
      const next = window.location.pathname;
      const samePage = next === lastPathRef.current;
      lastPathRef.current = next;
      if (!pathInitRef.current) {
        pathInitRef.current = true;
        setCurrentPath(next);
        return;
      }
      // A Link to the page we are already on means "back to the top".
      if (samePage) jumpToTop();
      else setCurrentPath(next);
    };
    syncPath();
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  // Reserve the header's exact space as a constant: the fixed header slides
  // away, but the content below never reflows.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const sync = () =>
      document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let scheduled = false;
    const update = () => {
      scheduled = false;
      const y = window.scrollY;
      if (y <= 8) setHeaderHidden(false);
      else if (y > lastYRef.current + 4 && Date.now() >= navGraceUntilRef.current)
        setHeaderHidden(true);
      else if (y < lastYRef.current - 4) setHeaderHidden(false);
      lastYRef.current = y;
    };
    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    };
    const showOnFocus = () => setHeaderHidden(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    headerRef.current?.addEventListener("focusin", showOnFocus);
    return () => {
      window.removeEventListener("scroll", onScroll);
      headerRef.current?.removeEventListener("focusin", showOnFocus);
    };
  }, []);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    jumpToTop();
  }, [currentPath]);

  return (
    <Router>
      <style>{":root{color-scheme:dark}::selection{background:rgba(16,185,129,.35)}*{scrollbar-color:#404040 #000000}"}</style>
      <div className="min-h-screen bg-black pt-(--header-h,4rem) text-neutral-200">
        <a className="sr-only z-50 bg-white px-3 py-2 text-black focus:not-sr-only focus:fixed focus:left-3 focus:top-3" href="#main-content">
          Skip to content
        </a>
        <header
          className={`fixed inset-x-0 top-0 z-40 border-b border-neutral-900 bg-black transition-transform ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
            headerHidden ? "duration-150 -translate-y-full" : "duration-200 translate-y-0"
          }`}
          ref={headerRef}
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2 sm:py-4 lg:max-w-6xl xl:max-w-7xl xl:px-8 2xl:max-w-352">
            <Link className="flex items-center gap-2 text-sm font-bold tracking-tight text-white" to="/">
              <span className="flex h-6 w-6 items-center justify-center border border-emerald-500/60 bg-emerald-500/10 font-mono text-xs text-emerald-400">≋</span>
              Watermark explanation
            </Link>
            <nav aria-label="Primary" className="flex w-full gap-5 overflow-x-auto pb-1 text-sm whitespace-nowrap [scrollbar-width:none] sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
              {NAV.map((n) => (
                <Link aria-current={currentPath === n.to ? "page" : undefined} className="flex min-h-7 shrink-0 items-center text-neutral-400 transition-colors hover:text-white aria-[current=page]:text-white aria-[current=page]:underline" key={n.to} to={n.to}>
                  {n.label}
                </Link>
              ))}
            </nav>
            <p className="ml-auto hidden text-[11px] text-neutral-400 md:block">
              based on Anthropic's explainer · SynthID-Text family
            </p>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-5 py-7 outline-none sm:py-10 lg:max-w-6xl xl:max-w-7xl xl:px-8 2xl:max-w-352" id="main-content" ref={mainRef} tabIndex={-1}>
          <Routes>
            <Route element={<Home />} path="/" />
            <Route element={<Scenarios />} path="/scenarios" />
            <Route element={<Detect />} path="/detect" />
            <Route element={<Limits />} path="/limits" />
            <Route
              element={
                <section>
                  <h1 className="mb-4 text-3xl font-bold">Not found</h1>
                  <Link className="text-emerald-300 hover:text-emerald-200" to="/">
                    Back to the explainer
                  </Link>
                </section>
              }
              path="*"
            />
          </Routes>
        </main>

        <footer className="border-t border-neutral-900">
          <div className="mx-auto max-w-5xl px-5 py-6 text-[11px] leading-5 text-neutral-400 lg:max-w-6xl xl:max-w-7xl xl:px-8 2xl:max-w-352">
            <p>An unofficial educational demo, not affiliated with Anthropic or Google DeepMind. The SynthID math is reference-checked; the model,
            tokenizer, and detector thresholds are stand-ins for the approach described in{" "}
            <ExternalLink className="text-neutral-400 underline decoration-neutral-700 underline-offset-2 hover:text-neutral-200" href="https://www.anthropic.com/news/how-claudes-text-watermark-works">
              How Claude's text watermark works
            </ExternalLink>
            .</p>
          </div>
        </footer>
      </div>
    </Router>
  );
}
