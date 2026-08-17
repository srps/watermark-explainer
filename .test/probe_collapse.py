"""Does the REFERENCE update_scores also collapse a small near-uniform
candidate set to one-hot after 30 layers? Feed it the exact distribution
from my miniature's 'cold and ?' step with realistic random g-values."""
import sys
import types

import torch

fake_transformers = types.ModuleType("transformers")
fake_transformers.LogitsProcessor = type("LogitsProcessor", (), {})
sys.modules["transformers"] = fake_transformers

from synthid_text import logits_processing  # noqa: E402

DEPTH = 30
torch.manual_seed(3)

# The exact base distribution from the miniature's step 6.
base_p = torch.tensor([0.306, 0.278, 0.167, 0.111, 0.139])
scores = torch.log(base_p).unsqueeze(0)  # [1, 5]

print("=== reference update_scores on the miniature's 5-candidate step ===")
# Try 5 random g-value assignments (as if different contexts).
for trial in range(5):
    g = torch.randint(0, 2, (1, 5, DEPTH))
    lp = logits_processing.update_scores(scores, g)
    p = torch.softmax(lp, dim=1)[0]
    gmean = g[0].float().mean(dim=1)
    print(f"trial {trial}: p'={[f'{x:.4f}' for x in p.tolist()]}  "
          f"max={p.max().item():.4f}  gmean={[f'{x:.2f}' for x in gmean.tolist()]}")

print()
print("=== with MORE candidates (top_k=40, realistic) ===")
scores40 = torch.randn(1, 40)
for trial in range(3):
    g = torch.randint(0, 2, (1, 40, DEPTH))
    lp = logits_processing.update_scores(scores40, g)
    p = torch.softmax(lp, dim=1)[0]
    print(f"trial {trial}: max p'={p.max().item():.4f}  "
          f"top3={[f'{x:.3f}' for x in p.topk(3).values.tolist()]}")
