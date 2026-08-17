// Accuracy harness for the SynthID-Text engine and miniature.
// Bundled with esbuild first. Run: node .test/run.mjs
//
// Covers, per the review's required implementation direction:
//   1. Self-consistency: detector recomputes generator's g-values and masks
//      position-by-position, with zero mismatches.
//   2. Context reconstruction identical on both sides.
//   3. Lossless tokenization round-trip on EVERY scenario.
//   4. Signal separation: watermarked prose/translation -> strong; plain,
//      wrong-key -> none/inconclusive.
//   5. Repetition masking: repeated contexts are watermarked and scored at
//      most once, identically at generation and detection.
//   6. Non-distortion: the update rule preserves mass; averaged over keyed
//      seeds, a peaked distribution returns to its base marginal. A fixed
//      seed can still boost a low-probability supported token dramatically,
//      while exact zero support remains zero.
//   7. Reference probability update: mean sampled g on uniform sets matches
//      direct measurements of DeepMind's shipped recurrence.
//   8. Null behavior: one-sided p-value thresholds on unwatermarked runs
//      with an independently varied key, plus short-text abstention.
//   9. Length behaviour: evidence accumulates; short -> inconclusive.
//  10. Key derivation/cache isolation and determinism.
import {
  generateTrace, detectTokenIds, detectText, tokenize, tokenId,
  makeConfig, analyzeTokens, updateProbs, gValues, expectedMeanGValue,
  sampleIndex, makeRng, layerWeights, deriveLayerKeys, keyMaterial,
  falsePositiveRate, sha256String
} from "./entry.ts";
import { SCENARIOS } from "./entry.ts";

