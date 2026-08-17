// Detect — a playground for the detector. Generate (or paste) text, hold the
// key, and watch a weighted keyed-coin score decide whether the watermark
// is present. Presets demonstrate the behaviours the explainer describes:
// confidence grows with length, wrong keys fail, light edits weaken but
// rarely kill the signal, full rewrites remove it.
//
// Accuracy note: the published detector needs only token IDs, the key and
// masks—never generation logits. This miniature follows that pipeline and
// uses decreasing per-layer weights with a one-sided normal approximation;
// the p-value displayed is the same value used for the verdict.
import { useEffect, useMemo, useState } from "preact/hooks";
import { makeRng } from "../shared/synthid";
import { detectText, detectTokenIds, generateTrace, type DetectionResult } from "../shared/watermark";
import { SCENARIOS } from "../shared/scenarios";
import { Button, Card, KeyInput, SectionTitle } from "./ui";
import { readParam, writeParams } from "./urlState";

const KEY = "***";
const prose = SCENARIOS.find((s) => s.id === "prose")!;

function generate(watermark: boolean, seed: number) {
  return generateTrace(prose.specs, { watermark, key: KEY, rng: makeRng(seed) });
}

const BASE = generate(true, 11);
const PLAIN = generate(false, 11);
const REWRITTEN = generate(false, 777);

/**
 * Light edit: swap ~`rate` of the watermarkable words for a single-word
 * alternative from the same step's candidate set (single-word swaps keep
 * the token sequence aligned, like a careful human paraphrase). Returns
 * token IDs and surface forms together.
 */
function lightEdit(rate: number, seed: number): { ids: number[]; surfaces: string[] } {
  const rng = makeRng(seed);
  const ids: number[] = [];
  const surfaces: string[] = [];
  for (const s of BASE.steps) {
    if (s.watermarked && s.candidates.length > 1 && rng() < rate) {
      const alts = s.candidates.filter((c, j) => j !== s.chosenIndex);
      if (alts.length > 0) {
        const pick = alts[Math.floor(rng() * alts.length)];
        ids.push(pick.id);
        surfaces.push(pick.text);
        continue;
      }
    }
    ids.push(s.chosenId);
    surfaces.push(s.chosenToken);
  }
  return { ids, surfaces };
}

interface Preset {
  id: string;
  label: string;
  note: string;
  tokenIds: number[];
  key: string;
  render: string;
  /** Surface form per token position, for the per-token chip view. */
  surfaces: string[];
}

/** Presets grouped by what happens to the watermark signal. */
const PRESET_GROUPS: { label: string; ids: string[] }[] = [
  { label: "the signal survives", ids: ["wm", "edit"] },
  { label: "no signal left", ids: ["human", "wrongkey", "rewrite"] },
  { label: "the detector abstains", ids: ["short"] }
];

const EDITED_LIGHT = lightEdit(0.15, 99);

const PRESETS: Preset[] = [
  {
    id: "wm",
    label: "Watermarked text",
    note: "Generated with the watermark on. The detector recomputes every ngram's g-values from the token IDs and the key, and the mean g sits well above the 0.5 chance level.",
    tokenIds: BASE.tokenIds,
    key: KEY,
    render: BASE.text,
    surfaces: BASE.steps.map((s) => s.chosenToken)
  },
  {
    id: "human",
    label: "Unwatermarked text",
    note: "The same toy model with the watermark off. When we run the same detector over it, we expect that the tokens agree with the key at chance level (mean g ≈ 0.5).",
    tokenIds: PLAIN.tokenIds,
    key: KEY,
    render: PLAIN.text,
    surfaces: PLAIN.steps.map((s) => s.chosenToken)
  },
  {
    id: "wrongkey",
    label: "Watermarked, wrong key",
    note: "Watermarked text, checked with the wrong key. The recomputed g-values have nothing to do with the ones used in generation, so the score falls back to chance.",
    tokenIds: BASE.tokenIds,
    key: "another-key-999",
    render: BASE.text,
    surfaces: BASE.steps.map((s) => s.chosenToken)
  },
  {
    id: "edit",
    label: "Lightly edited",
    note: "About 15% of the tokens are swapped for alternatives from the same steps. One replacement changes its own scored ngram plus up to four later overlapping contexts, so the signal weakens. Heavier editing weakens it more.",
    tokenIds: EDITED_LIGHT.ids,
    key: KEY,
    render: EDITED_LIGHT.surfaces.join(""),
    surfaces: EDITED_LIGHT.surfaces
  },
  {
    id: "rewrite",
    label: "Fully rewritten",
    note: "The same idea, written fresh without the watermark. Nearly every token changes, and the original key-consistent ngrams are gone.",
    tokenIds: REWRITTEN.tokenIds,
    key: KEY,
    render: REWRITTEN.text,
    surfaces: REWRITTEN.steps.map((s) => s.chosenToken)
  },
  {
    id: "short",
    label: "Too short to tell",
    note: "Only the first 6 tokens of the watermarked text. Six tokens give two complete ngrams, below this demo's 12-ngram minimum, so the detector abstains. Production thresholds depend on the deployment and its target false-positive rate.",
    tokenIds: BASE.tokenIds.slice(0, 6),
    key: KEY,
    render: BASE.steps.slice(0, 6).map((s) => s.chosenToken).join(""),
    surfaces: BASE.steps.slice(0, 6).map((s) => s.chosenToken)
  }
];

