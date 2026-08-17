// Per-scenario verdict statistics over many seeds — the empirical check that
// each example showcases what its copy claims:
//   prose / translation  -> reliably flagged (likely/strong)
//   facts / code         -> sparse, never strong
//   quote / proofread    -> long enough for a verdict, yet overwhelmingly none
// Usage: node .test/scenario_stats.mjs [seeds]
import { generateTrace, detectTokenIds, makeRng, SCENARIOS } from "./entry.ts";

const KEY = "***";
const SEEDS = Number(process.argv[2] ?? 200);

for (const sc of SCENARIOS) {
  const counts = { strong: 0, likely: 0, inconclusive: 0, none: 0 };
  let zSum = 0, nSum = 0, maskedSum = 0;
  for (let t = 0; t < SEEDS; t++) {
    const tr = generateTrace(sc.specs, { watermark: true, key: KEY, rng: makeRng(300000 + t * 97 + sc.id.length) });
    const d = detectTokenIds(tr.tokenIds, KEY);
    counts[d.verdict]++;
    zSum += d.z;
    nSum += d.n;
    maskedSum += d.masked;
  }
  let plainZ = 0;
  for (let t = 0; t < SEEDS; t++) {
    const tr = generateTrace(sc.specs, { watermark: false, key: KEY, rng: makeRng(300000 + t * 97 + sc.id.length) });
    plainZ += detectTokenIds(tr.tokenIds, KEY).z;
  }
  const rates = Object.entries(counts).map(([k, v]) => `${k}=${((v / SEEDS) * 100).toFixed(0)}%`).join(" ");
  console.log(
    sc.id.padEnd(12),
    `steps=${String(sc.specs.length).padStart(3)}`,
    `avg n=${(nSum / SEEDS).toFixed(1)}`.padEnd(11),
    `masked=${(maskedSum / SEEDS).toFixed(1)}`.padEnd(11),
    `wm z̄=${(zSum / SEEDS).toFixed(2)}`.padEnd(11),
    `plain z̄=${(plainZ / SEEDS).toFixed(2)}`.padEnd(12),
    rates
  );
}