const KEY = "***";
const byId = (id) => SCENARIOS.find((s) => s.id === id);

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL  ${name}  ${detail || ""}`); }
}

// ---- 1. Self-consistency: detector exactly recovers generator state ----
console.log("=== 1. Self-consistency: detection == generation ===");
for (const id of ["prose", "translation", "code", "facts"]) {
  const sc = byId(id);
  const trace = generateTrace(sc.specs, { watermark: true, key: KEY, rng: makeRng(11) });
  const det = detectTokenIds(trace.tokenIds, KEY);

  let gMismatch = 0, maskMismatch = 0, checked = 0;
  for (let i = 0; i < trace.steps.length; i++) {
    const gen = trace.steps[i];
    const d = det.steps[i];
    // Context reconstruction
    if (JSON.stringify(gen.contextIds) !== JSON.stringify(d.contextIds)) maskMismatch++;
    if (!gen.watermarked) continue;
    checked++;
    if (!d.gValues.every((g, l) => g === gen.gOfChosen[l])) gMismatch++;
    if (!d.repetitionMask) maskMismatch++; // generator watermarked => detector must score it
  }
  check(`${id}: g-values match at all ${checked} watermarked positions`, gMismatch === 0, `${gMismatch} mismatches`);
  check(`${id}: masks + contexts match everywhere`, maskMismatch === 0, `${maskMismatch} mismatches`);
  check(`${id}: detector n + masked == generator scored+masked`, det.n + det.masked === trace.steps.filter((s) => s.watermarked).length + trace.steps.filter((s) => s.repeatedContext && s.contextIds.length === 4).length, `det n=${det.n} masked=${det.masked}`);
}

// ---- 2. Tokenize round-trip on EVERY scenario ----
console.log("\n=== 2. Tokenization round-trip (all scenarios) ===");
{
  let allOk = true;
  for (const sc of SCENARIOS) {
    const wm = generateTrace(sc.specs, { watermark: true, key: KEY, rng: makeRng(3) });
    const { ids, surfaces } = tokenize(wm.text);
    const okIds = ids.length === wm.tokenIds.length && ids.every((id, i) => id === wm.tokenIds[i]);
    const okText = surfaces.join("") === wm.text;
    if (!(okIds && okText)) allOk = false;
    console.log(`   ${sc.id.padEnd(12)} ${wm.tokenIds.length} tokens: ${okIds && okText ? "OK" : "FAIL"}`);
  }
  check("tokenize(render(trace)) == trace for every scenario", allOk);

  // detectText on pasted watermarked prose must agree with detectTokenIds
  const prose = byId("prose");
  const wm = generateTrace(prose.specs, { watermark: true, key: KEY, rng: makeRng(11) });
  const pasted = detectText(wm.text, KEY);
  const direct = detectTokenIds(wm.tokenIds, KEY);
  check("detectText(pasted) == detectTokenIds(generated)", pasted.z === direct.z && pasted.verdict === direct.verdict, `pasted z=${pasted.z} direct z=${direct.z}`);

  const unicodeWhitespace = "alpha\u00a0beta\u2028gamma  ";
  const unicodeTokens = tokenize(unicodeWhitespace);
  check("tokenizer preserves Unicode and trailing whitespace", unicodeTokens.surfaces.join("") === unicodeWhitespace && unicodeTokens.surfaces.at(-1) === "  ");
}

// ---- 3. Signal separation ----
console.log("\n=== 3. Signal separation ===");
{
  const prose = byId("prose");
  const wm = generateTrace(prose.specs, { watermark: true, key: KEY, rng: makeRng(11) });
  const dWm = detectTokenIds(wm.tokenIds, KEY);
  console.log(`   watermarked:   z=${dWm.z.toFixed(2)} p=${dWm.pValue.toExponential(2)} meanG=${dWm.meanScore.toFixed(3)} verdict=${dWm.verdict} (n=${dWm.n}, ${wm.steps.length} steps)`);
  check("watermarked prose -> strong", dWm.verdict === "strong", dWm.verdict);
  check("mean g well above 0.5", dWm.meanScore > 0.52, dWm.meanScore.toFixed(3));

  const plain = generateTrace(prose.specs, { watermark: false, key: KEY, rng: makeRng(11) });
  const dPlain = detectTokenIds(plain.tokenIds, KEY);
  console.log(`   unwatermarked: z=${dPlain.z.toFixed(2)} p=${dPlain.pValue.toExponential(2)} verdict=${dPlain.verdict}`);
  check("unwatermarked prose -> none/inconclusive", dPlain.verdict === "none" || dPlain.verdict === "inconclusive", dPlain.verdict);

  const dWrong = detectTokenIds(wm.tokenIds, "another-key-999");
  console.log(`   wrong key:     z=${dWrong.z.toFixed(2)} p=${dWrong.pValue.toExponential(2)} verdict=${dWrong.verdict}`);
  check("wrong key -> no signal", dWrong.verdict === "none" || dWrong.verdict === "inconclusive", dWrong.verdict);

  const tr = byId("translation");
  const trWm = generateTrace(tr.specs, { watermark: true, key: KEY, rng: makeRng(9) });
  const dTr = detectTokenIds(trWm.tokenIds, KEY);
  console.log(`   translation:   z=${dTr.z.toFixed(2)} p=${dTr.pValue.toExponential(2)} verdict=${dTr.verdict}`);
  check("translation -> likely or strong", dTr.verdict === "strong" || dTr.verdict === "likely", dTr.verdict);
}

// ---- 4. Repetition masking ----
console.log("\n=== 4. Repetition masking ===");
{
  // Crafted sequence with deliberately repeated 4-gram contexts.
  const ids = [];
  for (let rep = 0; rep < 3; rep++) {
    ids.push(tokenId("alpha"), tokenId("beta"), tokenId("gamma"), tokenId("delta"), tokenId("word" + rep));
  }
  // contexts: [beta,gamma,delta,word0], [gamma,delta,word0,alpha], ... the
  // block "alpha beta gamma delta" repeats, so context [alpha,beta,gamma,delta]
  // repeats for word1/word2.
  const a = analyzeTokens(ids, makeConfig(KEY));
  check("repeated contexts are masked", a.masked === 2, `masked=${a.masked}`);
  check("mask count consistent (n + masked = ngrams)", a.n + a.masked === ids.length - 4, `n=${a.n}`);

  // Generation side must skip them too: build a spec sequence whose contexts
  // repeat and confirm the second occurrence is NOT watermarked.
  const s = (text) => ({ candidates: [{ id: tokenId(text), text, w: 100 }] });
  const specs = [];
  for (let rep = 0; rep < 3; rep++) {
    specs.push(s(" alpha"), s(" beta"), s(" gamma"), s(" delta"), { candidates: [{ id: tokenId(" w" + rep), text: " w" + rep, w: 100 }] });
  }
  const trace = generateTrace(specs, { watermark: true, key: KEY, rng: makeRng(5) });
  const watermarkedPositions = trace.steps.map((st, i) => (st.watermarked ? i : -1)).filter((i) => i >= 0);
  // First block: pos 4 gets watermarked (first context). pos 9, 14 repeat it.
  check("generator watermarks first occurrence only", trace.steps[4].watermarked && !trace.steps[9].watermarked && !trace.steps[14].watermarked, `watermarked at ${watermarkedPositions.join(",")}`);

  const det = detectTokenIds(trace.tokenIds, KEY);
  check("detector masks the same positions", det.masked === 2 && det.n === trace.steps.filter((st) => st.watermarked).length, `det masked=${det.masked} n=${det.n}`);
}

// ---- 5. Non-distortion ----
console.log("\n=== 5. Non-distortion ===");
{
  // (a) updateProbs preserves mass exactly.
  const cfg = makeConfig(KEY);
  const ctx = [tokenId("a"), tokenId("b"), tokenId("c"), tokenId("d")];
  let maxDrift = 0;
  for (let t = 0; t < 50; t++) {
    const ids = Array.from({ length: 5 }, (_, i) => tokenId(`nd${t}-${i}`));
    const rng = makeRng(t);
    const base = ids.map(() => rng());
    const sumB = base.reduce((s, x) => s + x, 0);
    const p = base.map((x) => x / sumB);
    const gvs = ids.map((id) => gValues(cfg, ctx, id));
    const upd = updateProbs(p, gvs);
    const sumU = upd.reduce((s, x) => s + x, 0);
    maxDrift = Math.max(maxDrift, Math.abs(sumU - 1));
    if (upd.some((x) => x < 0)) { maxDrift = 1; break; }
  }
  check("update rule preserves probability mass (50 random steps)", maxDrift < 1e-9, `max drift ${maxDrift}`);

  // Non-distortion is a marginal guarantee, not a per-key/context gate. This
  // checked context deliberately makes a 5% token almost certain.
  {
    const peakedIds = [tokenId(" likely"), tokenId(" rare-a"), tokenId(" rare-b")];
    const peakedCtx = ["ctx-53-a", "ctx-53-b", "ctx-53-c", "ctx-53-d"].map(tokenId);
    const shifted = updateProbs([0.9, 0.05, 0.05], peakedIds.map((id) => gValues(makeConfig("demo-key-001"), peakedCtx, id)));
    check("a fixed keyed context can strongly boost a 5% token", shifted[1] > 0.999, shifted.map((p) => p.toExponential(3)).join(", "));
  }

  // Multiplicative tournament updates and categorical sampling must preserve
  // exclusions introduced by top-k/top-p or hard constraints.
  {
    const zeroSafe = updateProbs([1, 0, 0], [[0, 0], [1, 1], [1, 0]]);
    const neverImpossible = Array.from({ length: 200 }, (_, seed) => sampleIndex(zeroSafe, makeRng(seed))).every((i) => i === 0);
    check("zero-probability candidates remain impossible", zeroSafe[1] === 0 && zeroSafe[2] === 0 && neverImpossible, zeroSafe.join(", "));

    const zeroInput = generateTrace([{ candidates: [
      { id: tokenId(" possible"), text: " possible", w: 1 },
      { id: tokenId(" impossible"), text: " impossible", w: 0 }
    ] }], { watermark: false, key: KEY, rng: () => 0.999999 });
    check("zero candidate weights remain exactly zero", zeroInput.steps[0].candidates[1].baseProb === 0 && zeroInput.steps[0].chosenIndex === 0);
  }

  // (b) Non-distortion, measured the same way the reference probe does
  // (.test/xval_behaviour.py): at a SINGLE peaked step p=[0.9,0.05,0.05],
  // average the updated dominant probability over many random contexts.
  // Reference with iid random g: 0.90039; this engine with real keyed
  // g-values must land on the same value. This isolates the update rule
  // from sequence feedback (the watermarked sampler legitimately tilts
  // short synthetic sequences a little — that tilt IS the signal).
  {
    let sumDom = 0, T = 20000;
    for (let t = 0; t < T; t++) {
      const rngC = makeRng(700000 + t);
      const ctxB = Array.from({ length: 4 }, () => Math.floor(rngC() * 0x3fffffff));
      const ids = [Math.floor(rngC() * 0x3fffffff), Math.floor(rngC() * 0x3fffffff), Math.floor(rngC() * 0x3fffffff)];
      const gvs = ids.map((id) => gValues(cfg, ctxB, id));
      const upd = updateProbs([0.9, 0.05, 0.05], gvs);
      sumDom += upd[0];
    }
    const eDom = sumDom / T;
    console.log(`   single-step E[p'_dominant] = ${eDom.toFixed(5)} (ref iid-g measurement: 0.90039)`);
    check("update rule non-distortionary at peaked steps", Math.abs(eDom - 0.9) < 0.012, eDom.toFixed(5));
  }
  // Plain generation must reproduce the base distribution (sanity of the
  // unwatermarked path, averaged over seeds).
  {
    const mkSpecs = () => Array.from({ length: 60 }, () => ({
      candidates: [
        { id: tokenId(" dominant"), text: " dominant", w: 90 },
        { id: tokenId(" rare1"), text: " rare1", w: 5 },
        { id: tokenId(" rare2"), text: " rare2", w: 5 }
      ]
    }));
    let dom = 0, N = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const pl = generateTrace(mkSpecs(), { watermark: false, key: KEY, rng: makeRng(seed) });
      dom += pl.steps.filter((st) => st.chosenToken.includes("dominant")).length;
      N += pl.steps.length;
    }
    dom /= N;
    console.log(`   plain sampling reproduces base: dominant=${dom.toFixed(4)} (base 0.90)`);
    check("plain generation matches base distribution", Math.abs(dom - 0.9) < 0.015, dom.toFixed(4));
  }

  // (c) Tournament boost on UNIFORM sets, measured against the REFERENCE's
  // own measurement of the iterated recurrence (.test/xval_behaviour.py):
  // V=4: 0.5777, V=8: 0.6122, V=16: 0.6435, V=32: 0.6702. (These sit below
  // the paper's closed-form tournament values — Corollary 27 — which hold
  // for the full tournament; the iterated recurrence is the weaker variant
  // the reference ships.) Averaged over 64 random contexts, 40k draws each.
  const cfg2 = makeConfig("theory-key");
  const refExpect = { 4: 0.5777, 8: 0.6122, 16: 0.6435, 32: 0.6702 };
  let ok = true;
  for (const V of [4, 8, 16]) {
    const ids = Array.from({ length: V }, (_, i) => tokenId(`u${V}-${i}`));
    let acc = 0;
    const CTX = 64, T = 40000;
    for (let cNum = 0; cNum < CTX; cNum++) {
      const rngC = makeRng(1000 + cNum);
      const ctx2 = Array.from({ length: 4 }, () => Math.floor(rngC() * 0x3fffffff));
      const gvs = ids.map((id) => gValues(cfg2, ctx2, id));
      const upd = updateProbs(Array(V).fill(1 / V), gvs);
      const rng = makeRng(42 + V * 1000 + cNum);
      for (let t = 0; t < T; t++) {
        let u = rng(), j = 0;
        while (j < V - 1 && u > upd[j]) { u -= upd[j]; j++; }
        acc += gvs[j].reduce((a, g) => a + g, 0) / gvs[j].length;
      }
    }
    const emp = acc / (CTX * T);
    console.log(`   V=${V}: sampled mean g=${emp.toFixed(4)} reference-measured=${refExpect[V]}`);
    if (Math.abs(emp - refExpect[V]) > 0.012) ok = false;
  }
  check("tournament boost matches reference behaviour (±0.012)", ok);
}

