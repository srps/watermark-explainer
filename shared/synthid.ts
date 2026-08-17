// SynthID-Text engine — a faithful miniature of the watermark published in
// Dathathri et al., "Scalable watermarking for identifying large language
// model outputs", Nature 634 (2024), and implemented in DeepMind's reference
// code (github.com/google-deepmind/synthid-text).
//
// What is cross-validated against the reference implementation when the
// same integer layer keys are supplied:
//
//   * Keyed hashing: an accumulating LCG hash (newlib/musl multiplier
//     6364136223846793005, increment 1) over an initialization vector derived
//     from the key. The UI's string key is first expanded into `depth` int64
//     layer keys via a documented SHA-256 adapter (the reference accepts the
//     integer keys directly); the IV is then
//     SHA-256 of the layer keys' bytes reduced modulo int64-max, and every
//     ngram hash accumulates IV + context + token + layer key in wrapping
//     signed int64 arithmetic.
//   * Multiple watermarking layers: `depth` independent keys (the paper and
//     reference use 30). Each (context, candidate token, layer) triple hashes
//     to one g-value bit.
//   * g-value extraction (get_gvals): 12 further LCG rounds with data [1],
//     right-shifting by 5 after each round, then bit 30 (signed semantics).
//   * Tournament sampling via the probability-update recurrence
//     (update_scores, non-distortionary num_leaves = 2): for each layer
//     i, probs *= (1 + g_i - m_i) with m_i = Σ_j g_ij p_j. Each layer
//     preserves total mass and shifts it toward the tokens whose layer-i
//     g-value is 1; this is exactly the expected outcome of the paper's
//     two-sample tournament (Corollary 27 of the supplementary material).
//   * Context repetition masking: a context (the preceding ngram_len-1
//     tokens) is watermarked only the first time it occurs; later repeats
//     are sampled without bias and excluded from detection. The generator
//     and the detector apply the SAME mask, each from token IDs alone.
//   * Logits-free detection: the detector needs only the token IDs, the key,
//     and the masks. It recomputes g-values and scores them with the
//     a weighted keyed-coin z statistic inspired by the paper's frequentist
//     detectors:
//     weights decrease linearly 10 → 1 across layers (the reference
//     detector_mean.py default), and the variance uses Σ w², as appropriate
//     for weighted Bernoulli observations.
//
// Token IDs are stable 30-bit integers assigned by the miniature's
// surface-token vocabulary. This mirrors the stable-ID contract of a real
// tokenizer without claiming tokenizer compatibility.
//
// int64 note: the reference hashes in signed 64-bit integers. JavaScript has
// no int64, so this file emulates it with BigInt — including signed
// right-shift and remainder, which is what makes the g-value bit extraction
// match the reference exactly.

import { sha256 } from "./sha256.ts";

// ---------------------------------------------------------------------------
// int64 emulation
// ---------------------------------------------------------------------------

const M64 = BigInt(2) ** BigInt(64);
const M63 = BigInt(2) ** BigInt(63);

/** Wrap an arbitrary BigInt into the signed int64 range [-2^63, 2^63). */
function i64(x: bigint): bigint {
  let y = x % M64;
  if (y < BigInt(0)) y += M64;
  return y >= M63 ? y - M64 : y;
}

/** Signed right shift on an int64 value (BigInt >> preserves the sign). */
function shr(x: bigint, n: number): bigint {
  return x >> BigInt(n);
}

// ---------------------------------------------------------------------------
// Hashing (hashing_function.py + the IV logic of logits_processing.py)
// ---------------------------------------------------------------------------

/** LCG parameters from the reference (adapted newlib/musl). */
const LCG_MULTIPLIER = BigInt("6364136223846793005");
const LCG_INCREMENT = BigInt(1);

/**
 * accumulate_hash: h = ((h + data_i) * multiplier + increment), wrapped to
 * int64, for each element of data in order. f(x, data[:T]) =
 * f(f(x, data[:T-1]), data[T-1]) — the incremental property the reference
 * relies on.
 */
