import { readFileSync, existsSync } from "node:fs";
import { runHarnessTest } from "vigiles";
const OUT = new URL("./fm-plugin-out.txt", import.meta.url).pathname;
const r = await runHarnessTest({
  pluginDir: new URL("../fakeplugin/", import.meta.url).pathname,
  sandbox: false, transcript: true, timeoutMs: 180_000,
  prompt: "probe plugin frontmatter",
  allowedTools: ["Read", "Skill"],
  files: { "control.txt": "CONTROL_QQ9\n" },
  model: [
    { tool: "Skill", input: { skill: "pluginfm-probe" } },
    { tool: "Read", input: { file_path: "control.txt" } },
    { text: "done" },
  ],
});
try {
  const skillCall = r.toolCalls.find(c=>c.name==="Skill");
  console.log("C1 Skill resolved:", skillCall && !skillCall.isError ? "PASS" : "FAIL " + (skillCall?skillCall.resultText.slice(0,200):"none"));
  const reached = r.modelRequests.map(q=>[q.system,...q.messages.map(m=>m.text)].join("\n")).join("\n");
  console.log("C2 body marker reached:", reached.includes("PLUGIN_FM_BODY_CONTROL") ? "PASS":"FAIL");
  const i = reached.indexOf("BODY_BEGIN>>>");
  if (i!==-1) console.log("body substitution:", JSON.stringify(reached.slice(i+13, reached.indexOf("<<<BODY_END", i))));
  console.log("hooks seen by CLI:", JSON.stringify(r.hooks));
  console.log("\n=== PLUGIN-CHANNEL FRONTMATTER HOOK OUTPUT ===");
  console.log(existsSync(OUT) ? readFileSync(OUT,"utf8").trim() : "POSITIVE CONTROL FAILED: hook never wrote (did not fire)");
  console.log("\ncwd:", r.cwd);
} finally { r.cleanup(); }