// ---- 6. Null false-positive behavior ----
console.log("\n=== 6. False-positive rates on unwatermarked text (fresh keys) ===");
{
  const TRIALS = 600;
  for (const sc of SCENARIOS) {
    let fpLikely = 0, fpStrong = 0, counted = 0;
    for (let t = 0; t < TRIALS; t++) {
      // Vary the detector key as well as the sampling stream. A fixed tiny
      // hand-authored corpus can accidentally align with one particular key;
      // fresh keys test the keyed-coin null claimed by this miniature.
      const nullKey = `null-${sc.id}-${t}`;
      const plain = generateTrace(sc.specs, { watermark: false, key: nullKey, rng: makeRng(200000 + t * 131 + sc.id.length) });
      const d = detectTokenIds(plain.tokenIds, nullKey);
      if (d.n < 12) continue;
      counted++;
      if (d.pValue <= 0.01) fpLikely++;
      if (d.pValue <= 0.001) fpStrong++;
    }
    const rLikely = counted ? fpLikely / counted : 0;
    const rStrong = counted ? fpStrong / counted : 0;
    console.log(`   ${sc.id.padEnd(12)} FP(p<=.01)=${(rLikely * 100).toFixed(2)}%  FP(p<=.001)=${(rStrong * 100).toFixed(2)}%  (${counted} runs)`);
    if (counted >= 100) {
      check(`${sc.id}: FP(p<=.01) <= 3%`, rLikely <= 0.03, (rLikely * 100).toFixed(2) + "%");
      check(`${sc.id}: FP(p<=.001) <= 1%`, rStrong <= 0.01, (rStrong * 100).toFixed(2) + "%");
    } else {
      check(`${sc.id}: short shape abstains (inconclusive)`, counted === 0, `${counted} runs reached n>=12`);
    }
  }
}

