// Limits, removal attacks, and an annotated source guide.

import { Link } from "./router";
import { Badge, Card, ExternalLink, SectionTitle } from "./ui";

type Tone = "green" | "amber" | "neutral" | "blue" | "red";

interface Limit { q: string; a: string; tag: string; tone: Tone; }
interface Attack { name: string; effort: string; effect: string; tone: Tone; mechanism: string; caveat: string; evidence: string; }
interface Approach { name: string; tag: string; tone: Tone; body: string; status: string; }
interface Source { id: string; kind: "primary research" | "reference code" | "survey" | "vendor" | "commentary" | "policy"; title: string; detail: string; href: string; }

const LINK_CLASS = "text-emerald-300 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-200";

const LIMITS: Limit[] = [
  { q: "Can the watermark identify the user who generated the text?", a: "No. Nothing in the watermark signal encodes a user, organization, prompt, or chat. A positive score is evidence that the text is consistent with a particular watermark configuration, not proof of a person, conversation, or exact model.", tag: "no identity", tone: "green" },
  { q: "Does a watermark prove a human didn't write the text?", a: "No. It can't separate wholly model-written text from model-assisted editing, and a miss never proves human authorship. Treat a score as one provenance signal among several.", tag: "limited proof", tone: "amber" },
  { q: "Can it tell whether a different AI wrote the text?", a: "No. Another provider may use a different key, configuration, tokenizer, or method entirely. A detector only tests the key and configuration it knows.", tag: "key-specific", tone: "amber" },
  { q: "Why does detection fail on short text?", a: "Short passages supply fewer eligible ngrams. Low-entropy passages may supply plenty of ngrams but less opportunity for the sampler to carry a strong signal. This demo abstains below 12 scored ngrams; production thresholds are calibrated by length and false-positive tolerance.", tag: "length matters", tone: "amber" },
  { q: "Does non-distortion mean every response is unchanged?", a: "No. The guarantee is an expectation over watermark randomness for a fixed model context. Fix one keyed pseudorandom draw and the odds can shift a lot, so an individual response can differ from its unwatermarked counterpart.", tag: "marginal guarantee", tone: "amber" },
  { q: "Can someone edit the watermark away?", a: "Often, yes. Byte-preserving copy or paste usually keeps it, while formatting that changes whitespace or tokenization can alter the signal. Replacing words, cropping, mixing, paraphrasing, and translating all tend to weaken detection; a full unwatermarked rewrite is the most direct attack.", tag: "editable signal", tone: "red" },
  { q: "Does watermarking slow the model down or cost more?", a: "The published SynthID work reports negligible serving overhead and no extra output tokens. The exact overhead depends on the production implementation and decoding stack.", tag: "low overhead", tone: "green" },
  { q: "What happens with speculative decoding?", a: "It has to integrate with the watermark-aware target sampler. Naively accepting draft tokens from an unwatermarked distribution weakens the signal. The SynthID paper describes exact constructions with different speed-detectability tradeoffs.", tag: "speed ↔ signal", tone: "blue" },
  { q: "What about images and files?", a: "Text watermarking and C2PA are different things. C2PA binds signed provenance data to an asset; a normal file copy can preserve it, while workflows that remove metadata or create a new derivative may not. SynthID-Text instead changes token choices: byte-preserving copy/paste usually preserves the signal, while rewriting can weaken or erase it.", tag: "signal ≠ metadata", tone: "blue" },
  { q: "Is this the same as general AI-detection software?", a: "No. A classifier guesses authorship from writing patterns it learned. A watermark detector recomputes a keyed signal that was deliberately embedded. Both can fail, for different reasons and with different calibration assumptions.", tag: "≠ classifier", tone: "red" }
];

const BY_TAG = (tag: string): Limit => LIMITS.find((l) => l.tag === tag)!;

/** The ten limits, clustered so each group answers one kind of doubt. */
const LIMIT_GROUPS: { label: string; items: Limit[] }[] = [
  {
    label: "what the signal says",
    items: [BY_TAG("no identity"), BY_TAG("key-specific"), BY_TAG("≠ classifier")]
  },
  {
    label: "how strong the evidence is",
    items: [BY_TAG("limited proof"), BY_TAG("length matters"), BY_TAG("marginal guarantee")]
  },
  {
    label: "cost and compatibility",
    items: [BY_TAG("low overhead"), BY_TAG("speed ↔ signal"), BY_TAG("signal ≠ metadata")]
  },
  {
    label: "how fragile it is",
    items: [BY_TAG("editable signal")]
  }
];

