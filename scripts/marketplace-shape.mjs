/**
 * MARKETPLACE SHAPE GATE: the manifest is judged by the HOST'S OWN VALIDATOR, not by a schema
 * we wrote from reading the docs.
 *
 * 🔴 WHY A GATE AND NOT A NOTE. Measured 2026-09-19: the shape a design note had recorded for an
 * npm-sourced plugin —
 *
 *     { "name": "…", "source": "npm", "package": "…", "version": "^0.1.0" }
 *
 * is REJECTED, with `plugins[0].source: Bare source name "npm" requires metadata.pluginRoot`.
 * The accepted spelling nests: `source` is an OBJECT whose own `source` key names the type. Since
 * the wrong shape exits nonzero, this is a defect a gate can make unshippable rather than a thing
 * to remember. Fixtures for both, plus a negative control, are in docs/prior-art/repro/.
 *
 * 🔴 AND THE ABSENCE OF THE VALIDATOR IS A FAILURE, NOT A SKIP. A gate that quietly passes when
 * its tool is missing is the false green this repository keeps re-measuring: in CI the binary is
 * installed, so "not found" there means the install step broke, which is exactly what we want to
 * hear about. Locally, run it after `npm i -g @anthropic-ai/claude-code`.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const probe = spawnSync("claude", ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error(
    "the claude binary does not launch, so the manifest was NOT validated.\n" +
      "  install: npm i -g @anthropic-ai/claude-code",
  );
  process.exit(1);
}

const r = spawnSync("claude", ["plugin", "validate", ROOT, "--strict"], {
  encoding: "utf8",
});
const out = (r.stdout ?? "") + (r.stderr ?? "");
process.stdout.write(out);
if (r.status !== 0) {
  console.error(`\n✗ marketplace manifest rejected by claude ${probe.stdout.trim()}`);
  process.exit(1);
}
console.log(`✓ marketplace manifest accepted by claude ${probe.stdout.trim()} (--strict)`);
