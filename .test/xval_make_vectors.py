"""Cross-validation vectors from DeepMind's reference SynthID-Text code.

Runs the REAL implementation (synthid-text PyPI package) on fixed inputs and
dumps every intermediate the TypeScript miniature must reproduce bit-for-bit:

  1. the hash IV derived from the layer keys
  2. accumulate_hash on fixed (start, data) pairs, incl. negative values
  3. per-ngram g-values for a fixed token sequence
  4. the context-repetition mask for the same sequence
  5. g-values for crafted (context, candidate) ngrams
  6. update_scores (the probability-update recurrence) on fixed scores

Output: .test/xval-vectors.json
"""
import json
import sys
import types

import torch

# We only need hashing + scoring internals from synthid_text, not a real
# transformers install. Stub the one thing logits_processing uses from it
# (the LogitsProcessor base class) to dodge dependency-version checks.
fake_transformers = types.ModuleType("transformers")
fake_transformers.LogitsProcessor = type("LogitsProcessor", (), {})
sys.modules["transformers"] = fake_transformers

from synthid_text import hashing_function, logits_processing  # noqa: E402

KEYS = [
    654, 400, 836, 123, 340, 443, 597, 160, 57, 29,
    590, 639, 13, 715, 468, 990, 966, 226, 324, 585,
    118, 504, 421, 521, 129, 669, 732, 225, 90, 960,
]
NGRAM_LEN = 5
DEPTH = len(KEYS)

proc = logits_processing.SynthIDLogitsProcessor(
    ngram_len=NGRAM_LEN,
    keys=KEYS,
    context_history_size=1024,
    temperature=1.0,
    top_k=40,
    device=torch.device("cpu"),
)

out = {"keys": KEYS, "ngram_len": NGRAM_LEN}

# 1. IV
# NOTE: all int64 values are serialised as STRINGS — Python's json would
# round big ints through float64 and corrupt anything above 2^53.
out["hash_iv"] = str(int(proc.hash_iv))
print("hash_iv:", proc.hash_iv)

# 2. accumulate_hash vectors (incl. negatives, big values, wrapping)
acc_vectors = []
for start, data in [
    (0, [1]),
    (123456789, [42, 7, 99]),
    (-5, [1, 2, 3]),
    (2**63 - 1, [1]),          # wrap at the top
    (-(2**63), [-1]),          # wrap at the bottom
    (int(proc.hash_iv), [101, 202, 303, 404]),
    (int(proc.hash_iv), KEYS[:5]),
]:
    res = hashing_function.accumulate_hash(torch.tensor(start, dtype=torch.long),
                                           torch.tensor(data, dtype=torch.long))
    acc_vectors.append({"start": str(start), "data": data, "result": str(int(res))})
out["accumulate_hash"] = acc_vectors

# 3. + 4. g-values and repetition mask over a fixed sequence with repeated
# contexts. Token IDs in a realistic vocab range.
torch.manual_seed(0)
base = torch.randint(0, 5000, (90,), dtype=torch.long)
# Force some repeated 4-gram contexts: repeat a block.
block = base[10:18].clone()
ids = torch.cat([base[:40], block, base[40:60], block, base[60:]], dim=0)
ids = ids.unsqueeze(0)
out["token_ids"] = ids[0].tolist()

g_values = proc.compute_g_values(ids)  # [1, n_ngrams, depth]
rep_mask = proc.compute_context_repetition_mask(ids)  # [1, n_ngrams]
out["g_values"] = g_values[0].tolist()
out["repetition_mask"] = rep_mask[0].tolist()
print("n_ngrams:", g_values.shape[1], "masked:", int((~rep_mask[0].bool()).sum()))

# 5. Crafted ngrams: 3 fixed contexts x several candidates.
crafted = []
for ctx in [[11, 22, 33, 44], [5, 5, 5, 5], [4095, 0, 17, 4999]]:
    for tok in [1, 2, 100, 4096, 12345, 999999]:
        crafted.append(ctx + [tok])
crafted_tensor = torch.tensor(crafted, dtype=torch.long).unsqueeze(0)  # [1, N, 5]
ngram_keys = proc.compute_ngram_keys(crafted_tensor)  # [1, N, depth]
crafted_g = proc.get_gvals(ngram_keys)  # [1, N, depth]
out["crafted_ngrams"] = crafted
out["crafted_g_values"] = crafted_g[0].tolist()

# Also dump the raw ngram keys (int64) for the first 4 crafted ngrams so the
# hashing itself can be checked, not just the bit extraction.
out["crafted_ngram_keys_head"] = [[str(int(x)) for x in row] for row in ngram_keys[0][:4].tolist()]

# 6. update_scores on fixed scores.
torch.manual_seed(7)
scores = torch.randn(1, 12) * 2  # [1, 12]
# g-values for these 12 "candidates" given one fixed context:
ctx = [71, 72, 73, 74]
ngrams12 = torch.tensor([ctx + [i * 137 % 3000 + 1] for i in range(12)],
                        dtype=torch.long).unsqueeze(0)
g12 = proc.get_gvals(proc.compute_ngram_keys(ngrams12))  # [1, 12, depth]
updated = logits_processing.update_scores(scores, g12)
out["update_scores"] = {
    "scores": scores[0].tolist(),
    "g_values": g12[0].tolist(),
    "updated_log_probs": updated[0].tolist(),
}

with open(".test/xval-vectors.json", "w") as f:
    json.dump(out, f)
print("wrote .test/xval-vectors.json")