export function accumulateHash(current: bigint, data: (number | bigint)[]): bigint {
  let h = current;
  for (const d of data) {
    h = i64((h + BigInt(d)) * LCG_MULTIPLIER + LCG_INCREMENT);
  }
  return h;
}

/** FNV-1a 32-bit — used only by the miniature's tokenizer (stable token
 * IDs); all cryptographic keying goes through SHA-256 as in the reference. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SynthIdConfig {
  /** Key string; the IV (and thus every hash) is derived from it. */
  key: string;
  /**
   * Watermarking depth — the number of independent layers/keys (30 in the
   * paper and reference).
   */
  depth: number;
  /** Ngram length: context of ngram_len-1 tokens + 1 candidate (5 = H+1
   * with H=4, the reference default). */
  ngramLen: number;
  /** Rolling context-history size for the repetition mask (1024 in the
   * reference). */
  contextHistorySize: number;
  /**
   * Explicit layer keys, bypassing string derivation. In the reference the
   * secret IS such a list of integers; this is also how the cross-validation
   * harness feeds identical keys to both implementations.
   */
  layerKeys?: bigint[];
}

/** The paper's configuration, with a string key standing in for the 30
 * integer layer keys of the reference. */
export const DEFAULT_CONFIG: Omit<SynthIdConfig, "key"> = {
  depth: 30,
  ngramLen: 5,
  contextHistorySize: 1024
};

export function makeConfig(key: string, overrides?: Partial<Omit<SynthIdConfig, "key">>): SynthIdConfig {
  const cfg: SynthIdConfig = { key, ...DEFAULT_CONFIG };
  if (overrides) {
    if (overrides.depth !== undefined) cfg.depth = overrides.depth;
    if (overrides.ngramLen !== undefined) cfg.ngramLen = overrides.ngramLen;
    if (overrides.contextHistorySize !== undefined) cfg.contextHistorySize = overrides.contextHistorySize;
    if (overrides.layerKeys !== undefined) cfg.layerKeys = overrides.layerKeys;
  }
  if (!Number.isInteger(cfg.depth) || cfg.depth < 1) {
    throw new Error("SynthID depth must be a positive integer");
  }
  if (!Number.isInteger(cfg.ngramLen) || cfg.ngramLen < 1) {
    throw new Error("SynthID ngramLen must be a positive integer");
  }
  if (!Number.isInteger(cfg.contextHistorySize) || cfg.contextHistorySize < 0) {
    throw new Error("SynthID contextHistorySize must be a non-negative integer");
  }
  if (cfg.layerKeys && cfg.layerKeys.length !== cfg.depth) {
    throw new Error(`expected ${cfg.depth} SynthID layer keys, received ${cfg.layerKeys.length}`);
  }
  return cfg;
}

/**
 * Derive the watermarking layer keys from the user's key string.
 *
 * In the reference, `keys` is the secret itself — a sequence of 30 integers
 * (one per layer). Here the user supplies a memorable string; we expand it
 * deterministically into `depth` int64 layer keys with SHA-256 (UTF-8 input,
 * 8 bytes each, big-endian, wrapped to signed int64). This expansion is an
 * educational adapter; everything downstream uses the resulting integers in
 * the same places the reference uses its supplied keys.
 */
export function deriveLayerKeys(key: string, depth: number): bigint[] {
  const out: bigint[] = [];
  for (let k = 0; k < depth; k++) {
    const tag = key + "\u0000" + k;
    const d = sha256(utf8Bytes(tag));
    let v = BigInt(0);
    for (let i = 0; i < 8; i++) v = (v << BigInt(8)) | BigInt(d[i]);
    out.push(i64(v));
  }
  return out;
}

/** Encode a JavaScript string as UTF-8 without relying on DOM or Node APIs.
 * This keeps shared/ runtime-neutral and prevents distinct Unicode keys
 * whose UTF-16 code units share a low byte from colliding. */
function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let cp = input.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }

    if (cp <= 0x7f) bytes.push(cp);
    else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp <= 0xffff) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(bytes);
}

