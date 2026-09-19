import { appendFileSync } from "node:fs";
appendFileSync(process.env.FM_PROBE_OUT || "/tmp/fm-probe-out.txt",
  JSON.stringify({
    event: process.argv[2] || "(none)",
    argv_literal: process.argv[3] ?? "(no argv)",
    env_CLAUDE_SKILL_DIR: process.env.CLAUDE_SKILL_DIR ?? "(unset)",
    env_CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT ?? "(unset)",
    env_CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR ?? "(unset)",
  }) + "\n");
process.exit(0);
