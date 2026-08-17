// Generation + detection glue for the miniature: runs the hand-authored
// candidate distributions through the cross-validated SynthID-Text core (shared/
// synthid.ts) and exposes the detector to the UI.
//
// The mechanism here is the published one (Dathathri et al., Nature 2024):
//
//   Generation, per token:
//     1. context = the previous ngramLen-1 token IDs,
//     2. if the context already occurred, the repetition mask applies and the
//        token is sampled from the BASE distribution (no bias),
//     3. otherwise each candidate receives `depth` keyed g-value bits and the
//        base probabilities pass through the tournament probability-update
//        recurrence, which shifts mass toward g=1 candidates layer by layer,
//     4. the next token is sampled from that distribution (still random —
//        the watermark changes the odds, not the outcome).
//
//   Detection, from token IDs ALONE — no model, no logits:
//     recompute contexts, g-values and the repetition mask with the key, and
//     run a disclosed weighted keyed-coin z score.
//
// Token IDs are stable: they are derived from the token's surface form the
// way a real tokenizer assigns fixed IDs. Generation, detection and the
// pasted-text tokenizer therefore always agree on the ngram contexts.

import {
  analyzeTokens,
  contextHash,
  expectedMeanGValue,
  gValuesForCandidates,
  makeConfig,
  sampleIndex,
  updateProbs,
  verdictFromAnalysis,
  DEFAULT_CONFIG,
  fnv1a,
  type SynthIdConfig,
  type TokenAnalysis,
  type Verdict
} from "./synthid.ts";

// ---------------------------------------------------------------------------
// Token IDs
// ---------------------------------------------------------------------------

/**
 * Stable token ID from a token's surface form — the miniature's tokenizer.
 * Any two occurrences of the same surface form share an ID (which is what
 * lets the detector rebuild the generator's contexts from text alone), and
 * the ID never depends on position, scenario, or run.
 */
export function tokenId(surface: string): number {
  // Two independent FNV-1a hashes → 30-bit positive ID. Callers validate the
  // surface-to-ID mapping and reject a collision instead of silently merging
  // two distinct tokens.
  const a = fnv1a("id-a\u0000" + surface);
  const b = fnv1a("id-b\u0000" + surface);
  return ((a ^ Math.imul(b, 0x9e3779b1)) >>> 0) % 0x3fffffff;
}

function assertUniqueTokenIds(entries: { id: number; text: string }[]): void {
  const surfacesById = new Map<number, string>();
  for (const entry of entries) {
    const previous = surfacesById.get(entry.id);
    if (previous !== undefined && previous !== entry.text) {
      throw new Error(`token ID collision between ${JSON.stringify(previous)} and ${JSON.stringify(entry.text)}`);
    }
    surfacesById.set(entry.id, entry.text);
  }
}

export interface CandidateInput {
  /** Stable ID for this surface form (tokenId(text)). */
  id: number;
  /** Surface form, including leading whitespace ("\n  if", " overcast."). */
  text: string;
  /** Relative likelihood weight (normalised internally). */
  w: number;
}

export interface StepSpec {
  candidates: CandidateInput[];
}

export interface GenOptions {
  watermark: boolean;
  key: string;
  /** Watermarking depth (layers). Defaults to the paper's 30. */
  depth?: number;
  /** Context window + 1. Defaults to the paper's 5. */
  ngramLen?: number;
  /** Source of randomness. Defaults to Math.random. */
  rng?: () => number;
}

export interface CandidateView {
  id: number;
  text: string;
  /** The model's distribution before watermarking. */
  baseProb: number;
  /** The distribution actually sampled from (after the update rule). */
  sampledProb: number;
  /** g-value per layer (empty when the step was not watermarked). */
  gValues: number[];
  /** Fraction of layers with g = 1. */
  gMean: number;
}

export interface StepResult {
  candidates: CandidateView[];
  chosenIndex: number;
  /** Surface form of the chosen token (may carry leading whitespace). */
  chosenToken: string;
  chosenId: number;
  /** Preceding token IDs fed to the hash. */
  contextIds: number[];
  /** Entropy of the base distribution (nats) — shown as "how open the
   * choice was"; it does NOT gate the watermark. */
  entropy: number;
  /** True when the tournament update was applied at this step. */
  watermarked: boolean;
  /** True when the context had occurred before (repetition mask). */
  repeatedContext: boolean;
  /** g-values of the chosen token (empty if the step was not watermarked). */
  gOfChosen: number[];
  /** Total-variation distance between the model and sampled distributions.
   * Zero means the tournament ran but had no odds to move. */
  effectSize: number;
}

export interface TraceResult {
  steps: StepResult[];
  text: string;
  tokenIds: number[];
}

function normalize(spec: StepSpec): { id: number; text: string; prob: number }[] {
  if (spec.candidates.length === 0) {
    throw new Error("a generation step must contain at least one candidate");
  }
  for (const candidate of spec.candidates) {
    if (!Number.isFinite(candidate.w) || candidate.w < 0) {
      throw new Error("candidate weights must be finite and non-negative");
    }
  }
  const total = spec.candidates.reduce((s, c) => s + c.w, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error("candidate weights must contain positive finite mass");
  }
  return spec.candidates.map((c) => ({
    id: c.id,
    text: c.text,
    prob: c.w / total
  }));
}

