"""Ground-truth behavioural probes of the REFERENCE update_scores.

Answers two questions my TS harness needs:
  Q1. Is the iterated probability recurrence distortionary on PEAKED sets?
      Measure E[p'_dominant] for p=[0.9, 0.05, 0.05] with random g-values.
  Q2. What is the expected sampled mean g-value after the recurrence on
      UNIFORM sets of size V=4,8,16,32? (Compare to Corollary 27's closed
      form 0.5 + 0.25(1-1/V) — and to my TypeScript measurements.)

These use the reference implementation directly, so whatever it says IS the
correct behaviour of the algorithm.
"""
import json
import sys
import types

import torch

fake_transformers = types.ModuleType("transformers")
fake_transformers.LogitsProcessor = type("LogitsProcessor", (), {})
sys.modules["transformers"] = fake_transformers

from synthid_text import logits_processing  # noqa: E402

DEPTH = 30
torch.manual_seed(0)

out = {}

# Q1: peaked distribution distortion
TRIALS = 200000
p = torch.tensor([[0.9, 0.05, 0.05]])
scores = torch.log(p)  # update_scores softmaxes internally
acc = torch.zeros(3)
for _ in range(TRIALS):
    g = torch.randint(0, 2, (1, 3, DEPTH))
    lp = logits_processing.update_scores(scores, g)
    acc += torch.softmax(lp, dim=1)[0]
expected_p = (acc / TRIALS).tolist()
out["peaked_expected_p"] = expected_p
print("Q1 peaked [0.9,0.05,0.05] -> expected p':",
      [f"{x:.5f}" for x in expected_p])

# Q2: uniform sets, expected mean g of a sample from the updated dist
for V in [4, 8, 16, 32]:
    scores_u = torch.zeros((1, V))
    acc_g = 0.0
    for _ in range(20000):
        g = torch.randint(0, 2, (1, V, DEPTH))
        lp = logits_processing.update_scores(scores_u, g)
        probs = torch.softmax(lp, dim=1)[0]
        gmean = g[0].float().mean(dim=1)  # per-candidate mean g over layers
        acc_g += float((probs * gmean).sum())
    mean_g = acc_g / 20000
    out[f"uniform_V{V}_mean_g"] = mean_g
    closed = 0.5 + 0.25 * (1 - 1 / V)
    print(f"Q2 uniform V={V:2d}: ref-expected sampled mean g = {mean_g:.4f}  "
          f"(Corollary 27 closed form = {closed:.4f})")

with open(".test/xval-behaviour.json", "w") as f:
    json.dump(out, f)
print("wrote .test/xval-behaviour.json")
