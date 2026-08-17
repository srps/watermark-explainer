// Scenarios — how the watermark behaves across the content types discussed
// in Anthropic's explainer: dense in prose, sparse in facts, nearly
// absent in code and quotations, thin in proofreading, full in translation.
//
// Nothing here is special-cased: the same 30-layer tournament update runs at
// every eligible step. Zero-probability alternatives remain impossible;
// nearly deterministic support therefore often leaves little effect, while
// a rare keyed context can still move a merely low-probability token sharply.
// Repeated contexts are masked, so sparsity is not a content-type switch.

import { useState } from "preact/hooks";
import { GenerationDemo } from "./GenerationDemo";
import { Badge, Button, SectionTitle } from "./ui";
import { SCENARIOS } from "../shared/scenarios";
import { readParam, writeParam } from "./urlState";

const DENSITY_TONE: Record<string, "green" | "amber" | "neutral"> = {
  prose: "green",
  translation: "green",
  facts: "amber",
  proofread: "amber",
  code: "neutral",
  quote: "neutral"
};

/** Tabs grouped by how much watermark signal the content type carries. */
const TAB_GROUPS: { label: string; ids: string[] }[] = [
  { label: "dense signal", ids: ["prose", "translation"] },
  { label: "thin signal", ids: ["facts", "proofread"] },
  { label: "almost none", ids: ["code", "quote"] }
];

export function Scenarios() {
  const [active, setActive] = useState(() => {
    const fromUrl = readParam("scenario");
    return fromUrl && SCENARIOS.some((s) => s.id === fromUrl) ? fromUrl : SCENARIOS[0].id;
  });
  const scenario = SCENARIOS.find((s) => s.id === active) ?? SCENARIOS[0];

  function select(id: string) {
    setActive(id);
    writeParam("scenario", id);
  }

  return (
    <div>
      <SectionTitle
        kicker="content types"
        level={1}
        title="Where the watermark shows up"
        sub={
          "The watermark can only shuffle probability among the tokens the model still allows. Open prose offers many choices; exact facts, quotations, and code offer fewer. Every example below generates a watermarked and an unwatermarked run from the same random stream, so compare the two detector strips directly."
        }
      />

      {/* Scenario tabs, grouped by signal density */}
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-3">
        {TAB_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.ids.map((id) => {
                const s = SCENARIOS.find((sc) => sc.id === id)!;
                return (
                  <Button
                    aria-pressed={s.id === active}
                    className={s.id === active ? "border-emerald-500/70 bg-emerald-500/12 text-emerald-200" : ""}
                    key={s.id}
                    onClick={() => select(s.id)}
                    tone="choice"
                  >
                    {s.title}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Scenario summary */}
      <div className="mb-4 border border-neutral-800 bg-neutral-950 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{scenario.title}</p>
          <Badge tone={DENSITY_TONE[scenario.id] ?? "neutral"}>{scenario.expected}</Badge>
        </div>
        <p className="reading-rail mt-1.5 text-xs leading-5 text-neutral-400">{scenario.blurb}</p>
      </div>

      {/* key remounts the demo per scenario so runs never leak state across
          scenarios of different lengths */}
      <GenerationDemo
        defaultKey="demo-key-001"
        key={scenario.id}
        mono={scenario.kind === "code"}
        prompt={scenario.prompt}
        specs={scenario.specs}
      />

      <div className="reading-rail mt-4 border border-neutral-900 bg-neutral-950/50 px-4 py-3">
        <p className="text-xs leading-5 text-neutral-400">
          <span className="font-semibold text-neutral-300">Why: </span>
          {scenario.explanation}
        </p>
        <p className="mt-2 text-xs leading-5 text-neutral-400">
          Scope: these hand-authored candidate lists illustrate how the sampler reacts to different probability shapes. They are not a model-quality study, and this miniature's tokenizer and detector thresholds are not production implementations.
        </p>
      </div>
    </div>
  );
}