export function Detect() {
  const [preset, setPreset] = useState(() => {
    const fromUrl = readParam("preset");
    return fromUrl && PRESETS.some((p) => p.id === fromUrl) ? fromUrl : PRESETS[0].id;
  });
  const [freeText, setFreeText] = useState("");
  const [freeKey, setFreeKey] = useState(KEY);
  const [freeResult, setFreeResult] = useState<(DetectionResult & { surfaces: string[] }) | null>(null);
  const [pasteError, setPasteError] = useState("");

  // Bridge intake: /detect?text=…&key=… arrives from the generation demo.
  // Runs once on mount; the result is deterministic, so refresh reproduces it.
  useEffect(() => {
    const text = readParam("text");
    if (!text) return;
    const key = readParam("key") || KEY;
    setFreeText(text);
    setFreeKey(key);
    setFreeResult(detectText(text, key));
  }, []);

  const active = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];

  const presetResult: DetectionResult = useMemo(
    () => detectTokenIds(active.tokenIds, active.key),
    [active]
  );

  return (
    <div>
      <SectionTitle
        kicker="detection"
        level={1}
        title="Run the detector"
        sub="Give it text and a key. It tokenizes the text, rebuilds each ngram context, recomputes the 30 keyed g-values, applies the repetition mask, and scores the result against chance. It never touches the model or its logits."
      />

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-3">
        {PRESET_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.ids.map((id) => {
                const p = PRESETS.find((preset) => preset.id === id)!;
                return (
                  <Button
                    aria-pressed={p.id === preset}
                    className={p.id === preset ? "border-emerald-500/70 bg-emerald-500/12 text-emerald-200" : ""}
                    key={p.id}
                    onClick={() => {
                      setPreset(p.id);
                      writeParams({ preset: p.id, text: null, key: null });
                    }}
                    tone="choice"
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="reading-rail mb-4 border-l-2 border-emerald-500/50 pl-3 text-xs leading-5 text-neutral-400">{active.note}</p>

      <Card className="mb-4 overflow-hidden">
        <div className="border-b border-neutral-800 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            preset text · key: <span className="font-mono text-emerald-400">{active.key}</span>
            {" · weighted keyed-coin z test"}
          </p>
        </div>
        <div className="max-h-48 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-mono text-sm leading-6 text-neutral-300">
          {active.render}
        </div>
        <div className="border-t border-neutral-800 px-4 py-3">
          <DetectionReport result={presetResult} surfaces={active.surfaces} />
        </div>
      </Card>

      {/* Free paste area */}
      <Card className="mb-4 p-4">
        <p className="mb-2 text-sm font-semibold">Paste any text</p>
        <p className="reading-rail mb-3 text-xs leading-5 text-neutral-400" id="detector-text-help">
          The same detector runs on pasted text, re-tokenized with this site's tokenizer (whitespace runs, IDs derived from surface forms). Text from
          this site's demos re-detects exactly; other text behaves like the unwatermarked preset.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <KeyInput
            label="key"
            onChange={(value) => {
              setFreeKey(value);
              setFreeResult(null);
            }}
            value={freeKey}
          />
          <Button
            icon="check"
            onClick={() => {
              if (!freeText.trim()) {
                setFreeResult(null);
                setPasteError("Paste some text first — the detector needs text to score.");
                return;
              }
              setPasteError("");
              setFreeResult(detectText(freeText, freeKey));
            }}
            tone="primary"
          >
            Check text
          </Button>
        </div>
        <label className="mb-1 block text-xs font-medium text-neutral-300" htmlFor="detector-text">Text to check</label>
        <textarea
          aria-describedby="detector-text-help"
          aria-invalid={pasteError ? "true" : undefined}
          className="h-28 w-full resize-y border border-neutral-800 bg-black p-3 text-sm leading-6 text-neutral-200 outline-none focus:border-emerald-500/60"
          id="detector-text"
          onInput={(e) => {
            setFreeText((e.target as HTMLTextAreaElement).value);
            setFreeResult(null);
            setPasteError("");
          }}
          placeholder="Paste text here…"
          spellcheck={false}
          value={freeText}
        />
        {pasteError ? <p className="mt-2 text-xs text-amber-300" role="alert">{pasteError}</p> : null}
        {freeResult ? (
          <div aria-live="polite" className="mt-3 border-t border-neutral-800 pt-3" role="status">
            <DetectionReport result={freeResult} surfaces={freeResult.surfaces} />
          </div>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold text-sky-300">Detection needs two things</p>
          <p className="text-xs leading-5 text-neutral-400">
            The key and the text. Published SynthID detection re-tokenizes the text, rebuilds the keyed g-values, applies the repetition and
            end-of-sequence masks, and scores with mean, weighted-mean, frequentist, or trained-Bayesian statistics. It never touches the model or its
            logits. This page uses decreasing layer weights and a one-sided normal approximation, so a production detector will calibrate its thresholds
            differently.
          </p>
        </Card>
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold text-amber-300">What a hit doesn't prove</p>
          <p className="text-xs leading-5 text-neutral-400">
            A watermark answers one question: did this model probably write this text? It says nothing about who drafted the rest or whether a human
            edited it first. And a miss never proves human authorship: the text could come from another model, or from an unwatermarked run.
          </p>
        </Card>
      </div>
    </div>
  );
}

function scorePct(z: number): number {
  return Math.max(0, Math.min(100, ((z + 2) / 8) * 100));
}

function DetectionReport({ result, surfaces }: { result: DetectionResult; surfaces?: string[] }) {
  const verdictMeta: Record<DetectionResult["verdict"], { label: string; cls: string }> = {
    strong: { label: "STRONG watermark signal", cls: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" },
    likely: { label: "Watermark LIKELY present", cls: "border-emerald-500/40 bg-emerald-500/5 text-emerald-400" },
    inconclusive: { label: "Inconclusive: too little text", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
    none: { label: "No watermark signal", cls: "border-neutral-700 bg-neutral-900 text-neutral-400" }
  };
  const v = verdictMeta[result.verdict];
  const pct = scorePct(result.z);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className={"border px-3 py-1 text-sm font-bold tracking-wide " + v.cls}>{v.label}</span>
        <span className="font-mono text-xs text-neutral-400">
          z = {result.z.toFixed(2)} · p ≈ {result.pValue < 0.001 ? result.pValue.toExponential(1) : result.pValue.toFixed(3)} · mean g = {result.meanScore.toFixed(3)}
        </span>
      </div>

      <div className="mb-1 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="relative h-3 bg-neutral-900">
            <div aria-hidden="true" className="absolute inset-y-0 w-px bg-neutral-500" style={{ left: `${scorePct(0)}%` }} />
            <div aria-hidden="true" className="absolute inset-y-0 w-px bg-neutral-500" style={{ left: `${scorePct(2.326)}%` }} />
            <div aria-hidden="true" className="absolute inset-y-0 w-px bg-neutral-400" style={{ left: `${scorePct(3.09)}%` }} />
            <div className="h-full bg-gradient-to-r from-neutral-600 via-sky-500 to-emerald-400" style={{ width: `${pct}%` }} />
          </div>
          <div className="relative mt-1 h-4 text-[11px] leading-4 text-neutral-400">
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${scorePct(0)}%` }}>chance</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${scorePct(2.326)}%` }}>p=.01</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${scorePct(3.09)}%` }}>p=.001</span>
          </div>
        </div>
        <div className="w-48 shrink-0 text-right font-mono text-xs text-neutral-400">
          {result.n} ngrams scored · {result.masked} masked
        </div>
      </div>
      <p className="mb-4 text-[11px] text-neutral-400">
        Chance is z = 0. Under the independent keyed-coin null, the one-sided normal approximation marks "likely" at p ≤ .01 (z ≈ 2.326) and "strong" at p ≤ .001 (z ≈ 3.09). The raw score threshold grows with text length.
      </p>

      {/* Per-layer evidence */}
      <div className="mb-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">evidence per watermark layer</p>
        <div className="flex gap-px">
          {result.layerMeans.map((m, i) => {
            const lift = (m - 0.5) / 0.5; // -1..1
            const bg = lift > 0 ? `rgba(16,185,129,${Math.min(0.15 + lift * 0.7, 0.85)})` : `rgba(244,63,94,${Math.min(0.15 - lift * 0.7, 0.85)})`;
            return (
              <div
                className="h-6 flex-1"
                key={i}
                style={{ background: bg }}
                title={`layer ${i + 1}: mean g = ${m.toFixed(3)} (weight ${i < result.layerMeans.length / 2 ? "high" : "low"})`}
              />
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">
          Each layer contributes keyed evidence; this demo scores it with an independent keyed-coin null approximation. Earlier layers carry higher weight (10 → 1, the reference detector's default). Green layers lean with the key, red against it, and intensity shows distance from chance.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {result.steps.map((s, i) => {
          const gm = s.gValues.length ? s.gValues.reduce((a, g) => a + g, 0) / s.gValues.length : 0;
          const cls = !s.scored
            ? "border-neutral-800 bg-neutral-950/50 text-neutral-400 line-through decoration-neutral-700"
            : gm >= 0.5
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-neutral-800 bg-neutral-950 text-neutral-400";
          const label = surfaces?.[i] ?? String(s.tokenId);
          return (
            <span className={"border px-1.5 py-0.5 font-mono text-xs " + cls} key={i} title={s.scored ? `mean g = ${gm.toFixed(2)} of 30 layers` : s.contextIds.length < 4 ? "no full context yet" : "repeated context: masked"}>
              {label.trim() || "␣"}
            </span>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-4 text-neutral-400">
        One chip per token; green = its 30 keyed g-values lean with the key, grey = they lean against it. Struck-through chips are excluded from the score:
        the first n−1 positions (no full context yet) and repeated contexts. Hover for the per-token mean g.
      </p>
    </div>
  );
}