// ---- 7. Power + sparsity ----
console.log("\n=== 7. Power (watermarked) and sparsity (sparse content) ===");
{
  const runs = (id, seeds) => {
    const sc = byId(id);
    const out = [];
    for (let t = 0; t < seeds; t++) {
      const wm = generateTrace(sc.specs, { watermark: true, key: KEY, rng: makeRng(300000 + t * 97 + id.length) });
      out.push(detectTokenIds(wm.tokenIds, KEY));
    }
    return out;
  };
  const count = (rs, v) => rs.filter((r) => r.verdict === v).length;

  const proseRuns = runs("prose", 100);
  check("prose: >=85% strong", count(proseRuns, "strong") >= 85, `${count(proseRuns, "strong")}%`);
  check("prose: 0 none", count(proseRuns, "none") === 0, `${count(proseRuns, "none")}%`);

  const trRuns = runs("translation", 100);
  check("translation: >=95% likely-or-strong", count(trRuns, "strong") + count(trRuns, "likely") >= 95, `${count(trRuns, "strong") + count(trRuns, "likely")}%`);

  for (const id of ["facts", "code"]) {
    const rs = runs(id, 100);
    const strong = count(rs, "strong");
    check(`${id}: never strong`, strong === 0, `${strong}%`);
  }

  // The sparse-but-long scenarios: long enough to render a real verdict
  // (n >= 12), yet the verdict is overwhelmingly "none" — the showcase of
  // "not possible to detect" without confusing it with short-text abstention.
  for (const id of ["quote", "proofread"]) {
    const rs = runs(id, 100);
    check(`${id}: long enough for a verdict (n >= 12)`, rs.every((r) => r.n >= 12), rs.map((r) => r.n).join(","));
    check(`${id}: predominantly no signal (>= 90% none)`, count(rs, "none") >= 90, `${count(rs, "none")}%`);
    check(`${id}: strong rate <= 2%`, count(rs, "strong") <= 2, `${count(rs, "strong")}%`);
  }

  // The code scenario's explanation states its trace contains no repeated
  // four-token contexts, so the repetition mask never fires there.
  {
    const code = byId("code");
    const tr = generateTrace(code.specs, { watermark: true, key: KEY, rng: makeRng(11) });
    const repeats = tr.steps.filter((s) => s.repeatedContext).length;
    check("code trace contains no repeated contexts", repeats === 0, `${repeats} repeats`);
  }
}