/**
 * Hash initialization vector, exactly as the reference builds it:
 * SHA-256 of the keys' bytes (int64 little-endian, concatenated), the 32-byte
 * digest read as one big-endian integer, reduced modulo int64-max
 * ("very important to have an unpredictable IV").
 */
export function hashIv(layerKeys: bigint[]): bigint {
  const bytes: number[] = [];
  for (const k of layerKeys) {
    let v = k < BigInt(0) ? k + M64 : k; // unsigned view
    // numpy int64 .tobytes() is little-endian on x86: LSB first.
    for (let i = 0; i < 8; i++) {
      bytes.push(Number(v & BigInt(0xff)));
      v >>= BigInt(8);
    }
  }
  const d = sha256(new Uint8Array(bytes));
  let big = BigInt(0);
  for (let i = 0; i < 32; i++) big = (big << BigInt(8)) | BigInt(d[i]);
  return big % (M63 - BigInt(1)); // torch.iinfo(torch.int64).max = 2^63 - 1
}

/** Layer index mixed into each layer's hash: the reference accumulates the
 * per-layer key; we accumulate the derived int64 layer key. */
function layerKeyOf(layerKeys: bigint[], k: number): bigint {
  return layerKeys[k];
}

// ---------------------------------------------------------------------------
// g-values (compute_ngram_keys + get_gvals)
// ---------------------------------------------------------------------------

export interface KeyMaterial {
  layerKeys: bigint[];
  iv: bigint;
}

const KEY_MATERIAL_CACHE_LIMIT = 128;
const keyMaterialCache = new Map<string, KeyMaterial>();

/** Derive (and memoise) the key material for a config. */
export function keyMaterial(config: SynthIdConfig): KeyMaterial {
  const explicitKey = config.layerKeys?.map((k) => k.toString()).join(",") ?? "derived";
  const cacheKey = config.key + "\u0001" + config.depth + "\u0001" + explicitKey;
  let km = keyMaterialCache.get(cacheKey);
  if (km) {
    // Refresh insertion order so eviction behaves as a small LRU cache.
    keyMaterialCache.delete(cacheKey);
    keyMaterialCache.set(cacheKey, km);
  }
  if (!km) {
    const layerKeys = config.layerKeys ?? deriveLayerKeys(config.key, config.depth);
    if (layerKeys.length !== config.depth) {
      throw new Error(`expected ${config.depth} SynthID layer keys, received ${layerKeys.length}`);
    }
    km = { layerKeys, iv: hashIv(layerKeys) };
    keyMaterialCache.set(cacheKey, km);
    if (keyMaterialCache.size > KEY_MATERIAL_CACHE_LIMIT) {
      const oldest = keyMaterialCache.keys().next().value as string | undefined;
      if (oldest !== undefined) keyMaterialCache.delete(oldest);
    }
  }
  return km;
}

/**
 * Hash of the context alone — the identity used by the repetition mask,
 * exactly like hash_result_with_just_context in the reference.
 */
export function contextHash(config: SynthIdConfig, contextIds: number[]): bigint {
  return accumulateHash(keyMaterial(config).iv, contextIds);
}

/** ngram key: hash of IV + context + candidate token id. */
export function ngramKey(config: SynthIdConfig, contextIds: number[], tokenId: number): bigint {
  return accumulateHash(contextHash(config, contextIds), [tokenId]);
}

/**
 * get_gvals: 12 further LCG rounds with data [1], right-shifting 5 bits
 * after each round (64 // 12 in the reference), then bit 30 under signed
 * int64 semantics. Returns one bit per layer.
 */
export function gValues(config: SynthIdConfig, contextIds: number[], tokenId: number): number[] {
  const km = keyMaterial(config);
  const base = ngramKey(config, contextIds, tokenId);
  const out = new Array<number>(config.depth);
  for (let k = 0; k < config.depth; k++) {
    let h = accumulateHash(base, [km.layerKeys[k]]);
    for (let r = 0; r < 12; r++) {
      h = shr(accumulateHash(h, [1]), 5);
    }
    // The reference computes (h >> 30) % 2 with torch.remainder (floor-style,
    // always non-negative). For any integer, floor-remainder 2 equals its
    // least-significant bit, and the LSB of an arithmetic h >> 30 is bit 30
    // of h regardless of sign — so g is exactly bit 30 of h. (BigInt % would
    // be wrong here: it keeps the dividend's sign, unlike torch.remainder.)
    out[k] = (shr(h, 30) & BigInt(1)) === BigInt(1) ? 1 : 0;
  }
  return out;
}

