// Runs the accuracy harness and — when the cross-validation vectors exist —
// the bit-exact comparison against DeepMind's reference implementation.
// Node runs the TypeScript in shared/ directly (native type stripping), so
// there is no bundling step.
// Usage: npm test  (or: node .test/run.mjs)
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname.replace(/^\//, "");

// Bit-exact cross-validation against the DeepMind reference, if the vectors
// were generated (bash .test/run_xval.sh — needs the Python torch env).
if (existsSync(join(here, "xval-vectors.json"))) {
  console.log("--- cross-validation vs google-deepmind/synthid-text ---");
  execSync(`node "${join(here, "xval_check.mjs")}"`, { stdio: "inherit" });
} else {
  console.log("(no .test/xval-vectors.json — skipping reference cross-validation; run bash .test/run_xval.sh to generate)");
}

console.log("\n--- accuracy harness ---");
execSync(`node "${join(here, "harness.mjs")}"`, { stdio: "inherit" });
