// Home — a visual walkthrough of how the watermark works, end to end.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Link } from "./router";
import { GenerationDemo } from "./GenerationDemo";
import { Card, SectionTitle } from "./ui";
import { SCENARIOS } from "../shared/scenarios";
import { gValues, makeConfig, makeRng, updateProbs } from "../shared/synthid";
import { generateTrace, tokenId } from "../shared/watermark";

const FACTS = [
  { icon: "invisible", title: "No measured quality loss", body: "DeepMind's controlled evaluations and nearly 20-million-response live experiment found no statistically significant quality difference; Anthropic reports the same in its internal evaluation. The signal lives in token choices, not hidden characters." },
  { icon: "no-extra-tokens", title: "No extra tokens", body: "The watermark rearranges the sampling odds among candidates. It adds no tokens; the SynthID paper reports negligible computational overhead, though production cost depends on the implementation." },
  { icon: "key", title: "Verification needs a matching detector", body: "This demo recomputes every ngram's g-values with the key. A deployed system can instead keep its detector private, expose it through an API, or publish it." },
  { icon: "random", title: "Sampling stays probabilistic", body: "The 30 layers change the probabilities, then sampling proceeds as usual. A token whose odds fell can still win the draw." },
  { icon: "no-identity", title: "No identity in the signal", body: "The watermark signal itself does not encode a user, organization, or chat. Separate service logs or file metadata can still carry identifying information." }
];

/** Fact icons: one drawn stroke family in the site's signal color, no emoji. */
function FactIcon({ name }: { name: string }) {
  const svg = (children: ComponentChildren, key: string) => (
    <svg aria-hidden="true" className="h-5 w-5 text-emerald-300" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 20 20" key={key}>
      {children}
    </svg>
  );
  switch (name) {
    case "invisible":
      return svg(<>
        <path d="M2.5 10c1.8-3.2 4.4-4.8 7.5-4.8s5.7 1.6 7.5 4.8c-1.8 3.2-4.4 4.8-7.5 4.8S4.3 13.2 2.5 10Z" />
        <circle cx="10" cy="10" r="2" />
        <path d="M4 16 16 4" />
      </>, name);
    case "no-extra-tokens":
      return svg(<>
        <rect height="7" rx="1.5" width="13" x="3.5" y="6.5" />
        <path d="M4.5 15.5 15.5 4.5" />
      </>, name);
    case "key":
      return svg(<>
        <circle cx="6" cy="10" r="2.5" />
        <path d="M8.5 10H16.5M13 10v2.5M16.5 10v2" />
      </>, name);
    case "random":
      return svg(<>
        <rect height="13" rx="2" width="13" x="3.5" y="3.5" />
        <circle cx="7" cy="7" fill="currentColor" r=".9" stroke="none" />
        <circle cx="10" cy="10" fill="currentColor" r=".9" stroke="none" />
        <circle cx="13" cy="13" fill="currentColor" r=".9" stroke="none" />
      </>, name);
    case "no-identity":
      return svg(<>
        <circle cx="10" cy="6.5" r="2.5" />
        <path d="M5 16.5c.8-3 2.6-4.5 5-4.5s4.2 1.5 5 4.5" />
        <path d="M3.5 16.5 16.5 3.5" />
      </>, name);
    default:
      return null;
  }
}

const PEAKED_REFERENCE_MEAN = [
  0.9003949165344238,
  0.04967997223138809,
  0.049936987459659576
];