const ATTACKS: Attack[] = [
  { name: "Byte-preserving copy or paste", effort: "very low", effect: "usually little effect", tone: "green", mechanism: "When the ordinary characters and token sequence remain the same, the detector can reconstruct the same keyed contexts.", caveat: "Formatting, normalization, or platform transforms that change whitespace or tokenization can change the scored sequence, even though this scheme does not rely on hidden characters.", evidence: "mechanism" },
  { name: "Lexical edits and cropping", effort: "low", effect: "weakens or dilutes", tone: "amber", mechanism: "Replacing tokens changes their g-values and the following context windows; cropping simply removes observations from the test.", caveat: "Long passages may keep enough untouched ngrams to stay detectable. In this demo (H=4), one replacement can alter up to five scored positions.", evidence: "survey + benchmarks" },
  { name: "Mix with unwatermarked text", effort: "low", effect: "dilutes", tone: "amber", mechanism: "The detector sees fewer marked observations relative to the whole document, especially with one global score.", caveat: "Windowed or segment-level detectors can still find a sufficiently long marked span.", evidence: "primary research" },
  { name: "Paraphrase or rewrite", effort: "low with another LLM", effect: "often major", tone: "red", mechanism: "A rewriter samples a new sequence, destroying many original token choices and their keyed context chain.", caveat: "A paraphrase can fail to remove it: leaked phrases can preserve signal, and outcomes depend on length, attack strength, scheme, and detector.", evidence: "primary research" },
  { name: "Round-trip translation", effort: "low", effect: "often major", tone: "red", mechanism: "Translation regenerates wording and token boundaries, then regenerates them again on the way back.", caveat: "The tendency is empirical, with no guarantee. A watermarked translation service may also stamp its own watermark on the output.", evidence: "SynthID assessment" },
  { name: "Adaptive score-guided attack", effort: "moderate", effect: "scrub or spoof", tone: "blue", mechanism: "Repeated queries can reveal which edits lower a public detector score; model-output queries can sometimes help approximate a watermark rule.", caveat: "This needs useful oracle access. Rate limits, coarse verdicts, secret-key handling, and key rotation are part of the deployment threat model.", evidence: "watermark stealing" }
];

const APPROACHES: Approach[] = [
  { name: "Green-list biasing", tag: "verify it yourself", tone: "green", body: "A hash of the previous tokens and a secret key split the vocabulary into a green list and a red list, and generation nudges probability toward the green tokens. Detection is an open z-test that ships inside Hugging Face transformers: anyone can watermark their own model and check text locally, with no vendor in the loop.", status: "Kirchenbauer et al., ICML 2023. Ancestor of the deployed schemes; the bias trades quality against detectability, and paraphrase still hurts." },
  { name: "SynthID-Text, open-sourced", tag: "open code, deployment-specific access", tone: "blue", body: "The same family Claude's watermark comes from. Google publishes the marking and detector-training code, and it runs in transformers, so the pipeline is inspectable and reproducible for configurations you control. Verification access for a production model is a separate deployment choice: the provider can keep a detector private, expose an API, or publish it.", status: "Deployed across Gemini's consumer apps since 2024; code and Nature paper public. Production keys and detector access are provider-specific." },
  { name: "Keyed pseudorandom choice", tag: "quality first", tone: "blue", body: "The 2022 proposal that started the field: a secret-keyed pseudorandom function tilts which token the model picks, in a way designed to preserve the output distribution. Its author developed it at OpenAI, which explored text watermarking but never shipped it.", status: "Aaronson, 2022. Described in a blog post and talks; never published as a paper or deployed." },
  { name: "Distortion-free & undetectable", tag: "stronger guarantee", tone: "blue", body: "Related research strengthens what is guaranteed and to whom: keyed pseudorandom-sequence schemes preserve the model's sequence distribution, while cryptographic \u201cundetectable\u201d watermarks are computationally indistinguishable from normal text to anyone without the key. Pseudorandom error-correcting codes add robustness to a bounded rate of edits.", status: "Kuditipudi et al., TMLR 2024; Christ, Gunn & Zamir, COLT 2024; Christ & Gunn, CRYPTO 2024. Detection still needs the key; none deployed." },
  { name: "Semantically robust marking", tag: "survives some rewrites", tone: "green", body: "SIR derives a context-dependent vocabulary partition from semantic embeddings of the preceding text, using a trained watermark model. Its experiments report improved detection after synonym substitution and paraphrasing compared with token-surface baselines; that is empirical robustness, not a guarantee that every rewrite or translation preserves the mark. The encoder and learned partition introduce scheme-specific quality and compute trade-offs.", status: "Liu et al., ICLR 2024. Academic; reported trade-offs depend on the model, attacks, and detector settings." },
  { name: "Publicly detectable watermarking", tag: "anyone can verify", tone: "green", body: "Cryptographic designs whose detector holds no secret: anyone can run it, the way anyone can check a signature, and forging a mark is provably hard. That is stronger than merely publishing a trained detector for a secret-key scheme, because verification does not depend on a hidden detection authority.", status: "Fairoze et al., CIC 2024, and related cryptographic work. The sources listed here establish a research implementation, not broad production adoption." }
];