/** g-values for every candidate of one step. Shape: [candidates][depth]. */
export function gValuesForCandidates(
  config: SynthIdConfig,
  contextIds: number[],
  tokenIds: number[]
): number[][] {
  return tokenIds.map((id) => gValues(config, contextIds, id));
}

/**
 * Closed-form mean g-value of the tournament WINNER for a uniform LM
 * distribution — Corollary 27 of the paper's supplementary material:
 * 0.5 + 0.25 · (1 − 1/V). This describes the paper's full tournament and is
 * an upper bound for the iterated probability-update recurrence the
 * reference actually ships (and this miniature implements): measured on the
 * reference recurrence, a uniform V=4 set averages ≈0.578, not the 0.6875
 * this closed form gives (see .test/harness.mjs and .test/xval_behaviour.py).
 */
export function expectedMeanGValue(vocabSize: number, numLeaves = 2): number {
  if (numLeaves !== 2) throw new Error("miniature implements the 2-leaf tournament");
  return 0.5 + 0.25 * (1 - 1 / vocabSize);
}

// ---------------------------------------------------------------------------
// Tournament probability update (update_scores)
// ---------------------------------------------------------------------------

/**
 * The non-distortionary probability-update recurrence (num_leaves = 2 in the
 * reference's update_scores). Input and output are probability vectors over
 * the candidates; each layer multiplies p_j by (1 + g_j − m) where
 * m = Σ_j g_j p_j is the current green mass at that layer. Every layer
 * preserves total mass exactly, so the output is a valid distribution; the
 * mass moved at each layer goes to the candidates with g = 1 at that layer.
 */
export function updateProbs(probs: number[], gValuesPerCandidate: number[][]): number[] {
  const depth = gValuesPerCandidate.length > 0 ? gValuesPerCandidate[0].length : 0;
  let p = probs.slice();
  for (let i = 0; i < depth; i++) {
    let mass = 0;
    for (let j = 0; j < p.length; j++) mass += gValuesPerCandidate[j][i] * p[j];
    for (let j = 0; j < p.length; j++) {
      p[j] = p[j] * (1 + gValuesPerCandidate[j][i] - mass);
      if (p[j] < 0) p[j] = 0;
    }
  }
  // Guard against float drift (the recurrence preserves mass analytically).
  const total = p.reduce((s, x) => s + x, 0);
  if (total > 0) p = p.map((x) => x / total);
  return p;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Small deterministic RNG (mulberry32) so demo runs are reproducible. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a standard Gumbel sample: −ln(−ln U). */
export function gumbel(u: number): number {
  const clamped = Math.min(Math.max(u, 1e-9), 1 - 1e-9);
  return -Math.log(-Math.log(clamped));
}

/** Gumbel-max sampling from a probability vector — a valid categorical
 * sampler: argmax_j (ln p_j + G_j) is distributed as p. */
export function sampleIndex(probs: number[], rng: () => number): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < probs.length; i++) {
    // A logits processor must not bring a token back after top-k/top-p (or
    // another constraint) has assigned it exactly zero probability. Using a
    // numerical floor here would give impossible tokens a tiny chance of
    // winning an extreme Gumbel draw, so keep zero mass at -Infinity.
    if (!(probs[i] > 0)) continue;
    const logit = Math.log(probs[i]);
    const score = logit + gumbel(rng());
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) throw new Error("cannot sample a distribution with no positive mass");
  return best;
}

// ---------------------------------------------------------------------------
// Detection: weighted keyed-coin z score
// ---------------------------------------------------------------------------

