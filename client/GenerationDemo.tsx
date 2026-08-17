// GenerationDemo — the heart of the site. Animates token-by-token generation
// through the SynthID-Text miniature, with BOTH runs shown side by side:
//   1. the model's candidate distribution and the distribution ACTUALLY
//      sampled from after the tournament probability update,
//   2. the 30 keyed layers' g-values behind the shift,
//   3. two texts growing in lockstep — same prompt, same random stream, only
//      the tournament update differs — with differing choices highlighted
//      (and an optional differences-only view),
//   4. live detection readouts for both runs — from token IDs + key alone.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Link } from "./router";
import { fnv1a, makeRng } from "../shared/synthid";
import { detectTokenIds, generateTrace, type DetectionResult, type StepSpec, type StepResult, type TraceResult } from "../shared/watermark";
import { Badge, Button, KeyInput } from "./ui";
import { readParam, writeParam } from "./urlState";

interface Props {
  specs: StepSpec[];
  prompt?: string;
  mono?: boolean;
  defaultKey?: string;
  showControls?: boolean;
}

type Phase = "idle" | "running" | "done";

const STEP_MS = 90;

type Segment = { kind: "token"; i: number } | { kind: "collapse"; from: number; to: number };

export function GenerationDemo({
  specs,
  prompt,
  mono = false,
  defaultKey = "demo-key-001",
  showControls = true
}: Props) {
  const [key, setKey] = useState(() =>
    showControls ? readParam("key") || defaultKey : defaultKey
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIdx, setStepIdx] = useState(0);
  const [inspectedStep, setInspectedStep] = useState<number | null>(null);
  const [diffsOnly, setDiffsOnly] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Both runs share one fixed random stream (seeded by the key). The ONLY
  // difference between the panes is the SynthID probability update, which
  // makes the side-by-side comparison causal rather than two unrelated draws.
  const seed = useMemo(() => fnv1a(key + "#comparison-stream"), [key]);
  const traceWm = useMemo(
    () => generateTrace(specs, { watermark: true, key, rng: makeRng(seed) }),
    [specs, key, seed]
  );
  const tracePlain = useMemo(
    () => generateTrace(specs, { watermark: false, key, rng: makeRng(seed) }),
    [specs, key, seed]
  );

  // Detection from token IDs alone — the same information boundary as the
  // published detector (this miniature uses its own tokenizer IDs).
  const detectionWm: DetectionResult | null = useMemo(() => {
    const ids = traceWm.tokenIds.slice(0, stepIdx);
    if (ids.length < 6) return null;
    return detectTokenIds(ids, key);
  }, [traceWm, stepIdx, key]);
  const detectionPlain: DetectionResult | null = useMemo(() => {
    const ids = tracePlain.tokenIds.slice(0, stepIdx);
    if (ids.length < 6) return null;
    return detectTokenIds(ids, key);
  }, [tracePlain, stepIdx, key]);

  // Animation loop — one index drives both panes in lockstep.
  useEffect(() => {
    if (phase !== "running") return;
    if (stepIdx >= traceWm.steps.length) {
      setPhase("done");
      return;
    }
    timer.current = setTimeout(() => setStepIdx((i) => i + 1), STEP_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, stepIdx, traceWm.steps.length]);

  function start() {
    setStepIdx(0);
    setInspectedStep(null);
    setPhase("running");
  }

  function skipToEnd() {
    setStepIdx(traceWm.steps.length);
    setPhase("done");
  }

  function reset() {
    setStepIdx(0);
    setInspectedStep(null);
    setPhase("idle");
  }

  const diffs = useMemo(
    () => traceWm.steps.map((s, i) => s.chosenId !== tracePlain.steps[i].chosenId),
    [traceWm, tracePlain]
  );
  const diffCount = diffs.slice(0, stepIdx).filter(Boolean).length;

  const shown = traceWm.steps.slice(0, stepIdx);
  const decisionIndex = inspectedStep !== null && inspectedStep < shown.length
    ? inspectedStep
    : phase === "running" && stepIdx < traceWm.steps.length
      ? stepIdx
      : phase === "done" && shown.length > 0
        ? shown.length - 1
        : null;
  const decision: StepResult | null = decisionIndex === null ? null : traceWm.steps[decisionIndex];
  const plainPick = decisionIndex === null ? null : tracePlain.steps[decisionIndex];
  const maxCandidateRows = useMemo(
    () => Math.max(1, ...specs.map((s) => s.candidates.length)),
    [specs]
  );
  const tournamentApplied = shown.filter((s) => s.watermarked).length;
  const masked = shown.filter((s) => s.repeatedContext).length;

  return (
    <div className="border border-neutral-800 bg-neutral-950">
      {/* Controls */}
      {showControls ? (
        <div className="flex flex-col gap-3 border-b border-neutral-800 px-4 py-3 sm:flex-row sm:items-center">
          <KeyInput label="key" onChange={(v) => { setKey(v); writeParam("key", v || null); reset(); }} value={key} />
          <div className="flex flex-wrap gap-2 sm:ml-auto sm:justify-end">
            {phase !== "running" ? (
              <Button icon={phase === "done" ? "replay" : "play"} onClick={start} title="Both panes replay the same random stream, so the side-by-side comparison is controlled" tone="primary">
                {phase === "done" ? "Replay same draw" : "Generate"}
              </Button>
            ) : (
              <Button icon="finish" onClick={skipToEnd}>Finish</Button>
            )}
            {phase !== "idle" ? (
              <Button icon="reset" onClick={reset} tone="quiet">Reset</Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {prompt ? (
        <p className="border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
          <span className="text-neutral-400">prompt:</span> {prompt}
        </p>
      ) : null}

      {/* The two runs, side by side */}
      <div className="grid gap-0 md:grid-cols-2">
        <RunPane
          diffs={diffs}
          diffsOnly={diffsOnly}
          divider
          header="with watermark"
          headerClass="text-emerald-400"
          headerNote="30 keyed layers tilt the odds"
          mono={mono}
          onInspect={setInspectedStep}
          phase={phase}
          stepIdx={stepIdx}
          textClass={watermarkedTokenClasses}
          trace={traceWm}
          watermark
        />
        <RunPane
          diffs={diffs}
          diffsOnly={diffsOnly}
          header="without watermark"
          headerClass="text-neutral-400"
          headerNote="ordinary sampling"
          mono={mono}
          onInspect={setInspectedStep}
          phase={phase}
          stepIdx={stepIdx}
          textClass={() => "text-neutral-300"}
          trace={tracePlain}
        />
      </div>

      {/* Difference summary */}
      <div className="flex min-h-[38px] flex-wrap items-center gap-3 border-t border-neutral-800 px-4 py-2 text-xs">
        {stepIdx > 0 ? (
          <>
            <span className="text-neutral-400">
              {diffCount === 0
                ? `the runs agree on all ${stepIdx} choices so far: the watermark shifts odds and never forces a word`
                : <>
                    the runs disagree on <span className="font-mono text-amber-300">{diffCount}</span> of <span className="font-mono">{stepIdx}</span> choices
                    <span className="ml-2 rounded-sm px-1 text-amber-300 ring-1 ring-amber-400/60">ringed above</span>
                  </>}
            </span>
            <Button
              className="ml-auto min-h-8 px-2.5 text-[11px]"
              icon="filter"
              onClick={() => setDiffsOnly((v) => !v)}
              tone="quiet"
            >
              {diffsOnly ? "show full text" : "show differences only"}
            </Button>
          </>
        ) : (
          <span className="text-neutral-400">same prompt · same stream of random numbers · one difference: the tournament update</span>
        )}
      </div>

      {/* The decision machinery (watermarked run; the plain run's pick is marked) */}
      <div className="border-t border-neutral-800 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">next-token distribution · watermarked run</p>
          {inspectedStep !== null ? <span className="text-[11px] text-emerald-400">inspecting token {inspectedStep + 1}</span> : null}
        </div>

        <div className="min-h-[286px]">
          {decision ? (
            <div>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] leading-4 text-neutral-400">
                {decision.watermarked ? (
                  <span>
                    tournament applied: <span className="text-emerald-400">30 keyed layers</span> · distribution shift {formatProbability(decision.effectSize)} TV
                    <span className="ml-2 font-mono text-[11px] text-neutral-400">ctx ids: [{decision.contextIds.join(", ")}]</span>
                  </span>
                ) : decision.repeatedContext ? (
                  <span><span className="text-amber-400">repeated context</span>: the base distribution is used, and detection skips this step</span>
                ) : (
                  <span><span className="text-sky-400">context building</span>: no complete four-token context yet</span>
                )}
                {plainPick ? (
                  <span className={decision.chosenId === plainPick.chosenId ? "text-neutral-400" : "text-amber-300"}>
                    same random draw: watermarked run picked “{decision.chosenToken.trim() || "␣"}” · plain run picked “{plainPick.chosenToken.trim() || "␣"}”
                  </span>
                ) : null}
              </div>

              <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-neutral-400">
                <span className="w-24">candidate</span><span className="flex-1">sampled distribution</span><span className="w-28 whitespace-nowrap text-right">model → sampled</span><span className="w-9 text-right">g</span>
              </div>
              <div className="space-y-1.5">
                {Array.from({ length: maxCandidateRows }, (_, i) => {
                  const c = decision.candidates[i];
                  if (!c) return <div aria-hidden="true" className="h-6.25" key={`empty-${i}`} />;
                  const chosen = i === decision.chosenIndex;
                  const plainChose = plainPick ? plainPick.chosenId === c.id : false;
                  const delta = c.sampledProb - c.baseProb;
                  const barColor = !decision.watermarked || Math.abs(delta) < 1e-9
                    ? "bg-sky-500/60"
                    : delta > 0
                      ? "bg-emerald-500/75"
                      : "bg-rose-500/55";
                  return (
                    <div className={"flex h-6.25 items-center gap-2 border px-1 text-xs " + (chosen ? "border-amber-400/60 bg-amber-400/5" : "border-transparent")} key={c.id}>
                      <span className={"w-24 truncate font-mono " + (chosen ? "font-semibold text-amber-200" : "text-neutral-300")} title={c.text}>
                        {chosen ? "✓ " : ""}{c.text.trim() || "␣"}{plainChose && !chosen ? <span className="text-sky-400" title="picked by the unwatermarked run"> ◇</span> : null}
                      </span>
                      <div className="relative h-2.5 flex-1 bg-neutral-900">
                        <div
                          className={"h-full transition-[width] " + barColor}
                          style={{ width: `${c.sampledProb * 100}%`, minWidth: c.sampledProb > 0 ? "1px" : undefined }}
                        />
                        {decision.watermarked ? <div className="absolute top-0 h-full w-px bg-white/60" style={{ left: `${c.baseProb * 100}%` }} title="model probability before SynthID" /> : null}
                      </div>
                      <span className="w-28 whitespace-nowrap text-right font-mono text-[11px] text-neutral-400">{formatProbability(c.baseProb)} → {formatProbability(c.sampledProb)}</span>
                      <span className="w-9 text-right font-mono text-[11px] text-neutral-400">{decision.watermarked ? `${c.gValues.reduce((a, g) => a + g, 0)}/30` : "—"}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 min-h-12 text-[11px] leading-4 text-neutral-400">
                Bars show what the watermarked run actually samples from; white ticks mark the model's probabilities before SynthID. The checkmark is
                its random draw, and the diamond is the candidate the plain run drew from the same stream. The g count is just a summary: the ordered
                layer updates set the final probability.
              </p>
            </div>
          ) : (
            <p className="text-xs leading-5 text-neutral-400">At each step the model supplies candidate probabilities. The watermarked run applies the 30 ordered updates and then samples; the plain run samples directly. Both consume the same random numbers.</p>
          )}
        </div>

        {/* Live counters: reserved height prevents the section jumping. */}
        <div className="mt-3 min-h-10 border-t border-neutral-800 pt-3 text-xs text-neutral-400">
          {stepIdx > 0 ? <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>tokens generated <span className="font-mono">{stepIdx}</span></span>
            <span>tournament steps <span className="font-mono text-emerald-300">{tournamentApplied}</span></span>
            {masked > 0 ? (
              <span>repeated contexts (masked) <span className="font-mono text-amber-300">{masked}</span></span>
            ) : null}
            <span>
              mean g of chosen tokens{" "}
              <span className="font-mono text-emerald-300">
                {(() => {
                  const scored = shown.filter((s) => s.watermarked);
                  if (!scored.length) return "—";
                  const m = scored.reduce((a, s) => a + s.gOfChosen.reduce((x, g) => x + g, 0), 0) / (scored.length * 30);
                  return m.toFixed(3);
                })()}
                <span className="text-neutral-400"> / 0.5 chance</span>
              </span>
            </span>
          </div> : null}
        </div>
      </div>

      {/* Live detection, one readout per run */}
      <p aria-live="polite" className="sr-only" role="status">
        {phase === "idle"
          ? "Generation ready."
          : phase === "running"
            ? `Generating ${traceWm.steps.length} tokens in lockstep.`
            : `Generation complete: ${stepIdx} tokens, ${diffCount} differing choices. Watermarked detector ${detectionWm?.verdict ?? "not enough text"}; unwatermarked detector ${detectionPlain?.verdict ?? "not enough text"}.`}
      </p>
      <div className="grid gap-0 border-t border-neutral-800 md:grid-cols-2">
        <div className="px-4 py-3 md:border-r md:border-neutral-800">
          <DetectionStrip detection={detectionWm} label="detector · watermarked run" watermarked />
        </div>
        <div className="border-t border-neutral-800 px-4 py-3 md:border-l md:border-t-0">
          <DetectionStrip detection={detectionPlain} label="detector · unwatermarked run" />
        </div>
      </div>

      {stepIdx > 0 ? (
        <div className="border-t border-neutral-800 px-4 py-3 text-xs">
          <Link
            className="text-emerald-300 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-200"
            to={`/detect?text=${encodeURIComponent(traceWm.steps.slice(0, stepIdx).map((s) => s.chosenToken).join(""))}&key=${encodeURIComponent(key)}`}
          >
            check this watermarked text on the Detect page →
          </Link>
          <span className="ml-2 text-neutral-400">the text and the key come along</span>
        </div>
      ) : null}
    </div>
  );
}

/** Classes for a token of the watermarked run: how the tournament moved it,
 * plus the amber ring when the two runs chose differently at this position. */
function watermarkedTokenClasses(step: StepResult, differs: boolean): string {
  const picked = step.candidates[step.chosenIndex];
  const pickedShift = picked.sampledProb - picked.baseProb;
  let cls = "text-neutral-200";
  if (step.watermarked) {
    if (step.effectSize < 0.005) cls = "bg-sky-500/5 text-neutral-400 rounded-sm";
    else if (pickedShift > 0) cls = "bg-emerald-500/20 text-emerald-100 rounded-sm";
    else cls = "bg-rose-500/10 text-rose-200/80 rounded-sm";
  } else {
    cls = "text-neutral-400";
  }
  return differs ? cls + " ring-1 ring-amber-400/70" : cls;
}

/** Split the shown positions into diff tokens and collapsed runs of
 * identical picks (for the differences-only view). */
function diffSegments(diffs: boolean[], stepIdx: number): Segment[] {
  const parts: Segment[] = [];
  let runStart = -1;
  for (let i = 0; i < stepIdx; i++) {
    if (diffs[i]) {
      if (runStart >= 0) {
        parts.push({ kind: "collapse", from: runStart, to: i });
        runStart = -1;
      }
      parts.push({ kind: "token", i });
    } else if (runStart < 0) {
      runStart = i;
    }
  }
  if (runStart >= 0) parts.push({ kind: "collapse", from: runStart, to: stepIdx });
  return parts;
}

function RunPane({
  header,
  headerClass,
  headerNote,
  textClass,
  diffs,
  diffsOnly,
  divider = false,
  phase,
  mono,
  onInspect,
  stepIdx,
  trace,
  watermark = false
}: {
  header: string;
  headerClass: string;
  headerNote: string;
  textClass: (step: StepResult, differs: boolean) => string;
  diffs: boolean[];
  diffsOnly: boolean;
  divider?: boolean;
  phase: Phase;
  mono: boolean;
  onInspect: (i: number | null) => void;
  stepIdx: number;
  trace: TraceResult;
  watermark?: boolean;
}) {
  const shown = trace.steps.slice(0, stepIdx);
  const shownDiffCount = diffs.slice(0, stepIdx).filter(Boolean).length;

  return (
    <div className={divider ? "border-b border-neutral-800 md:border-b-0 md:border-r" : ""}>
      <div className="flex items-baseline gap-2 border-b border-neutral-900 px-4 py-2">
        <p className={"text-[11px] font-semibold uppercase tracking-wider " + headerClass}>{header}</p>
        <p className="text-[11px] text-neutral-400">{headerNote}</p>
      </div>
      <div className="min-h-45 px-4 py-4">
        <div className={mono ? "whitespace-pre-wrap font-mono text-sm leading-6" : "text-[15px] leading-7"}>
          {diffsOnly
            ? diffSegments(diffs, stepIdx).map((p, k) =>
                p.kind === "token" ? (
                  <TokenText differs={diffs[p.i]} index={p.i} key={p.i} onInspect={onInspect} step={trace.steps[p.i]} textClass={textClass} />
                ) : (
                  <span className="mx-1 inline-block select-none rounded-sm border border-neutral-800 bg-neutral-900/60 px-1.5 py-0.5 align-middle font-mono text-[11px] text-neutral-400" key={`c-${k}`} title={`${p.to - p.from} tokens chosen identically by both runs`}>
                    ·· {p.to - p.from} identical ··
                  </span>
                )
              )
            : shown.map((s, i) => (
                <TokenText differs={diffs[i]} index={i} key={i} onInspect={onInspect} step={s} textClass={textClass} />
              ))}
          {phase === "running" ? <span className="animate-pulse text-neutral-400 motion-reduce:animate-none">▊</span> : null}
          {phase === "idle" ? <span className="text-neutral-400 italic">press generate…</span> : null}
        </div>

        {watermark && stepIdx > 0 ? (
          <div className="mt-4 min-h-13">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-400">
              <span><span className="bg-emerald-500/20 px-1 text-emerald-300">odds raised</span> the tournament increased this token's probability</span>
              <span><span className="bg-rose-500/10 px-1 text-rose-300">odds lowered</span> it remained possible and was still sampled</span>
              <span><span className="bg-sky-500/5 px-1 text-neutral-400">unchanged</span> a peaked distribution left no meaningful mass to move</span>
              <span><span className="rounded-sm px-1 text-amber-300 ring-1 ring-amber-400/70">ringed</span> the plain run chose a different token here</span>
            </div>
          </div>
        ) : null}
        {!watermark && stepIdx > 0 ? (
          <div className="mt-4 min-h-13 text-xs leading-5 text-neutral-400">
            {shownDiffCount > 0
              ? "Same model, same random stream. Without the update, this run's picks drift apart exactly where the other run's odds were shifted."
              : "Same model, same random stream. Wherever a low-stakes choice exists, both runs remain free to pick either word."}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TokenText({
  step,
  index,
  differs,
  onInspect,
  textClass
}: {
  step: StepResult;
  index: number;
  differs: boolean;
  onInspect: (i: number | null) => void;
  textClass: (step: StepResult, differs: boolean) => string;
}) {
  const picked = step.candidates[step.chosenIndex];
  const pickedShift = picked.sampledProb - picked.baseProb;
  // Candidate strings carry their own leading whitespace so generation and
  // re-tokenization agree. Keep that whitespace outside the marked element:
  // otherwise backgrounds colour the gap before a word and rings can split
  // into odd fragments when an inline token wraps across lines.
  const tokenParts = /^(\s*)(.*?)(\s*)$/s.exec(step.chosenToken);
  const leadingWhitespace = tokenParts?.[1] ?? "";
  const tokenBody = tokenParts?.[2] ?? step.chosenToken;
  const trailingWhitespace = tokenParts?.[3] ?? "";
  const shiftNote = step.watermarked && step.effectSize >= 0.005
    ? (pickedShift > 0 ? "odds raised" : "odds lowered")
    : "no meaningful probability shift";
  return (
    <>
      {leadingWhitespace}
    <span
      className={textClass(step, differs) + " inline-block cursor-help px-0.5 leading-[1.4] focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-sky-400"}
      onBlur={() => onInspect(null)}
      onFocus={() => onInspect(index)}
      onMouseEnter={() => onInspect(index)}
      onMouseLeave={() => onInspect(null)}
      tabIndex={0}
      title={differs
        ? "the two runs chose differently at this position"
        : `model ${formatProbability(picked.baseProb)} → sampled ${formatProbability(picked.sampledProb)}; ${shiftNote}`}
    >
      {tokenBody || "␣"}
    </span>
    {trailingWhitespace}
    </>
  );
}

function formatProbability(p: number): string {
  const pct = p * 100;
  if (p === 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  if (pct > 99.9) return ">99.9%";
  return (pct < 10 ? pct.toFixed(1) : pct.toFixed(0)) + "%";
}

/** Gauge spans z=-2..6; p=.01 and p=.001 are the two verdict marks. */
function scorePct(z: number): number {
  return Math.max(0, Math.min(100, ((z + 2) / 8) * 100));
}

function DetectionStrip({ detection, label, watermarked }: { detection: DetectionResult | null; label: string; watermarked?: boolean }) {
  if (!detection) {
    return <p className="text-xs text-neutral-400">{label}: waiting for enough text to score…</p>;
  }

  const pct = scorePct(detection.z);
  const verdictLabel: Record<DetectionResult["verdict"], string> = {
    strong: "strong watermark signal",
    likely: "watermark likely present",
    inconclusive: "too little text to tell",
    none: "no watermark signal"
  };
  const verdictTone: Record<DetectionResult["verdict"], "green" | "amber" | "neutral"> = {
    strong: "green",
    likely: "green",
    inconclusive: "amber",
    none: "neutral"
  };

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
        <Badge tone={verdictTone[detection.verdict]}>{verdictLabel[detection.verdict]}</Badge>
        {!watermarked ? <Badge tone="blue">generated without a watermark</Badge> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="relative h-2.5 bg-neutral-900">
            <div aria-hidden="true" className="absolute inset-y-0 w-px bg-neutral-500" style={{ left: `${scorePct(0)}%` }} />
            <div aria-hidden="true" className="absolute inset-y-0 w-px bg-neutral-500" style={{ left: `${scorePct(2.326)}%` }} />
            <div aria-hidden="true" className="absolute inset-y-0 w-px bg-neutral-400" style={{ left: `${scorePct(3.09)}%` }} />
            <div className="h-full bg-linear-to-r from-neutral-600 via-sky-500 to-emerald-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="relative mt-1 h-4 text-[11px] leading-4 text-neutral-400">
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${scorePct(0)}%` }}>chance</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${scorePct(2.326)}%` }}>p=.01</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${scorePct(3.09)}%` }}>p=.001</span>
          </div>
        </div>
        <p className="w-44 shrink-0 font-mono text-xs text-neutral-400">
          z = {detection.z.toFixed(2)} · mean g {detection.meanScore.toFixed(3)} · {detection.n} ngrams
          {detection.masked > 0 ? ` · ${detection.masked} masked` : ""}
        </p>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-neutral-400">
        one-sided p ≈ {detection.pValue < 0.001 ? detection.pValue.toExponential(1) : detection.pValue.toFixed(3)} from the weighted keyed-coin null (likely ≤ .01, strong ≤ .001).
      </p>
    </div>
  );
}