const SOURCES: Source[] = [
  { id: "S1", kind: "primary research", title: "Scalable watermarking for identifying large language model outputs", detail: "Dathathri et al., Nature (2024). SynthID-Text mechanism, non-distortion, detection, quality, robustness, and deployment evaluation.", href: "https://www.nature.com/articles/s41586-024-08025-4" },
  { id: "S2", kind: "reference code", title: "Google DeepMind synthid-text", detail: "Research implementation for keyed g-values, probability updates, masks, and mean, weighted-mean, frequentist, and Bayesian detection.", href: "https://github.com/google-deepmind/synthid-text" },
  { id: "S3", kind: "primary research", title: "Robustness Assessment and Enhancement of Text Watermarking for Google's SynthID", detail: "Han et al. (2025). SynthID-specific evaluation of paraphrasing, copy/paste modification, and back-translation attacks.", href: "https://arxiv.org/abs/2508.20228" },
  { id: "S4", kind: "primary research", title: "Watermark under Fire: A Robustness Evaluation of LLM Watermarking", detail: "Liang et al., EMNLP (2025). WaterPark covers 10 watermarking methods and 12 attacks. The numbers describe those schemes; the SynthID-specific papers cover SynthID.", href: "https://arxiv.org/abs/2411.13425" },
  { id: "S5", kind: "primary research", title: "On the Reliability of Watermarks for Large Language Models", detail: "Kirchenbauer et al., ICLR (2024). The counterpoint: paraphrasing dilutes evidence, but sufficiently long text can leak enough original ngrams to remain detectable.", href: "https://arxiv.org/abs/2306.04634" },
  { id: "S6", kind: "primary research", title: "Watermark Stealing in Large Language Models", detail: "Jovanović, Staab & Vechev, ICML (2024). Studies black-box watermark approximation used for both scrubbing and spoofing attacks.", href: "https://arxiv.org/abs/2402.19361" },
  { id: "S7", kind: "survey", title: "A Survey on LLM Watermarking: Theory and Deployment", detail: "Phan et al. (2026 preprint). A current taxonomy of threat models, paraphrasing, translation, token manipulation, mixing, adaptive removal, and spoofing.", href: "https://arxiv.org/abs/2607.10103" },
  { id: "S8", kind: "vendor", title: "SynthID developer guide and product overview", detail: "Google's official explanation of applying SynthID after decoding transforms and detecting with calibrated scoring. It documents the product; independent evaluation lives in the papers above.", href: "https://ai.google.dev/responsible/docs/safeguards/synthid" },
  { id: "S9", kind: "commentary", title: "Text AI watermarks will always be trivial to remove", detail: "Sean Goedecke (2026). An argued case that rewrites and detector-oracle access defeat text watermarks. Read it as a strong opinion; the experiments above shade the picture.", href: "https://www.seangoedecke.com/text-ai-watermarks/" },
  { id: "S10", kind: "commentary", title: "How Does AI Text Watermarking Actually Work?", detail: "ExplainX (2026). An accessible overview and useful source trail. The green/red-list section describes a generic predecessor; SynthID's layered update works differently.", href: "https://www.explainx.ai/blog/how-does-ai-watermarking-work-text-explained-2026" },
  { id: "S11", kind: "vendor", title: "How Claude's text watermark works", detail: "Anthropic (2026). Primary source for Claude-specific rollout and product claims; exact production keys, parameters, and detector thresholds are not public.", href: "https://www.anthropic.com/news/how-claudes-text-watermark-works" },
  { id: "S12", kind: "policy", title: "EU Code of Practice on marking and labelling AI-generated content", detail: "European Commission transparency materials. Primary policy context; it does not establish the technical robustness of any one watermark.", href: "https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content" },
  { id: "S13", kind: "primary research", title: "A Watermark for Large Language Models", detail: "Kirchenbauer et al., ICML (2023). The green-list scheme: a hash-keyed vocabulary split, a logit bias, and an open z-test detector. Ancestor of most later designs.", href: "https://arxiv.org/abs/2301.10226" },
  { id: "S14", kind: "primary research", title: "Robust Distortion-free Watermarks for Language Models", detail: "Kuditipudi, Thickstun, Hashimoto & Liang, TMLR (2024). Keyed pseudorandom-sequence watermarks that preserve the output distribution, with alignment-based detection tolerant of insertions and deletions.", href: "https://arxiv.org/abs/2307.15593" },
  { id: "S15", kind: "primary research", title: "Undetectable Watermarks for Language Models", detail: "Christ, Gunn & Zamir, COLT (2024). A cryptographic watermark whose marked outputs cannot be efficiently distinguished from unmarked ones without the key, assuming only one-way functions.", href: "https://eprint.iacr.org/2023/763" },
  { id: "S16", kind: "primary research", title: "A Semantic Invariant Robust Watermark for Large Language Models", detail: "Liu et al., ICLR (2024). SIR transforms semantic embeddings of preceding tokens through a trained watermark model and reports improved robustness to synonym substitution and paraphrasing.", href: "https://arxiv.org/abs/2310.06356" },
  { id: "S17", kind: "reference code", title: "Watermarking in Hugging Face transformers", detail: "Green-list (WatermarkLogitsProcessor) and SynthID-Text watermarking shipped as built-in library features, so marking and detection run locally for any key you hold.", href: "https://huggingface.co/docs/transformers/en/internal/generation_utils" },
  { id: "S18", kind: "primary research", title: "Pseudorandom Error-Correcting Codes", detail: "Christ & Gunn, CRYPTO (2024). Codes that look random without the decoding key, powering undetectable watermarks that survive a constant rate of edits.", href: "https://arxiv.org/abs/2402.09370" },
  { id: "S19", kind: "primary research", title: "Publicly-Detectable Watermarking for Language Models", detail: "Fairoze, Garg, Jha, Mahloujifar, Mahmoody & Wang, IACR CIC (2024). A detector with no secret parts that anyone can run, with unforgeability guarantees.", href: "https://eprint.iacr.org/2023/1661" },
  { id: "S20", kind: "commentary", title: "My AI Safety Lecture for UT Effective Altruism", detail: "Scott Aaronson (2022). The original watermark proposal in its author's words: a secret-keyed pseudorandom function tilts token choice. Never published as a paper.", href: "https://scottaaronson.blog/?p=6823" }
];

