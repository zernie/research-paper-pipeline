/** CLAIM 1 caveat probe: is ${CLAUDE_SKILL_DIR} substituted in SKILL.md FRONTMATTER?
 *  Two surfaces tested in one run:
 *    (a) frontmatter `hooks:` command   (the claimed non-substituting surface)
 *    (b) frontmatter `allowed-tools:`   (where rpp ALSO keeps literal paths)
 *  Disambiguation: the marker is SINGLE-QUOTED in the command, so the shell cannot
 *  expand it. Anything other than the literal string must have come from Claude Code.
 *  POSITIVE CONTROL: a literal sentinel in the same command — if the hook never fires,
 *  we learn "hook did not run", not "substitution did not happen".
 */
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { runHarnessTest } from "vigiles";

const OUT = new URL("./fm-hook-out.txt", import.meta.url).pathname;
const HOOKPROBE = new URL("../fmprobe/hookprobe.mjs", import.meta.url).pathname;
rmSync(OUT, { force: true });
process.env.FM_PROBE_OUT = OUT;

const skillMd = `---
name: fmhook-probe
description: Probe for frontmatter substitution. Use when asked to probe frontmatter.
allowed-tools: [Read, Skill, "Bash(node \${CLAUDE_SKILL_DIR}/scripts/thing.mjs:*)"]
hooks:
  PostToolUse:
    - matcher: Read
      hooks:
        - type: command
          command: 'FM_PROBE_OUT=${OUT} node ${HOOKPROBE} SENTINEL_HOOK_FIRED_ZQX7 "\${CLAUDE_SKILL_DIR}"'
---

# fmhook-probe

BODY_CONTROL_ZQX7

body skilldir: BODY_BEGIN>>>\${CLAUDE_SKILL_DIR}<<<BODY_END
`;

const r = await runHarnessTest({
  sandbox: false,
  transcript: true,
  timeoutMs: 180_000,
  prompt: "probe the frontmatter",
  allowedTools: ["Read", "Skill"],
  files: {
    ".claude/skills/fmhook-probe/SKILL.md": skillMd,
    ".claude/skills/fmhook-probe/scripts/thing.mjs": "console.log('x');\n",
    "control.txt": "CONTROL_FILE_CONTENTS_QQ9\n",
  },
  model: [
    { tool: "Skill", input: { skill: "fmhook-probe" } },
    { tool: "Read", input: { file_path: "control.txt" } },
    { text: "done" },
  ],
});

try {
  console.log("=== TOOL CALLS ===");
  console.log(r.toolCalls.map((c) => `${c.name}${c.isError ? " [ERROR]" : ""}: ${String(c.resultText).slice(0,200)}`).join("\n") || "(none)");
  console.log("\n=== HOOK FIRES SEEN BY THE CLI ===");
  console.log(JSON.stringify(r.hooks, null, 1).slice(0, 1200));

  const reached = r.modelRequests.map((q) => [q.system, ...q.messages.map((m) => m.text)].join("\n")).join("\n");
  const i = reached.indexOf("BODY_BEGIN>>>");
  console.log("\n=== BODY control (same file, proves the skill loaded) ===");
  console.log("body marker present:", reached.includes("BODY_CONTROL_ZQX7") ? "PASS" : "FAIL");
  if (i !== -1) console.log("body substitution:", JSON.stringify(reached.slice(i + 13, reached.indexOf("<<<BODY_END", i))));

  console.log("\n=== FRONTMATTER hooks: OUTPUT FILE ===");
  if (!existsSync(OUT)) {
    console.log("POSITIVE CONTROL FAILED: the hook never wrote anything ->");
    console.log("  the frontmatter `hooks:` key did not fire at all in this CLI version.");
    console.log("  This is 'hook did not run', NOT 'substitution did not happen'.");
  } else {
    console.log(readFileSync(OUT, "utf8").trim());
  }
  console.log("\ncwd:", r.cwd, "| exit:", r.exitCode);
} finally { r.cleanup(); }