function formatPct(p: number): string {
  const pct = p * 100;
  if (p === 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  if (pct > 99.9) return ">99.9%";
  return (pct < 10 ? pct.toFixed(1) : pct.toFixed(0)) + "%";
}

function formatMechanismPct(p: number): string {
  const pct = p * 100;
  if (p === 0) return "0%";
  if (pct < 0.01) return "<0.01%";
  if (pct > 99.99) return ">99.99%";
  if (pct >= 99) return pct.toFixed(2) + "%";
  if (pct < 1) return pct.toFixed(2) + "%";
  return pct.toFixed(1) + "%";
}

/**
 * Interactive visual of one watermarking step: candidates → 30 keyed layers
 * → probability update → sample.
 * Numbers are taken from a real run of the engine (prose scenario, key
 * demo-key-001) so the picture is not illustrative fiction.
 */
function MechanismDiagram() {
  // "…cold and ?" step from the prose scenario. Compute it rather than
  // copying numbers so the stated key, g bits, selected row and bars agree.
  const prose = SCENARIOS.find((s) => s.id === "prose")!;
  const step = generateTrace(prose.specs.slice(0, 7), {
    watermark: true,
    key: "demo-key-001",
    rng: makeRng(11)
  }).steps[6];
  const candidates = step.candidates.map((c, i) => ({
    t: c.text.trim(),
    base: c.baseProb,
    sampled: c.sampledProb,
    gValues: c.gValues,
    chosen: i === step.chosenIndex
  }));
  const probabilityHistory = Array.from({ length: 31 }, (_, completedLayers) =>
    updateProbs(
      candidates.map((candidate) => candidate.base),
      candidates.map((candidate) => candidate.gValues.slice(0, completedLayers))
    )
  );
  const [layer, setLayer] = useState(0);
  const current = probabilityHistory[layer];
  const before = probabilityHistory[Math.max(0, layer - 1)];
  const currentBits = layer === 0 ? null : candidates.map((candidate) => candidate.gValues[layer - 1]);
  const greenMass = currentBits
    ? currentBits.reduce((sum, bit, candidateIndex) => sum + bit * before[candidateIndex], 0)
    : null;
  const lineColors = ["#6ee7b7", "#7dd3fc", "#fbbf24", "#fb7185", "#c4b5fd"];
  const chartX = (index: number) => 54 + (index / 30) * 626;
  const chartY = (probability: number) => 18 + (1 - probability) * 214;

  return (
    <Card className="overflow-hidden border-emerald-500/30">
      <div className="grid border-b border-neutral-800 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,.75fr)]">
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-neutral-100">Watch the odds move, one round at a time</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-400">
                Drag through the 30 ordered rounds. A candidate's bit acts on the probabilities produced by every round before it.
              </p>
            </div>
            <div className="border border-neutral-700 bg-black px-3 py-2 text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500">now showing</span>
              <span className="font-mono text-sm tabular-nums text-emerald-300">{layer === 0 ? "model odds" : `round ${layer} of 30`}</span>
            </div>
          </div>

          <div className="mt-5" aria-label="Candidate probability by completed watermark round">
            <svg className="h-auto w-full" role="img" viewBox="0 0 720 260">
              <title>Probability trajectories for five candidate words over 30 ordered watermark rounds</title>
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
                <g key={tick}>
                  <line stroke="#262626" stroke-width="1" x1="54" x2="680" y1={chartY(tick)} y2={chartY(tick)} />
                  <text fill="#737373" font-size="10" text-anchor="end" x="46" y={chartY(tick) + 3}>{Math.round(tick * 100)}%</text>
                </g>
              ))}
              {[0, 10, 20, 30].map((tick) => (
                <text fill="#737373" font-size="10" key={tick} text-anchor={tick === 0 ? "start" : tick === 30 ? "end" : "middle"} x={tick === 30 ? chartX(tick) - 12 : chartX(tick)} y="253">{tick === 0 ? "model" : `round ${tick}`}</text>
              ))}
              {candidates.map((candidate, candidateIndex) => (
                <polyline
                  fill="none"
                  key={candidate.t}
                  points={probabilityHistory.map((probabilities, historyIndex) => `${chartX(historyIndex)},${chartY(probabilities[candidateIndex])}`).join(" ")}
                  stroke={lineColors[candidateIndex]}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-opacity={candidateIndex < 2 ? 1 : 0.62}
                  stroke-width={candidateIndex < 2 ? 2.5 : 1.5}
                />
              ))}
              <line stroke="#e5e5e5" stroke-dasharray="3 4" stroke-opacity=".7" x1={chartX(layer)} x2={chartX(layer)} y1="12" y2="235" />
              {candidates.map((candidate, candidateIndex) => (
                <circle cx={chartX(layer)} cy={chartY(current[candidateIndex])} fill={lineColors[candidateIndex]} key={candidate.t} r={candidateIndex < 2 ? 4 : 3} stroke="#0a0a0a" stroke-width="1.5" />
              ))}
            </svg>
          </div>

          <label className="mt-2 block text-xs font-medium text-neutral-300" for="watermark-layer">
            Completed rounds: <span className="font-mono tabular-nums text-emerald-300">{layer}</span>
          </label>
          <input
            aria-describedby="watermark-layer-help"
            className="mt-2 h-6 w-full cursor-pointer accent-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            id="watermark-layer"
            max="30"
            min="0"
            onInput={(event) => setLayer(Number((event.currentTarget as HTMLInputElement).value))}
            step="1"
            type="range"
            value={layer}
          />
          <p className="mt-1 text-[11px] leading-4 text-neutral-500" id="watermark-layer-help">Use the arrow keys for precise, round-by-round movement.</p>
        </div>

        <div className="border-t border-neutral-800 bg-neutral-950/70 p-4 sm:p-5 lg:border-l lg:border-t-0">
          <h3 className="text-sm font-semibold text-neutral-100">{layer === 0 ? "Start with the model" : `What round ${layer} does`}</h3>
          {layer === 0 ? (
            <p className="mt-2 text-xs leading-5 text-neutral-400">Before the watermark acts, these are the toy model's own probabilities. Move the slider one step to apply the first keyed bits.</p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-neutral-400">
              The candidates with <span className="font-mono text-emerald-300">g = 1</span> currently hold <span className="font-mono text-neutral-200">{formatMechanismPct(greenMass!)}</span> of the probability mass. This round moves relative weight toward that group.
            </p>
          )}
          <div className="mt-4 space-y-3">
            {candidates.map((candidate, candidateIndex) => {
              const bit = currentBits?.[candidateIndex];
              const rose = bit === 0;
              return (
                <div key={candidate.t}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: lineColors[candidateIndex] }} />
                    <span className="min-w-0 flex-1 truncate font-medium text-neutral-200">{candidate.t}</span>
                    {bit == null ? null : <span className={"font-mono text-[11px] " + (rose ? "text-rose-300" : "text-emerald-300")}>g = {bit}</span>}
                    <span className="w-28 text-right font-mono text-[11px] tabular-nums text-neutral-300">
                      {layer === 0 ? formatMechanismPct(current[candidateIndex]) : `${formatMechanismPct(before[candidateIndex])} → ${formatMechanismPct(current[candidateIndex])}`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 bg-neutral-900">
                    <div className="h-full transition-[width] duration-150" style={{ backgroundColor: lineColors[candidateIndex], width: `${current[candidateIndex] * 100}%`, minWidth: current[candidateIndex] > 0 ? "1px" : undefined }} />
                  </div>
                </div>
              );
            })}
          </div>
          {layer === 30 ? (
            <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-5 text-neutral-300">
              Now the model samples from these final odds. The random draw in this seeded run was <strong className="text-amber-200">“{candidates.find((candidate) => candidate.chosen)?.t}”</strong> That outcome was not selected merely for having the most 1 bits.
            </p>
          ) : null}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">The bits are an ordered recipe, not a score</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-400">
              Each column is one round. Use the slider above to inspect it. The total at right only counts 1s; it cannot predict the final ranking because it throws away their order and the changing probability mass.
            </p>
          </div>
          <div className="flex gap-3 text-[11px] text-neutral-400" aria-hidden="true">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-emerald-500/80" />g = 1</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-rose-500/55" />g = 0</span>
          </div>
        </div>
        <div aria-hidden="true" className="mt-4 hidden overflow-x-auto pb-1 sm:block">
          <div className="min-w-190 space-y-1.5">
            {candidates.map((candidate) => (
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_7rem] items-center gap-2" key={candidate.t}>
                <span className="truncate text-xs font-medium text-neutral-300">{candidate.t}</span>
                <div className="grid grid-cols-30 gap-px">
                  {candidate.gValues.map((bit, bitIndex) => (
                    <span
                      className={"h-5 border transition-[border-color,filter] " +
                        (bit ? "border-emerald-500/20 bg-emerald-500/75" : "border-rose-500/20 bg-rose-500/45") +
                        (layer === bitIndex + 1 ? " border-white brightness-125" : "")}
                      key={bitIndex}
                      title={`Round ${bitIndex + 1}: g = ${bit}`}
                    />
                  ))}
                </div>
                <span className="text-right font-mono text-[11px] tabular-nums text-neutral-500">
                  {candidate.gValues.reduce((sum, bit) => sum + bit, 0)}/30 <span className="font-sans">count only</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <p aria-live="polite" className="mt-4 border border-neutral-800 bg-black px-3 py-2 text-xs leading-5 text-neutral-300 sm:sr-only">
          {layer === 0
            ? "The matrix begins with the model probabilities. Move the slider to inspect a watermark round."
            : `Round ${layer}: ${candidates.map((candidate) => `${candidate.t} has g = ${candidate.gValues[layer - 1]}`).join("; ")}.`}
        </p>
        <div className="mt-4 grid gap-3 border-t border-neutral-800 pt-4 sm:grid-cols-2">
          <p className="text-xs leading-5 text-neutral-300"><strong className="text-sky-300">Grey has 17 ones</strong>, but their positions send it to {formatMechanismPct(candidates[1].sampled)} in this sequence.</p>
          <p className="text-xs leading-5 text-neutral-300"><strong className="text-emerald-300">Overcast has only 16 ones</strong>, but its ordered path sends it to {formatMechanismPct(candidates[0].sampled)}.</p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Makes the paper's meaning of “non-distortionary” concrete. One keyed seed
 * can radically change a distribution; averaging over fresh keyed seeds
 * recovers the model distribution. The reference means below come from the
 * checked-in 200k-trial DeepMind-reference probe in .test/xval_behaviour.py.
 */
function QualityClaim() {
  const base = [0.9, 0.05, 0.05];
  const labels = ["likely", "rare A", "rare B"];
  const config = makeConfig("demo-key-001");
  const context = ["ctx-53-a", "ctx-53-b", "ctx-53-c", "ctx-53-d"].map(tokenId);
  const ids = [" likely", " rare-a", " rare-b"].map(tokenId);
  const fixedContext = updateProbs(base, ids.map((id) => gValues(config, context, id)));

  return (
    <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-neutral-800 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">fixed context</p>
          <p className="mt-1 text-sm font-semibold">A 5% candidate can become almost certain</p>
        </div>
        <div className="overflow-x-auto px-4 py-3">
          <table className="w-full min-w-117.5 text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="pb-2 font-medium">candidate</th>
                <th className="pb-2 text-right font-medium">model</th>
                <th className="pb-2 text-right font-medium">this key + context</th>
                <th className="pb-2 text-right font-medium">mean over 200k g draws</th>
              </tr>
            </thead>
            <tbody className="font-mono text-neutral-300">
              {labels.map((label, i) => (
                <tr className="border-t border-neutral-900" key={label}>
                  <td className="py-2 font-sans text-neutral-400">{label}</td>
                  <td className="py-2 text-right">{formatPct(base[i])}</td>
                  <td className={"py-2 text-right " + (fixedContext[i] > 0.999 ? "text-amber-300" : "text-neutral-400")}>{formatPct(fixedContext[i])}</td>
                  <td className="py-2 text-right text-emerald-300">{formatPct(PEAKED_REFERENCE_MEAN[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-neutral-900 px-4 py-3 text-[11px] leading-5 text-neutral-400">
          <p>
            <strong className="text-neutral-300">Non-distortion is an average.</strong> The last column runs 200,000 independent g-value assignments through Google DeepMind's reference recurrence and averages the results.
          </p>
          <details className="mt-2 border-t border-neutral-900 pt-2">
            <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">Mathematical statement</summary>
            <div className="mt-2 border-l border-neutral-800 pl-3">
              <code className="text-emerald-300">Eᵣ[p_WM(x | c, r)] = p_LM(x | c)</code>
              <p className="mt-1">
                Here, <code>r</code> is the keyed pseudorandom seed and <code>c</code> is the token context. This does not imply <code>p_WM(x | c, r) = p_LM(x | c)</code> for a fixed <code>r</code>.
              </p>
            </div>
          </details>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold text-sky-300">It runs on every step</p>
          <p className="text-xs leading-5 text-neutral-400">
            The algorithm runs at every eligible, non-repeated context. It never measures entropy or asks whether candidates are near-ties, so a low-probability candidate already inside the top-k/top-p support can get a strong boost at a particular context.
          </p>
        </Card>
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold text-emerald-300">Impossible words stay impossible</p>
          <p className="text-xs leading-5 text-neutral-400">
            Every update multiplies. A token removed by top-k, top-p, or a hard constraint stays removed. Factual answers and constrained code can have a narrower post-decoding distribution, leaving less room for the watermark to move probability.
          </p>
        </Card>
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold text-amber-300">Answers can get better or worse</p>
          <p className="text-xs leading-5 text-neutral-400">
            The shifted odds might dodge a poor continuation or promote one. The g-values know nothing about meaning or quality, so either effect is accidental. Non-distortion is a statement about the expected token distribution; quality is a separate empirical question.
          </p>
        </Card>
      </div>
    </div>
  );
}

export function Home() {
  const prose = SCENARIOS.find((s) => s.id === "prose")!;

  return (
    <div>
      {/* Hero */}
      <section className="mb-8 border-b border-neutral-900 pb-8">
        <h1 className="reading-rail text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          How Claude's text watermark works, <span className="text-neutral-400">in a demo you can poke</span>
        </h1>
        <p className="reading-rail mt-4 leading-7 text-neutral-400">
          Anthropic's watermark changes one thing about how a language model writes: <strong className="text-neutral-200">the odds among the tokens
          still in play</strong>, nudged by a secret key across 30 ordered layers. Press generate, compare marked and unmarked toy outputs, then inspect them with this demo's detector.
        </p>
        <a className="mt-6 inline-flex min-h-11 items-center border border-emerald-500/70 bg-emerald-500/12 px-4 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:border-emerald-400 hover:bg-emerald-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400" href="#live-demo">
          Run the side-by-side demo ↓
        </a>
      </section>

      {/* Step 1: live side-by-side */}
      <section className="mb-12 scroll-mt-28" id="live-demo">
        <SectionTitle
          title="Check it against non-watermarked generation"
          sub="Same toy model, prompt, and random stream; only the watermark update differs. Generate both outputs together, then inspect the decisions token by token."
        />
        <GenerationDemo defaultKey="demo-key-001" prompt={prose.prompt} specs={prose.specs} />
        <p className="reading-rail mt-3 border-t border-neutral-900 pt-3 text-xs leading-5 text-neutral-400">
          This miniature implements the published SynthID-Text probability update, hashing, g-values, 30 layers, and repetition mask, cross-checked against Google DeepMind's reference code. Its toy model, tokenizer, and detector thresholds are stand-ins; they are not Claude's production components. The production description comes from Anthropic's August 2026 explainer and the algorithm from Dathathri et al. (Nature, 2024).
        </p>
        <p className="reading-rail mt-2 text-xs leading-5 text-neutral-400">
          Watch the detector strips at the bottom. The marked run's score tends to climb as key-consistent ngrams accumulate, while the unmarked run fluctuates around chance. Change the key and the keyed pattern changes with it.
        </p>
      </section>

      {/* Step 2: the mechanism */}
      <section className="mb-12">
        <SectionTitle
          title="How the watermark tilts the odds"
          sub={'After “The weather today was cold and”, the model has several plausible next words. The watermark runs 30 ordered probability updates, then samples normally. Scrub through one real step from this toy engine to see why counting a candidate’s 1 bits does not tell you where it will finish.'}
        />
        <MechanismDiagram />
        <p className="reading-rail mt-3 text-xs leading-5 text-neutral-400">
          All of this shows up in the live demo below. The update always produces a valid distribution, and on average it leaves the model's odds where
          they were. Without this demo's key, you can't reproduce its keyed test. And a repeated context gets watermarked only the first time it appears; the reference
          system masks the repeats out.
        </p>
      </section>

      {/* What non-distortion does and does not mean */}
      <section className="mb-12">
        <SectionTitle
          title="What the non-distortion guarantee covers"
          sub="One key and context can see big probability changes. Average over many keyed seeds, and each candidate returns to its model probability. There's no entropy check and no near-tie requirement."
        />
        <QualityClaim />
        <p className="reading-rail mt-3 text-xs leading-5 text-neutral-400">
          This demo verifies the probability update, the zero-support behavior, and the recovery of the average. Judging quality takes real models:
          DeepMind tested nearly 20 million Gemini responses plus human comparisons and benchmarks, and Anthropic ran its own internal evaluation.
        </p>
      </section>

      {/* Step 3: detection */}
      <section className="mb-12">
        <SectionTitle
          title="Checking the text afterwards"
          sub="Given the key, a detector re-tokenizes the text, recomputes every ngram's g-values, masks repeated contexts, and scores the result. It never needs the model or its logits. More text gives more evidence, and the score stays noisy."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="mb-1 text-sm font-semibold text-emerald-300">Longer text, clearer verdict</p>
            <p className="text-xs leading-5 text-neutral-400">Each eligible ngram adds keyed evidence under this demo's null approximation. Longer passages usually supply more evidence; short passages often remain inconclusive.</p>
          </Card>
          <Card className="p-4">
            <p className="mb-1 text-sm font-semibold text-amber-300">Exact outputs carry less signal</p>
            <p className="text-xs leading-5 text-neutral-400">Facts, quotations, and constrained code can produce narrower post-decoding distributions. The watermark cannot revive a zero-probability alternative, so these outputs may carry less evidence, especially when short.</p>
          </Card>
          <Card className="p-4">
            <p className="mb-1 text-sm font-semibold text-sky-300">The detector must match the mark</p>
            <p className="text-xs leading-5 text-neutral-400">This demo needs its key to reproduce the 30 g-values per ngram. Production systems may keep a detector private, expose an API, or publish one; that keyed evidence is still different from guessing from writing style alone.</p>
          </Card>
        </div>
        <p className="reading-rail mt-4 text-sm text-neutral-400">
          Try wrong keys, edits, and rewrites on the{" "}
          <Link className="text-emerald-300 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-200" to="/detect">Detect page</Link>.
        </p>
      </section>

      {/* Properties */}
      <section>
        <SectionTitle title="Properties and limits" sub="What the published work and vendor documentation support." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FACTS.map((f) => (
            <Card className="p-4" key={f.title}>
              <div className="mb-1.5"><FactIcon name={f.icon} /></div>
              <p className="mb-1 text-sm font-semibold">{f.title}</p>
              <p className="text-xs leading-5 text-neutral-400">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