/**
 * Per-layer weights of the reference weighted-mean detector
 * (detector_mean.py): linearly decreasing from 10 to 1, normalised to sum to
 * the depth. "Weighted" here means weighted across WATERMARK LAYERS — not by
 * per-token entropy.
 */
export function layerWeights(depth: number): number[] {
  const w = new Array<number>(depth);
  for (let i = 0; i < depth; i++) {
    w[i] = depth === 1 ? depth : 10 + (1 - 10) * (i / (depth - 1));
  }
  const sum = w.reduce((s, x) => s + x, 0);
  const scale = depth / sum;
  return w.map((x) => x * scale);
}

/** Standard normal CDF via Abramowitz–Stegun erf approximation. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

export interface TokenAnalysisStep {
  tokenId: number;
  /** The n−1 preceding token IDs fed to the hash. */
  contextIds: number[];
  /** One g-value bit per layer for the ngram (context + this token). */
  gValues: number[];
  /** False when the context occurred earlier — excluded from the score. */
  repetitionMask: boolean;
  /** False for the first ngram_len−1 positions (context not yet full). */
  scored: boolean;
  /** Weighted g sum contributed by this position (0 if not scored). */
  weightedGSum: number;
}

export interface TokenAnalysis {
  steps: TokenAnalysisStep[];
  /** Ngrams actually scored (unmasked, context full). */
  n: number;
  /** Ngrams masked as repeated contexts. */
  masked: number;
  /** Positions skipped because the context is not yet full. */
  skippedShortContext: number;
  /** Σ w_l · g over scored ngrams and all layers. */
  score: number;
  /** Null expectation of the score: 0.5 · depth · n. */
  expectedScore: number;
  /** Null standard deviation: √(0.25 · Σw² · n · correction). */
  sd: number;
  /** Frequentist z-score of the weighted score. */
  z: number;
  /** One-sided normal p-value. */
  pValue: number;
  /** Plain mean of unmasked g-values (toy score; null mean 0.5). */
  meanScore: number;
  /** Reference weighted-mean score (null mean 0.5). */
  weightedMeanScore: number;
  /** Mean g-value per layer across scored ngrams — the layer evidence. */
  layerMeans: number[];
  /** Variance correction actually applied (1 = pure iid null). */
  varianceCorrection: number;
}

export type Verdict = "strong" | "likely" | "inconclusive" | "none";

/** Verdict thresholds for the one-sided weighted keyed-coin test. The
 * threshold in raw score units is length-dependent because z standardises
 * by sqrt(n); the p-value cut-offs themselves are fixed and explicit. */
export const VERDICT_THRESHOLDS = {
  pStrong: 0.001,
  pLikely: 0.01,
  minNgrams: 12
};

/**
 * The detector's full pipeline, from token IDs alone — no model, no logits:
 * rebuild the ngram contexts, recompute every g-value with the key, apply
 * the context-repetition mask exactly as the generator did, and score with
 * the weighted keyed-coin statistic.
 *
 * Null model: under unwatermarked sampling the g-value of the sampled token
 * is Bernoulli(1/2) at every layer, independent of the sampler's randomness,
 * so E[score] = 0.5·depth·n and Var[score] = 0.25·Σw²·n for independent
 * observations (hence Σw², not Σw). This miniature reports that independent
 * keyed-coin normal approximation directly. `varianceCorrection` is an
 * optional diagnostics hook; it defaults to 1 and is not secretly fitted by
 * scenario or key.
 */
