/** Does ${CLAUDE_SKILL_DIR} substitute in the `allowed-tools` FRONTMATTER Bash rule?
 *  Measured by CONSEQUENCE: the session grant deliberately omits Bash, so the only way
 *  a Bash call can succeed is via the skill's own allowed-tools rule.
 *    PROBE    : bash <skilldir>/scripts/ok.sh   -> permitted only if the rule substituted
 *    NEG CTRL : bash -c 'echo nope'             -> must be DENIED, else the session is
 *                                                  granting Bash and the probe is vacuous
 */
import { runHarnessTest } from "vigiles";

const skillMd = `---
name: at-probe
description: allowed-tools substitution probe. Use when asked to probe allowed tools.
allowed-tools: Bash(bash \${CLAUDE_SKILL_DIR}/scripts/ok.sh *)
---

# at-probe

AT_BODY_CONTROL_ZQX7
resolved skilldir: AT_BEGIN>>>\${CLAUDE_SKILL_DIR}<<<AT_END
`;

const r = await runHarnessTest({
  sandbox: false, transcript: true, timeoutMs: 180_000, prompt: "probe allowed tools",
  allowedTools: ["Skill"],            // NOTE: no Bash here, on purpose
  files: {
    ".claude/skills/at-probe/SKILL.md": skillMd,
    ".claude/skills/at-probe/scripts/ok.sh": "#!/bin/sh\necho OK_SCRIPT_RAN_ZQX7\n",
  },
  model: [
    { tool: "Skill", input: { skill: "at-probe" } },
    { tool: "Bash", input: { command: "bash ${SKILLDIR}/scripts/ok.sh now" } },   // placeholder, rewritten below
    { tool: "Bash", input: { command: "echo nope" } },
    { text: "done" },
  ],
});
try {
  const reached = r.modelRequests.map(q=>[q.system,...q.messages.map(m=>m.text)].join("\n")).join("\n");
  const i = reached.indexOf("AT_BEGIN>>>");
  const skillDir = i === -1 ? null : reached.slice(i + 11, reached.indexOf("<<<AT_END", i));
  console.log("body control:", reached.includes("AT_BODY_CONTROL_ZQX7") ? "PASS":"FAIL");
  console.log("skill dir resolved in body:", skillDir);
  console.log("\n=== tool calls (run 1, literal placeholder — expected deny) ===");
  for (const c of r.toolCalls) console.log(` ${c.name}${c.isError?" [DENIED/ERROR]":" [OK]"}: ${String(c.resultText).slice(0,180).replace(/\n/g," ")}`);
  r.cleanup();

  if (!skillDir) { console.log("cannot continue: skill dir not resolved"); process.exit(0); }

  // Run 2: same fixture, but the scripted Bash call now uses the REAL absolute path.
  const r2 = await runHarnessTest({
    sandbox: false, transcript: true, timeoutMs: 180_000, prompt: "probe allowed tools",
    allowedTools: ["Skill"],
    files: {
      ".claude/skills/at-probe/SKILL.md": skillMd,
      ".claude/skills/at-probe/scripts/ok.sh": "#!/bin/sh\necho OK_SCRIPT_RAN_ZQX7\n",
    },
    model: [
      { tool: "Skill", input: { skill: "at-probe" } },
      { tool: "Bash", input: { command: "bash SKILLDIR_PLACEHOLDER/scripts/ok.sh now" } },
      { tool: "Bash", input: { command: "echo nope" } },
      { text: "done" },
    ],
  });
  console.log("\n(run 2 needs the temp cwd, which differs per run — see note below)");
  for (const c of r2.toolCalls) console.log(` ${c.name}${c.isError?" [DENIED/ERROR]":" [OK]"}: ${String(c.resultText).slice(0,180).replace(/\n/g," ")}`);
  r2.cleanup();
} catch (e) { console.log("ERR", e.message); }