// ---- 8. Length behaviour ----
console.log("\n=== 8. Length behaviour ===");
{
  const prose = byId("prose");
  const wmFull = generateTrace(prose.specs, { watermark: true, key: KEY, rng: makeRng(11) });
  const short = detectTokenIds(wmFull.tokenIds.slice(0, 6), KEY);
  check("6 tokens -> inconclusive", short.verdict === "inconclusive", short.verdict);

  // Evidence is noisy at any one prefix, but this deterministic watermarked
  // example should move decisively away from the null as it grows.
  const d14 = detectTokenIds(wmFull.tokenIds.slice(0, 14), KEY);
  const d54 = detectTokenIds(wmFull.tokenIds.slice(0, 54), KEY);
  const dAll = detectTokenIds(wmFull.tokenIds, KEY);
  console.log(`   z at 14/54/all tokens: ${d14.z.toFixed(2)} / ${d54.z.toFixed(2)} / ${dAll.z.toFixed(2)}`);
  check("evidence grows with length", d54.z > d14.z + 1 && dAll.z > 3.09, `${d14.z} ${d54.z} ${dAll.z}`);
}

// ---- 9. Key handling + determinism ----
console.log("\n=== 9. Key handling and determinism ===");
{
  const ascii = deriveLayerKeys("A", 2);
  const unicode = deriveLayerKeys("Ł", 2);
  check("Unicode key bytes do not collide with low-byte ASCII", ascii.some((v, i) => v !== unicode[i]));

  const kmA = keyMaterial(makeConfig("same-label", { depth: 2, layerKeys: [BigInt(1), BigInt(2)] }));
  const kmB = keyMaterial(makeConfig("same-label", { depth: 2, layerKeys: [BigInt(3), BigInt(4)] }));
  check("explicit layer-key material is isolated in cache", kmA.iv !== kmB.iv);

  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  check("invalid SynthID configuration is rejected", throws(() => makeConfig(KEY, { depth: 0 })) && throws(() => makeConfig(KEY, { ngramLen: NaN })));
  check("invalid candidate weights are rejected", throws(() => generateTrace([{ candidates: [{ id: 1, text: " bad", w: NaN }] }], { watermark: false, key: KEY })));
  check("invalid detector diagnostics are rejected", throws(() => analyzeTokens([], makeConfig(KEY), { varianceCorrection: 0 })) && throws(() => falsePositiveRate(() => [], makeConfig(KEY), { trials: 0, thresholds: [1] })));

  const emojiDigest = Array.from(sha256String("😀"), (b) => b.toString(16).padStart(2, "0")).join("");
  check("SHA-256 string helper encodes astral Unicode as UTF-8", emojiDigest === "f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9", emojiDigest);

  const prose = byId("prose");
  const a = generateTrace(prose.specs, { watermark: true, key: KEY, rng: makeRng(42) }).text;
  const b = generateTrace(prose.specs, { watermark: true, key: KEY, rng: makeRng(42) }).text;
  const c = generateTrace(prose.specs, { watermark: false, key: KEY, rng: makeRng(42) }).text;
  check("same seed+key -> identical text", a === b);
  check("watermark changes the picks", a !== c);

  const forced = generateTrace([{ candidates: [{ id: tokenId(" only"), text: " only", w: 100 }] }], { watermark: true, key: KEY, rng: makeRng(2) });
  check("one-candidate distribution reports zero movement", forced.steps[0].effectSize === 0, String(forced.steps[0].effectSize));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) console.log("Failed: " + fails.join("; "));
process.exit(fail ? 1 : 0);