export function analyzeTokens(
  tokenIds: number[],
  config: SynthIdConfig,
  opts?: { varianceCorrection?: number }
): TokenAnalysis {
  const weights = layerWeights(config.depth);
  const wSqSum = weights.reduce((s, w) => s + w * w, 0);
  const correction = opts?.varianceCorrection ?? 1;
  if (!Number.isFinite(correction) || correction <= 0) {
    throw new Error("varianceCorrection must be a positive finite number");
  }
  const history: bigint[] = [];
  const steps: TokenAnalysisStep[] = [];
  const layerSums = new Array<number>(config.depth).fill(0);

  let n = 0;
  let masked = 0;
  let skippedShort = 0;
  let score = 0;
  let gSum = 0;
  let gCount = 0;
  let weightedGSumAll = 0;
  let weightTotal = 0;
  const weightSum = weights.reduce((s, w) => s + w, 0);

  for (let pos = 0; pos < tokenIds.length; pos++) {
    const contextIds = tokenIds.slice(Math.max(0, pos - (config.ngramLen - 1)), pos);
    const full = contextIds.length === config.ngramLen - 1;
    const ch = contextHash(config, contextIds);
    const repeated = full && history.includes(ch);
    if (full) {
      history.unshift(ch);
      if (history.length > config.contextHistorySize) history.pop();
    }

    const gv = full ? gValues(config, contextIds, tokenIds[pos]) : new Array<number>(config.depth).fill(0);
    const scoredNow = full && !repeated;

    let weightedGSum = 0;
    if (scoredNow) {
      n++;
      for (let l = 0; l < config.depth; l++) {
        const contrib = weights[l] * gv[l];
        score += contrib;
        weightedGSum += contrib;
        layerSums[l] += gv[l];
        gSum += gv[l];
        gCount++;
      }
      weightedGSumAll += weightedGSum;
      weightTotal += weightSum;
    } else if (repeated) {
      masked++;
    } else {
      skippedShort++;
    }

    steps.push({
      tokenId: tokenIds[pos],
      contextIds,
      gValues: gv,
      repetitionMask: !repeated,
      scored: scoredNow,
      weightedGSum
    });
  }

  const expectedScore = 0.5 * weightSum * n; // weights normalise to depth
  const sd = Math.sqrt(0.25 * wSqSum * n * correction) || 1;
  const z = n === 0 ? 0 : (score - expectedScore) / sd;
  const pValue = n === 0 ? 1 : 1 - normalCdf(z);
  const meanScore = gCount === 0 ? 0 : gSum / gCount;
  const weightedMeanScore = weightTotal === 0 ? 0 : weightedGSumAll / weightTotal;

  return {
    steps,
    n,
    masked,
    skippedShortContext: skippedShort,
    score,
    expectedScore,
    sd,
    z,
    pValue,
    meanScore,
    weightedMeanScore,
    layerMeans: layerSums.map((s) => (n === 0 ? 0 : s / n)),
    varianceCorrection: correction
  };
}

/** Map the weighted keyed-coin test to an explicitly sized verdict. */
export function verdictFromAnalysis(a: TokenAnalysis): Verdict {
  if (a.n < VERDICT_THRESHOLDS.minNgrams) return "inconclusive";
  if (a.pValue <= VERDICT_THRESHOLDS.pStrong) return "strong";
  if (a.pValue <= VERDICT_THRESHOLDS.pLikely) return "likely";
  return "none";
}

// ---------------------------------------------------------------------------
// Null-model diagnostic utility
// ---------------------------------------------------------------------------

/** Measure the false-positive rate of the z-test on genuinely unwatermarked
 * samples produced by `sample` (run many seeds, count z ≥ threshold). */
export function falsePositiveRate(
  sample: (seed: number) => number[],
  config: SynthIdConfig,
  opts: { trials: number; thresholds: number[]; varianceCorrection?: number; seedBase?: number }
): { rates: Record<string, number>; zs: number[] } {
  if (!Number.isInteger(opts.trials) || opts.trials < 1) {
    throw new Error("trials must be a positive integer");
  }
  if (opts.thresholds.some((threshold) => !Number.isFinite(threshold))) {
    throw new Error("thresholds must contain only finite numbers");
  }
  const rates: Record<string, number> = {};
  for (const t of opts.thresholds) rates[t] = 0;
  const zs: number[] = [];
  for (let s = 0; s < opts.trials; s++) {
    const ids = sample((opts.seedBase ?? 1) + s * 7919);
    const a = analyzeTokens(ids, config, { varianceCorrection: opts.varianceCorrection });
    zs.push(a.z);
    for (const t of opts.thresholds) {
      if (a.z >= t) rates[t]++;
    }
  }
  for (const t of opts.thresholds) rates[t] /= opts.trials;
  return { rates, zs };
}
