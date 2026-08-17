# The Watermark, Explained

An interactive web app that demonstrates SynthID-Text tournament sampling as a
working educational miniature. It is based on Anthropic's watermark explainer
and Dathathri et al., *Scalable watermarking for identifying large language
model outputs* (Nature, 2024).

## What it shows

- **How it works** (`/`) — animated token-by-token generation, exact toy-model
  and post-SynthID probabilities, ordered g-value layers, and a live detector.
- **Content types** (`/scenarios`) — why open prose distributions carry more
  expected watermark lift than peaked facts, code, quotations, or proofreading.
- **Detect it** (`/detect`) — token-ID-only detection, wrong keys, edits,
  rewrites, per-layer evidence, and short-text abstention.
- **Limits, removal, alternatives & sources** (`/limits`) — the guarantees,
  caveats, adversarial-removal threat model, a comparison of alternative
  watermarking designs, and an annotated source library.

Every generation demo runs TWO traces side by side from one fixed random
stream — with and without the tournament update — so every disagreement
between the panes is caused by the watermark. Differing choices are ringed,
a differences-only view collapses the identical stretches, and each run has
its own detector strip. `.test/scenario_stats.mjs` tabulates verdict
distributions per scenario: prose and translation are reliably flagged;
facts are sparse; code, quotations, and proofreading are long enough for a
real verdict yet read "no signal".

## Mechanism

The hand-authored "model" supplies a next-token probability distribution. In a
real model this is the distribution after temperature, top-k, top-p, or other
decoding transforms; this miniature starts at that boundary rather than
computing neural-network logits.

For each token:

1. Stable token IDs and the preceding four-token context are hashed with 30
   independent integer layer keys to produce binary g-values.
2. Each ordered tournament layer applies the reference probability recurrence
   `p_j <- p_j * (1 + g_j - sum(g * p))`.
3. Exact repeated contexts are sampled from the base distribution instead and
   masked from detection. The first four output positions are also left
   unwatermarked because this continuation-only miniature has no prompt token
   IDs to reconstruct later.
4. One token is sampled from the final distribution with Gumbel-max, a valid
   categorical sampler. The UI displays both the model and sampled
   probabilities and marks the selected row.

Detection uses only token IDs, the key, g-values, and masks—never the model or
generation logits. It computes a weighted mean (layer weights proportional to
the reference detector's 10-to-1 schedule) and a one-sided keyed-coin z statistic under the
independent keyed-coin null. The normal-approximation p-value and the displayed
verdict are derived from that same statistic: `p <= .01` is "likely" and
`p <= .001` is "strong", with a minimum of 12 complete ngrams.

## Validation and scope

`.test/xval_check.mjs` checks the int64 hash IV, LCG accumulation, raw ngram
keys, g-values, repetition masks, and probability recurrence against vectors
produced by Google DeepMind's `synthid-text` reference package. The behavioral
harness checks generation/detection agreement, every scenario's text/token
round-trip, non-distortion averaged over keys, null behavior, signal power,
length behavior, Unicode keys, key-material caching, and deterministic runs.

```sh
npm test
```

The cross-validated SynthID core is faithful. The neural model, tokenizer, and
string-to-integer key expansion are educational stand-ins, and the detector
uses a disclosed normal approximation rather than a trained production
Bayesian model. This project is unofficial and is not affiliated with
Anthropic or Google DeepMind.

The deliberately tiny candidate sets make individual probability shifts easy
to see and more dramatic than they would usually look across a real model's
larger post-decoding support. Both side-by-side runs consume the same Gumbel
random stream, so the watermark on/off comparison changes only the SynthID
update, and replays keep that stream fixed.

“Non-distortionary” is a marginal statement, not a per-context entropy gate.
For one fixed key and context, the tournament can strongly boost a
low-probability token that remains inside the post-top-k/top-p support. Averaged
over pseudorandom keyed seeds, however, every token recovers its original model
probability. Exact zero probability remains zero. The UI demonstrates all
three facts and distinguishes this mechanical guarantee from the paper's human
and production quality evaluations. The paper also notes that its
single-sequence non-distortion configuration can reduce diversity across
repeated responses even though its quality evaluations found no loss.

The Nature paper also supplies watermark-aware speculative-sampling
constructions. Exact speculative decoding must target the *watermarked*
distribution: one construction prioritizes watermark detectability at some
cost to draft-token acceptance, while another preserves speculative efficiency
but can weaken the signal.

## Removal and robustness

The app distinguishes token-choice watermarks from hidden Unicode and file
metadata. A byte-preserving copy or paste does not by itself remove a
SynthID-style signal because the ordinary token sequence remains. Formatting,
normalization, or platform transforms can matter when they change whitespace,
tokenization, or the scored sequence. Transformations that resample or replace
words are a different matter:

- lexical edits disrupt the edited token's g-value and subsequent context
  windows;
- cropping and mixing reduce or dilute the available evidence;
- paraphrasing and round-trip translation regenerate token choices and can
  substantially degrade detection;
- score-guided or watermark-stealing attacks can use detector or model access
  for scrubbing and, in some schemes, spoofing.

“Trivial to remove” is therefore a threat-model claim, not a universal result.
An unwatermarked LLM can make a rewrite cheap, but the attacker may lose exact
wording, style, citations, code correctness, or factual fidelity. Strong
paraphrases can also retain enough ngrams for detection when the passage is
long. The UI presents these competing findings and never treats a negative
result as proof of human authorship.

The `/limits` page also surveys the wider design space on the same
trade-offs. Green-list watermarking ships detection as an open z-test anyone
can run locally; distortion-free and cryptographically undetectable schemes
strengthen sequence-distribution and indistinguishability guarantees; semantic
watermarks report improved robustness to some paraphrases; publicly detectable
constructions verify with no secret key at all. Detector access is
a deployment choice: a provider can keep one private, expose an API, or publish
it. The cited publicly detectable construction is a research implementation;
the sources here do not establish broad production adoption.

Key references include the [SynthID-Text Nature
paper](https://www.nature.com/articles/s41586-024-08025-4), the [DeepMind
reference implementation](https://github.com/google-deepmind/synthid-text), a
[SynthID-specific robustness assessment](https://arxiv.org/abs/2508.20228),
the [WaterPark robustness benchmark](https://arxiv.org/abs/2411.13425), [work
on paraphrase robustness](https://arxiv.org/abs/2306.04634), [watermark
stealing and spoofing](https://arxiv.org/abs/2402.19361), and the 2026 [survey
on theory and deployment](https://arxiv.org/abs/2607.10103), plus the
alternative designs the site surveys: the [original green-list
watermark](https://arxiv.org/abs/2301.10226), [distortion-free
watermarks](https://arxiv.org/abs/2307.15593), [undetectable
watermarks](https://eprint.iacr.org/2023/763), [semantic
watermarking](https://arxiv.org/abs/2310.06356), and [publicly detectable
watermarking](https://eprint.iacr.org/2023/1661). The source page
also labels vendor documentation and commentary separately, including Sean
Goedecke's adversarial argument and the ExplainX overview.

## Stack

Preact + Vite + Tailwind CSS v4, built as a fully static client-side app.
Deployed on Vercel.

## Run locally

```sh
npm install
npm run dev
```

## Build or deploy

```sh
npm run build
npx vercel deploy --prod
```

## License

This project is released under the [MIT License](LICENSE).
