import { generateTrace } from "./entry.ts";
import { SCENARIOS } from "./entry.ts";
import { makeRng } from "./entry.ts";

const KEY = "demo-key-001";
const prose = SCENARIOS.find((s) => s.id === "prose");
const weather = prose.specs.slice(0, 7);
const trace = generateTrace(weather, { watermark: true, key: KEY, rng: makeRng(11) });
const step = trace.steps[6]; // "…cold and ?"
console.log("seed 11, step 6:");
for (const c of step.candidates) {
  console.log(JSON.stringify({
    t: c.text.trim(),
    base: +c.baseProb.toFixed(3),
    sampled: +c.sampledProb.toFixed(4),
    g: c.gValues.reduce((a, g) => a + g, 0)
  }) + ",");
}
console.log("chosen:", JSON.stringify(step.chosenToken), "mean g chosen:", (step.gOfChosen.reduce((a, g) => a + g, 0) / 30).toFixed(2));
