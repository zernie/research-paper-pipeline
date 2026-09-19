/**
 * CLAIM 1 probe — is ${CLAUDE_SKILL_DIR} substituted in a SKILL.md BODY,
 * for a PROJECT-level skill (.claude/skills/), regardless of cwd?
 *
 * Positive controls, so a silent empty result cannot be read as a finding:
 *   C1 the Skill tool call must resolve (not isError)
 *   C2 a literal marker from the BODY must appear in what reached the model
 *   C3 a granted tool (Read) must succeed
 * Only after all three pass is the substitution verdict meaningful.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runHarnessTest } from "vigiles";

const BODY_CONTROL = "POSITIVE_CONTROL_ZQX7_BODY_REACHED_MODEL";
const OPEN = "SKILLDIR_BEGIN>>>";
const CLOSE = "<<<SKILLDIR_END";

const skillMd = `---
name: skilldir-probe
description: Probe that reports the literal text at the CLAUDE_SKILL_DIR spot. Use when asked to probe the skill dir.
---

# skilldir-probe

${BODY_CONTROL}

The sibling script lives at ${OPEN}\${CLAUDE_SKILL_DIR}${CLOSE}/scripts/thing.mjs

Also bare: BARE_BEGIN>>>\${CLAUDE_SKILL_DIR}<<<BARE_END
`;

const r = await runHarnessTest({
  sandbox: false,
  transcript: true,
  timeoutMs: 180_000,
  prompt: "probe the skill dir",
  allowedTools: ["Read", "Skill", "Bash"],
  files: {
    ".claude/skills/skilldir-probe/SKILL.md": skillMd,
    ".claude/skills/skilldir-probe/scripts/thing.mjs": "console.log('sibling');\n",
    "control.txt": "CONTROL_FILE_CONTENTS_QQ9\n",
  },
  model: [
    { tool: "Skill", input: { skill: "skilldir-probe" } },
    { tool: "Read", input: { file_path: "control.txt" } },
    { text: "done" },
  ],
});

try {
  const calls = r.toolCalls.map((c) => `${c.name}${c.isError ? " [ERROR]" : ""}: ${String(c.resultText).slice(0, 300)}`);
  console.log("=== TOOL CALLS ===");
  console.log(calls.join("\n") || "(none)");

  const reached = r.modelRequests
    .map((q) => [q.system, ...q.messages.map((m) => m.text)].join("\n"))
    .join("\n");
  writeFileSync(new URL("./claim1-reached.txt", import.meta.url), reached);

  const skillCall = r.toolCalls.find((c) => c.name === "Skill");
  const readCall = r.toolCalls.find((c) => c.name === "Read");

  console.log("\n=== POSITIVE CONTROLS ===");
  console.log("C1 Skill call resolved:", skillCall && !skillCall.isError ? "PASS" : `FAIL (${skillCall ? skillCall.resultText.slice(0,200) : "no Skill call"})`);
  console.log("C2 body marker reached model:", reached.includes(BODY_CONTROL) ? "PASS" : "FAIL");
  console.log("C3 Read control succeeded:", readCall && !readCall.isError ? "PASS" : "FAIL");

  console.log("\n=== SUBSTITUTION VERDICT ===");
  for (const [label, open, close] of [["sentence form", OPEN, CLOSE], ["bare form", "BARE_BEGIN>>>", "<<<BARE_END"]]) {
    const i = reached.indexOf(open);
    if (i === -1) { console.log(`${label}: marker ABSENT from model requests`); continue; }
    const j = reached.indexOf(close, i);
    const between = reached.slice(i + open.length, j);
    console.log(`${label}: between markers = ${JSON.stringify(between)}`);
    console.log(`${label}: -> ${between.includes("${CLAUDE_SKILL_DIR}") ? "LITERAL (no substitution)" : "SUBSTITUTED"}`);
  }
  console.log("\ncwd was:", r.cwd, "| turns:", r.turns, "| exit:", r.exitCode);
  console.log("full reached-text saved next to this script as claim1-reached.txt");
} finally {
  r.cleanup();
}
