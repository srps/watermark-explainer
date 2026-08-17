// Cross-validation: compare the TypeScript engine against ground-truth
// vectors produced by DeepMind's reference implementation (synthid-text PyPI
// package, torch). Run .test/xval_make_vectors.py first (via run_xval.sh).
//
// Every comparison here is bit-exact or near-exact:
//   - hash IV from the layer keys (int64)
//   - accumulate_hash on fixed (start, data) pairs incl. negative values
//   - raw ngram keys (int64) for crafted ngrams
//   - g-values per layer for a 100+ token sequence with repeated contexts
//   - the context-repetition mask for that sequence
//   - update_scores (probability recurrence) on fixed scores
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  accumulateHash, hashIv, gValues, makeConfig, analyzeTokens, updateProbs
} from "./entry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vec = JSON.parse(readFileSync(join(here, "xval-vectors.json"), "utf8"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail || ""}`); }
}

const KEYS = vec.keys.map((k) => BigInt(k));
const NGRAM_LEN = vec.ngram_len;
const DEPTH = vec.keys.length;
const cfg = makeConfig("xval", { depth: DEPTH, ngramLen: NGRAM_LEN, layerKeys: KEYS });

// 1. IV
{
  const iv = hashIv(KEYS);
  const ok = iv === BigInt(vec.hash_iv);
  console.log(`\n=== hash IV ===\n   ref=${vec.hash_iv}\n   ts =${iv}`);
  check("hash IV matches reference", ok);
}

// 2. accumulate_hash vectors
console.log("\n=== accumulate_hash ===");
{
  let all = true;
  for (const v of vec.accumulate_hash) {
    const got = accumulateHash(BigInt(v.start), v.data.map(BigInt));
    const want = BigInt(v.result);
    const ok = got === want;
    if (!ok) { all = false; console.log(`   MISMATCH start=${v.start} data=[${v.data}] got=${got} want=${want}`); }
  }
  check(`accumulate_hash matches on all ${vec.accumulate_hash.length} vectors`, all);
}

// 3. raw ngram keys for crafted ngrams (checks hashing incl. layer keys)
console.log("\n=== crafted ngram keys (raw int64) ===");
{
  // We need the same internal: base ngram key, then accumulate layer key.
  // Reproduce: iv -> +context -> +token -> +layerKey_k
  const iv = hashIv(KEYS);
  let all = true;
  for (let i = 0; i < vec.crafted_ngram_keys_head.length; i++) {
    const ngram = vec.crafted_ngrams[i];
    const ctx = ngram.slice(0, NGRAM_LEN - 1);
    const tok = ngram[NGRAM_LEN - 1];
    for (let k = 0; k < DEPTH; k++) {
      let h = accumulateHash(iv, ctx);
      h = accumulateHash(h, [BigInt(tok)]);
      h = accumulateHash(h, [KEYS[k]]);
      const want = BigInt(vec.crafted_ngram_keys_head[i][k]);
      if (h !== want) {
        all = false;
        console.log(`   MISMATCH ngram=${i} layer=${k} got=${h} want=${want}`);
        break;
      }
    }
    if (!all) break;
  }
  check("raw ngram keys match (4 ngrams x 30 layers)", all);
}

// 4. crafted g-values (bit extraction)
console.log("\n=== crafted g-values ===");
{
  let mism = 0, total = 0;
  for (let i = 0; i < vec.crafted_ngrams.length; i++) {
    const ngram = vec.crafted_ngrams[i];
    const ctx = ngram.slice(0, NGRAM_LEN - 1);
    const tok = ngram[NGRAM_LEN - 1];
    const got = gValues(cfg, ctx, tok);
    const want = vec.crafted_g_values[i];
    for (let k = 0; k < DEPTH; k++) {
      total++;
      if (got[k] !== want[k]) mism++;
    }
  }
  console.log(`   ${total} g-values compared, ${mism} mismatches`);
  check("crafted g-values all match", mism === 0, `${mism}/${total}`);
}

// 5. sequence g-values + repetition mask
console.log("\n=== sequence g-values + repetition mask ===");
{
  const ids = vec.token_ids;
  const a = analyzeTokens(ids, cfg);
  const nNgrams = vec.g_values.length;
  check("ngram count matches", a.n + a.masked === nNgrams, `ts=${a.n + a.masked} ref=${nNgrams}`);

  let gMism = 0, maskMism = 0;
  const maskMismIdx = [];
  for (let i = 0; i < nNgrams; i++) {
    const step = a.steps[i + (NGRAM_LEN - 1)];
    const want = vec.g_values[i];
    for (let k = 0; k < DEPTH; k++) {
      if (step.gValues[k] !== want[k]) gMism++;
    }
    // Reference ngram i = tokens[i..i+ngramLen-1]; its CONTEXT is
    // tokens[i..i+ngramLen-2], attached in analyzeTokens to the step for
    // token pos = i+ngramLen-1. (ref mask: 1 = kept; ts: true = kept.)
    if ((step.repetitionMask ? 1 : 0) !== Number(vec.repetition_mask[i])) {
      maskMism++;
      if (maskMismIdx.length < 8) maskMismIdx.push(i);
    }
  }
  console.log(`   g-values: ${nNgrams * DEPTH} compared, ${gMism} mismatches`);
  console.log(`   mask: ${nNgrams} compared, ${maskMism} mismatches (ref masked=${nNgrams - vec.repetition_mask.reduce((s, x) => s + x, 0)}, ts masked=${a.masked})`);
  if (maskMism > 0) {
    console.log("   first mismatching ngram indices:", maskMismIdx.join(", "));
    for (const i of maskMismIdx.slice(0, 3)) {
      const step = a.steps[i + (NGRAM_LEN - 1)];
      console.log(`     ngram ${i}: ref=${vec.repetition_mask[i]} ts=${step.repetitionMask ? 1 : 0} ctx=[${step.contextIds}]`);
    }
  }
  check("sequence g-values all match", gMism === 0, `${gMism}/${nNgrams * DEPTH}`);
  check("repetition mask matches", maskMism === 0, `${maskMism}/${nNgrams}`);
}

// 6. update_scores recurrence
console.log("\n=== update_scores (probability recurrence) ===");
{
  const { scores, g_values: gvs, updated_log_probs } = vec.update_scores;
  // softmax the float32 scores (reference softmaxes internally)
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sumE = exps.reduce((s, x) => s + x, 0);
  const probs = exps.map((e) => e / sumE);
  const upd = updateProbs(probs, gvs);
  const refProbs = updated_log_probs.map((lp) => Math.exp(lp));
  let maxAbs = 0, maxRel = 0;
  for (let i = 0; i < upd.length; i++) {
    const d = Math.abs(upd[i] - refProbs[i]);
    maxAbs = Math.max(maxAbs, d);
    if (refProbs[i] > 1e-8) maxRel = Math.max(maxRel, d / refProbs[i]);
  }
  console.log(`   max abs diff=${maxAbs.toExponential(2)}  max rel diff=${maxRel.toExponential(2)} (float32 reference)`);
  // float32 softmax + 30 multiplicative layers: expect ~1e-5 relative.
  check("update_scores matches reference (tol 1e-3 rel)", maxRel < 1e-3, maxRel.toExponential(2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