function EvidenceLink({ href, children }: { href: string; children: string }) {
  return <ExternalLink className={LINK_CLASS} href={href}>{children}</ExternalLink>;
}

/** Sources grouped by the weight of evidence they carry; numbering stays global. */
const SOURCE_KIND_LABELS: { kind: Source["kind"]; label: string }[] = [
  { kind: "primary research", label: "primary research" },
  { kind: "reference code", label: "reference code" },
  { kind: "survey", label: "surveys" },
  { kind: "vendor", label: "vendor documentation" },
  { kind: "commentary", label: "commentary" },
  { kind: "policy", label: "policy" }
];

export function Limits() {
  return (
    <div>
      <SectionTitle kicker="limitations & scope" level={1} title="What it can and can't do" sub="A hit is evidence that the text matches a particular watermark configuration at a chosen threshold. It can't identify a user or settle authorship, and a miss never proves a human wrote it." />

      <div className="space-y-10">
        {LIMIT_GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-300">{group.label}</h2>
            <div className="space-y-3">
              {group.items.map((l) => (
                <Card className="p-4" key={l.q}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="reading-rail text-sm font-semibold leading-6">{l.q}</p>
                    <Badge tone={l.tone}>{l.tag}</Badge>
                  </div>
                  <p className="reading-rail mt-2 text-xs leading-5 text-neutral-400">{l.a}</p>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-14" id="removal">
        <SectionTitle kicker="removal & evasion" title="Can you remove it?" sub="Someone with access to any unwatermarked model can rewrite a passage cheaply. That's a long way from removing the watermark while keeping every word, every nuance, and the quality intact." />

        <div className="mt-6 grid gap-3 md:hidden">
          {ATTACKS.map((attack) => (
            <article className="border border-neutral-800 bg-neutral-950 p-4" key={attack.name}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-neutral-200">{attack.name}</h3>
                <Badge tone={attack.tone}>{attack.effect}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-2 text-xs leading-5">
                <dt className="text-neutral-500">effort</dt>
                <dd className="text-neutral-300">{attack.effort}</dd>
                <dt className="text-neutral-500">why</dt>
                <dd className="text-neutral-400">{attack.mechanism}</dd>
                <dt className="text-neutral-500">caveat</dt>
                <dd className="text-neutral-400">{attack.caveat}</dd>
                <dt className="text-neutral-500">evidence</dt>
                <dd className="font-mono text-[11px] text-neutral-400">{attack.evidence}</dd>
              </dl>
            </article>
          ))}
        </div>

        <div className="mt-6 hidden overflow-x-auto border border-neutral-800 md:block">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">Transformations ranked by effort and their likely effect on the watermark</caption>
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950">
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-neutral-400">transformation</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-neutral-400">effort</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-neutral-400">likely effect</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-neutral-400">why / important caveat</th>
              </tr>
            </thead>
            <tbody>
              {ATTACKS.map((attack) => (
                <tr className="align-top" key={attack.name}>
                  <td className="border-b border-neutral-900 px-4 py-4">
                    <p className="text-xs font-semibold text-neutral-200">{attack.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-neutral-400">{attack.evidence}</p>
                  </td>
                  <td className="border-b border-neutral-900 px-4 py-4 text-xs text-neutral-400">{attack.effort}</td>
                  <td className="border-b border-neutral-900 px-4 py-4"><Badge tone={attack.tone}>{attack.effect}</Badge></td>
                  <td className="border-b border-neutral-900 px-4 py-4">
                    <p className="text-xs leading-5 text-neutral-400">{attack.mechanism}</p>
                    <p className="mt-1 text-[11px] leading-5 text-neutral-400">Caveat: {attack.caveat}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
          <div className="border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm font-semibold text-amber-300">What the research shows</p>
            <p className="mt-2 text-sm leading-6 text-neutral-300">"Trivial" is a threat-model claim. A rewrite can be fast and cheap, but the attacker may lose exact wording, style, citations, code correctness, or factual fidelity. And a detector can't read a miss as proof of human authorship. The 2026 survey catalogs modest-effort lexical, paraphrase, translation, mixing, and adaptive attacks; SynthID-specific work reports substantial degradation under meaning-preserving attacks; other experiments show long paraphrases can still leak enough ngrams to detect. Put together: evasion is cheap, and no study shows it always works.</p>
            <p className="mt-3 text-xs leading-5 text-neutral-400">Compare <EvidenceLink href="https://arxiv.org/abs/2508.20228">SynthID-specific robustness results</EvidenceLink>, the broader <EvidenceLink href="https://arxiv.org/abs/2411.13425">WaterPark benchmark</EvidenceLink>, and the counterpoint from <EvidenceLink href="https://arxiv.org/abs/2306.04634">long-text paraphrase experiments</EvidenceLink>.</p>
          </div>
          <Card className="p-4">
            <p className="text-sm font-semibold">See the failure modes</p>
            <p className="mt-2 text-xs leading-5 text-neutral-400">The Detect page has presets for pristine, lightly edited, fully rewritten, wrong-key, and too-short text, all running on this demo's real token IDs and masks.</p>
            <Link className="mt-4 inline-flex border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/15" to="/detect">Open the Detect page →</Link>
          </Card>
        </div>

        <div className="mt-5 border border-sky-500/30 bg-sky-500/5 px-4 py-4"><p className="text-sm font-semibold text-sky-300">If you're deploying one</p><p className="reading-rail mt-1 text-sm leading-6 text-sky-100/85">A watermark earns its keep as one signal in a layered provenance system. Query limits, key rotation, score granularity, minimum text length, and an appeals path all decide whether it helps, and whether it turns into an evasion or spoofing oracle.</p></div>
        <p className="reading-rail mt-4 border-l-2 border-amber-500/50 pl-3 text-xs leading-5 text-neutral-400">
          Demo scope: the probability update is cross-checked against the published SynthID reference, but the hand-authored model, surface-form tokenizer, string-key adapter, and detector thresholds are educational stand-ins. The attack behavior shown here should not be read as a production robustness measurement.
        </p>
      </section>

      <section className="mt-14" id="approaches">
        <SectionTitle kicker="alternative approaches" title="Other ways to mark the text" sub="Claude's watermark is one design point in a crowded field. Schemes trade three things — who can verify the mark, how much rewriting it survives, and how exactly it preserves quality. The sources below do not establish a production system that maximizes all three." />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {APPROACHES.map((a) => (
            <Card className="p-4" key={a.name}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-6">{a.name}</p>
                <Badge tone={a.tone}>{a.tag}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-neutral-400">{a.body}</p>
              <p className="mt-2 font-mono text-[11px] leading-4 text-neutral-400">{a.status}</p>
            </Card>
          ))}
        </div>

        <div className="mt-6 border border-sky-500/30 bg-sky-500/5 px-4 py-4">
          <p className="text-sm font-semibold text-sky-300">Reading the trade-offs</p>
          <p className="reading-rail mt-1 text-sm leading-6 text-neutral-300">Claude's announced approach pairs an expected-distribution guarantee with vendor-operated verification. Other deployments can keep a keyed or trained detector private, expose it through an API, or publish it. Green-list and distortion-free schemes let anyone holding the relevant secret verify locally; semantic schemes pursue empirical rewrite robustness with model- and configuration-dependent quality and compute trade-offs; publicly detectable cryptographic schemes aim to remove secret detection authority altogether.</p>
          <p className="reading-rail mt-3 text-xs leading-5 text-neutral-400">Compare the <EvidenceLink href="https://arxiv.org/abs/2301.10226">original green-list paper</EvidenceLink>, the <EvidenceLink href="https://arxiv.org/abs/2307.15593">distortion-free construction</EvidenceLink>, <EvidenceLink href="https://arxiv.org/abs/2310.06356">semantic watermarking</EvidenceLink>, and <EvidenceLink href="https://eprint.iacr.org/2023/1661">publicly detectable watermarking</EvidenceLink>.</p>
        </div>
        <p className="reading-rail mt-4 border-l-2 border-amber-500/50 pl-3 text-xs leading-5 text-neutral-400">
          Survey scope: these are designs, not products. Adoption statements reflect public announcements as of August 2026, and none of these schemes runs in this demo.
        </p>
      </section>

      <div className="mt-14" id="sources">
        <SectionTitle kicker="annotated sources" title="Where the claims come from" sub="Research and reference code back the technical claims; vendor pages document product behavior; commentary adds intuition without experimental weight. Grouped by the weight they carry; entries keep their original numbering." />
        <div className="space-y-8">
          {SOURCE_KIND_LABELS.map(({ kind, label }) => {
            const entries = SOURCES.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.kind === kind);
            if (!entries.length) return null;
            return (
              <section key={kind}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-neutral-300">
                  {label} <span className="font-mono text-[11px] font-normal normal-case tracking-normal text-neutral-400">({entries.length})</span>
                </h3>
                <ol className="reading-rail space-y-3">
                  {entries.map(({ s, n }) => (
                    <li className="text-sm leading-6" key={s.id} style={{ paddingLeft: "1.5rem", textIndent: "-1.5rem" }}>
                      <span className="text-neutral-400">[{n}]</span>{" "}
                      <EvidenceLink href={s.href}>{s.title}</EvidenceLink>{" "}
                      <span className="text-neutral-400">{s.detail}</span>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