function entropyOf(dist: { prob: number }[]): number {
  let h = 0;
  for (const c of dist) {
    if (c.prob > 0) h -= c.prob * Math.log(c.prob);
  }
  return h;
}

/** Join raw surface forms (which embed their own whitespace) into text. */
export function renderTokens(tokens: string[]): string {
  return tokens.join("");
}

/**
 * Run the miniature model over a sequence of candidate distributions with
 * the SynthID-Text watermarking pipeline, producing a full trace.
 */
export function generateTrace(specs: StepSpec[], opts: GenOptions): TraceResult {
  const config = makeConfig(opts.key, {
    depth: opts.depth ?? DEFAULT_CONFIG.depth,
    ngramLen: opts.ngramLen ?? DEFAULT_CONFIG.ngramLen
  });
  const rng = opts.rng ?? Math.random;
  const chosenIds: number[] = [];
  const chosenTexts: string[] = [];
  const steps: StepResult[] = [];
  const history: bigint[] = [];
  const ctxWindow = config.ngramLen - 1;

  assertUniqueTokenIds(specs.flatMap((spec) => spec.candidates));

  for (const spec of specs) {
    const base = normalize(spec);
    const entropy = entropyOf(base);
    const contextIds = chosenIds.slice(-ctxWindow);
    const full = contextIds.length === ctxWindow;

    // Repetition mask, exactly as at detection: a context only counts the
    // first time it occurs, and only full contexts enter the history (the
    // reference's context always has ngram_len-1 tokens when recorded).
    let repeated = false;
    if (full) {
      const ch = contextHash(config, contextIds);
      repeated = history.includes(ch);
      history.unshift(ch);
      if (history.length > config.contextHistorySize) history.pop();
    }

    const watermarked = opts.watermark && full && !repeated;
    const gvs = watermarked
      ? gValuesForCandidates(config, contextIds, base.map((c) => c.id))
      : base.map(() => [] as number[]);
    const probs = watermarked ? updateProbs(base.map((c) => c.prob), gvs) : base.map((c) => c.prob);
    const effectSize = 0.5 * probs.reduce((sum, p, j) => sum + Math.abs(p - base[j].prob), 0);

    const idx = sampleIndex(probs, rng);
    chosenIds.push(base[idx].id);
    chosenTexts.push(base[idx].text);

    steps.push({
      candidates: base.map((c, j) => ({
        id: c.id,
        text: c.text,
        baseProb: c.prob,
        sampledProb: probs[j],
        gValues: gvs[j],
        gMean: gvs[j].length === 0 ? 0 : gvs[j].reduce((s, g) => s + g, 0) / gvs[j].length
      })),
      chosenIndex: idx,
      chosenToken: base[idx].text,
      chosenId: base[idx].id,
      contextIds,
      entropy,
      watermarked,
      repeatedContext: full && repeated,
      gOfChosen: gvs[idx],
      effectSize
    });
  }

  return { steps, text: renderTokens(chosenTexts), tokenIds: chosenIds };
}

// ---------------------------------------------------------------------------
// Detection (token IDs in, verdict out — no logits anywhere)
// ---------------------------------------------------------------------------

export interface DetectionResult extends TokenAnalysis { verdict: Verdict; }

/**
 * Detect the watermark in a sequence of token IDs. Everything the detector
 * uses is recomputable from the IDs + the key: contexts, g-values, masks.
 * The weighted statistic is standardised under the keyed-coin null, so its
 * score threshold changes with text length. The reported p-value and verdict
 * are derived from this same statistic.
 */
export function detectTokenIds(
  tokenIds: number[],
  key: string,
  opts?: { depth?: number; ngramLen?: number }
): DetectionResult {
  const config = makeConfig(key, { depth: opts?.depth, ngramLen: opts?.ngramLen });
  const analysis = analyzeTokens(tokenIds, config);
  return { ...analysis, verdict: verdictFromAnalysis(analysis) };
}

// ---------------------------------------------------------------------------
// Text ⇄ token IDs (lossless round-trip)
// ---------------------------------------------------------------------------

/**
 * Tokenize plain text exactly the way the generator emits tokens: each
 * piece is a whitespace prefix followed by one non-whitespace run — the
 * canonical surface form of every scenario token. A final whitespace-only
 * run is kept as its own token. JavaScript's Unicode-aware whitespace class
 * preserves tabs, line separators, non-breaking spaces, and other pasted
 * spacing rather than silently dropping them. IDs are derived with
 * tokenId(), so pasted text lands on the SAME IDs the generator used, for
 * every scenario (prose, code, translation alike).
 */
export function tokenize(text: string): { ids: number[]; surfaces: string[] } {
  const surfaces = text.match(/\s*\S+|\s+/gu) ?? [];
  const entries = surfaces.map((surface) => ({ id: tokenId(surface), text: surface }));
  assertUniqueTokenIds(entries);
  return { ids: entries.map((entry) => entry.id), surfaces };
}

/** Detect directly on pasted text. */
export function detectText(text: string, key: string, opts?: { depth?: number; ngramLen?: number }): DetectionResult & { surfaces: string[] } {
  const { ids, surfaces } = tokenize(text);
  const result = detectTokenIds(ids, key, opts);
  return { ...result, surfaces };
}

export { expectedMeanGValue, type SynthIdConfig, type TokenAnalysis, type Verdict };
