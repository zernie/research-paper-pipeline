/** CLAIM 1 probe, PLUGIN channel: is ${CLAUDE_SKILL_DIR} substituted in a
 *  plugin-provided SKILL.md body? Installed natively via `claude --plugin-dir`. */
import { writeFileSync } from "node:fs";
import { runHarnessTest } from "vigiles";

const BODY_CONTROL = "POSITIVE_CONTROL_ZQX7_BODY_REACHED_MODEL";
const PLUGIN = new URL("../fakeplugin/", import.meta.url).pathname;

const r = await runHarnessTest({
  pluginDir: PLUGIN,
  sandbox: false,
  transcript: true,
  timeoutMs: 180_000,
  prompt: "probe the plugin skill dir",
  allowedTools: ["Read", "Skill"],
  files: { "control.txt": "CONTROL_FILE_CONTENTS_QQ9\n" },
  model: [
    { tool: "Skill", input: { skill: "pluginskill-probe" } },
    { tool: "Read", input: { file_path: "control.txt" } },
    { text: "done" },
  ],
});

try {
  console.log("=== TOOL CALLS ===");
  console.log(r.toolCalls.map((c) => `${c.name}${c.isError ? " [ERROR]" : ""}: ${String(c.resultText).slice(0, 300)}`).join("\n") || "(none)");

  const reached = r.modelRequests.map((q) => [q.system, ...q.messages.map((m) => m.text)].join("\n")).join("\n");
  writeFileSync(new URL("./claim1-plugin-reached.txt", import.meta.url), reached);

  const skillCall = r.toolCalls.find((c) => c.name === "Skill");
  const readCall = r.toolCalls.find((c) => c.name === "Read");
  console.log("\n=== POSITIVE CONTROLS ===");
  console.log("C1 Skill call resolved:", skillCall && !skillCall.isError ? "PASS" : `FAIL (${skillCall ? skillCall.resultText.slice(0,250) : "no Skill call"})`);
  console.log("C2 body marker reached model:", reached.includes(BODY_CONTROL) ? "PASS" : "FAIL");
  console.log("C3 Read control succeeded:", readCall && !readCall.isError ? "PASS" : "FAIL");

  console.log("\n=== SUBSTITUTION VERDICT (plugin channel) ===");
  for (const [label, open, close] of [
    ["CLAUDE_SKILL_DIR", "SKILLDIR_BEGIN>>>", "<<<SKILLDIR_END"],
    ["CLAUDE_PLUGIN_ROOT", "PLUGINROOT_BEGIN>>>", "<<<PLUGINROOT_END"],
    ["CLAUDE_PROJECT_DIR", "PROJDIR_BEGIN>>>", "<<<PROJDIR_END"],
  ]) {
    const i = reached.indexOf(open);
    if (i === -1) { console.log(`${label}: marker ABSENT`); continue; }
    const between = reached.slice(i + open.length, reached.indexOf(close, i));
    console.log(`${label}: ${JSON.stringify(between)}  -> ${between.includes("${") ? "LITERAL (no substitution)" : "SUBSTITUTED"}`);
  }
  console.log("\ncwd was:", r.cwd, "| plugin was:", PLUGIN, "| turns:", r.turns, "| exit:", r.exitCode);
} finally {
  r.cleanup();
}
