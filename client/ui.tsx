// Shared UI primitives: cards, badges, section headings.

import type { ComponentChildren, JSX } from "preact";

export function Card({ children, className = "" }: { children: ComponentChildren; className?: string }) {
  return <div className={"border border-neutral-800 bg-neutral-950 " + className}>{children}</div>;
}

export function SectionTitle({ kicker, title, sub, level = 2 }: { kicker?: string; title: string; sub?: string; level?: 1 | 2 }) {
  return (
    <div className="reading-rail mb-6">
      {kicker ? <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">{kicker}</p> : null}
      {level === 1
        ? <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        : <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>}
      {sub ? <p className="mt-2 text-neutral-400">{sub}</p> : null}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "red" | "amber" | "neutral" | "blue"; children: ComponentChildren }) {
  const tones: Record<string, string> = {
    green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    red: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    neutral: "border-neutral-700 bg-neutral-900 text-neutral-300",
    blue: "border-sky-500/40 bg-sky-500/10 text-sky-300"
  };
  return <span className={"inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-medium " + tones[tone]}>{children}</span>;
}

type ButtonTone = "primary" | "secondary" | "quiet" | "choice";
type ButtonIcon = "play" | "replay" | "finish" | "reset" | "filter" | "check";

const buttonTones: Record<ButtonTone, string> = {
  primary: "border-emerald-500/70 bg-emerald-500/12 text-emerald-200 hover:border-emerald-400 hover:bg-emerald-500/20",
  secondary: "border-neutral-600 bg-neutral-900/60 text-neutral-200 hover:border-neutral-400 hover:bg-neutral-800/70",
  quiet: "border-neutral-700 bg-transparent text-neutral-400 hover:border-neutral-500 hover:bg-neutral-900 hover:text-neutral-200",
  choice: "border-neutral-700 bg-neutral-950 text-neutral-400 hover:border-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
};

/** One compact button language for the site's technical controls. */
export function Button({ children, className = "", icon, tone = "secondary", ...props }: JSX.HTMLAttributes<HTMLButtonElement> & {
  children: ComponentChildren;
  className?: string;
  icon?: ButtonIcon;
  tone?: ButtonTone;
}) {
  return (
    <button
      className={"inline-flex min-h-11 items-center justify-center gap-2 border px-3 py-1.5 text-xs font-semibold leading-none transition-[color,background-color,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-9 " + buttonTones[tone] + " " + className}
      type="button"
      {...props}
    >
      {icon ? <ButtonGlyph name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

function ButtonGlyph({ name }: { name: ButtonIcon }) {
  const paths: Record<ButtonIcon, ComponentChildren> = {
    play: <path d="m6.5 4.5 6 3.5-6 3.5Z" />,
    replay: <><path d="M4.2 5.5A5 5 0 1 1 3.5 10" /><path d="M4.2 2.8v2.7H1.5" /></>,
    finish: <><path d="m3.5 4.5 5 3.5-5 3.5Z" /><path d="m8.5 4.5 5 3.5-5 3.5Z" /></>,
    reset: <><path d="M4.2 5.5A5 5 0 1 1 3.5 10" /><path d="M4.2 2.8v2.7H1.5" /></>,
    filter: <><path d="M3 4h10M5 8h6M7 12h2" /></>,
    check: <path d="m3.5 8.2 2.8 2.8 6.2-6.2" />
  };
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 16 16">{paths[name]}</svg>;
}

export function KeyInput({ value, onChange, label = "key" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-neutral-400">
      {label}
      <input
        className="h-11 min-w-0 w-40 border border-neutral-700 bg-black px-2.5 font-mono text-emerald-300 outline-none transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 sm:h-9"
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        spellcheck={false}
        value={value}
      />
    </label>
  );
}

/** External link: opens in a new tab and says so with a drawn arrow, not just a color. */
export function ExternalLink({ href, children, className = "" }: { href: string; children: ComponentChildren; className?: string }) {
  return (
    <a className={className} href={href} rel="noopener noreferrer" target="_blank">
      {children}
      <svg aria-hidden="true" className="ml-1 inline-block h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 16 16">
        <path d="M3 13 13 3M7 3h6v6" />
      </svg>
    </a>
  );
}
