/** Cross-channel table: what do SKILL_DIR / PLUGIN_ROOT / PLUGIN_DATA resolve to
 *  in a PROJECT-level skill body, vs in a PLUGIN-provided skill body? */
import { runHarnessTest } from "vigiles";

const VARS = ["CLAUDE_SKILL_DIR", "CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "CLAUDE_PROJECT_DIR"];
const body = (title) => `---
name: ${title}
description: Cross-channel path-variable probe. Use when asked to probe path variables.
---

# ${title}

XCHAN_BODY_CONTROL_ZQX7

${VARS.map((v) => `${v}: X${v}X>>>\${${v}}<<<X${v}X`).join("\n\n")}
`;

function report(label, reached) {
  console.log(`\n=== ${label} ===`);
  console.log("  positive control (body reached model):", reached.includes("XCHAN_BODY_CONTROL_ZQX7") ? "PASS" : "FAIL");
  for (const v of VARS) {
    const o = `X${v}X>>>`, c = `<<<X${v}X`;
    const i = reached.indexOf(o);
    if (i === -1) { console.log(`  ${v.padEnd(20)} marker ABSENT`); continue; }
    const val = reached.slice(i + o.length, reached.indexOf(c, i));
    console.log(`  ${v.padEnd(20)} ${val.includes("${") ? "NOT SUBSTITUTED -> " : "-> "}${JSON.stringify(val)}`);
  }
}
const text = (r) => r.modelRequests.map((q) => [q.system, ...q.messages.map((m) => m.text)].join("\n")).join("\n");

// A — project-level skill (the npm + symlink door)
const a = await runHarnessTest({
  sandbox: false, transcript: true, timeoutMs: 180_000, prompt: "probe",
  allowedTools: ["Skill"],
  files: { ".claude/skills/xchan-project/SKILL.md": body("xchan-project") },
  model: [{ tool: "Skill", input: { skill: "xchan-project" } }, { text: "done" }],
});
try { report("A. PROJECT-level skill (.claude/skills) — the npm+symlink door", text(a)); console.log("  cwd:", a.cwd); } finally { a.cleanup(); }

// B — plugin-provided skill (the plugin door)
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const P = new URL("../xchanplugin/", import.meta.url).pathname;
rmSync(P, { recursive: true, force: true });
mkdirSync(P + ".claude-plugin", { recursive: true });
mkdirSync(P + "skills/xchan-plugin", { recursive: true });
writeFileSync(P + ".claude-plugin/plugin.json", JSON.stringify({ name: "xchan", version: "0.0.1", description: "probe" }));
writeFileSync(P + "skills/xchan-plugin/SKILL.md", body("xchan-plugin"));

const b = await runHarnessTest({
  pluginDir: P, sandbox: false, transcript: true, timeoutMs: 180_000, prompt: "probe",
  allowedTools: ["Skill"],
  model: [{ tool: "Skill", input: { skill: "xchan-plugin" } }, { text: "done" }],
});
try { report("B. PLUGIN-provided skill — the plugin door", text(b)); console.log("  cwd:", b.cwd, "\n  plugin root on disk:", P); } finally { b.cleanup(); }
