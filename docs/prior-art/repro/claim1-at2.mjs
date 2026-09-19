/** allowed-tools substitution, measured by CONSEQUENCE, with a SAME-SHAPE negative control.
 *  Skill lives at a FIXED path (plugin dir), so the exact absolute command is knowable.
 *    PROBE    : bash <skilldir>/scripts/ok.sh      -> allowed iff the rule substituted
 *    NEG CTRL : bash <decoydir>/scripts/ok.sh      -> identical shape, different dir; must DENY
 *  If the neg control is ALLOWED, Bash is broadly granted and the probe means nothing. */
import { runHarnessTest } from "vigiles";
const P = new URL("../atplugin/", import.meta.url).pathname;
const SKILLDIR = P + "skills/at-probe";
const DECOY = new URL("../decoy/", import.meta.url).pathname;

const r = await runHarnessTest({
  pluginDir: P, sandbox: false, transcript: true, timeoutMs: 180_000,
  prompt: "probe allowed tools",
  allowedTools: ["Skill"],   // no blanket Bash
  model: [
    { tool: "Skill", input: { skill: "at-probe" } },
    { tool: "Bash", input: { command: `bash ${SKILLDIR}/scripts/ok.sh` } },
    { tool: "Bash", input: { command: `bash ${DECOY}scripts/ok.sh` } },
    { text: "done" },
  ],
});
try {
  console.log("skill dir (fixed):", SKILLDIR);
  console.log("decoy    (fixed):", DECOY + "scripts/ok.sh");
  console.log("\n=== tool calls ===");
  for (const c of r.toolCalls)
    console.log(` ${c.name}${c.isError ? " [DENIED]" : " [ALLOWED]"}: ${String(c.resultText).slice(0,200).replace(/\n/g," ")}`);
  const bash = r.toolCalls.filter(c=>c.name==="Bash");
  const probe = bash[0], neg = bash[1];
  console.log("\n=== verdict ===");
  if (!neg || !neg.isError) {
    console.log("NEGATIVE CONTROL FAILED: the decoy command was permitted too ->");
    console.log("  Bash is broadly granted in this configuration; this run proves NOTHING about allowed-tools.");
  } else if (probe && !probe.isError && /OK_SCRIPT_RAN_ZQX7/.test(probe.resultText)) {
    console.log("allowed-tools SUBSTITUTION CONFIRMED: the ${CLAUDE_SKILL_DIR} rule permitted the");
    console.log("  skill-dir command while an identically shaped decoy was denied.");
  } else {
    console.log("allowed-tools rule did NOT permit the skill-dir command (probe denied too).");
  }
} finally { r.cleanup(); }
