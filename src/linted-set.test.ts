/**
 * THE LINTED SET IS EXACTLY THE OWNED FILES — checked on the whole result, not one route in.
 *
 * Each test in `paper-files.test.ts` closes one way a stray file got into `paperlint lint`: vendored
 * JavaScript under a paper (#99), a rule source that reached the siblings index (#101). This one
 * does not care about the route. A paper with every kind of neighbour a real one has, settings from
 * every level that generates blocks (a venue preset with `rules`, the root `rules`), and one
 * assertion: the files ESLint returned are exactly the four paperlint owns — set equality, so a
 * route nobody has thought of yet shows up as an extra member.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./cli.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TEX = "\\documentclass{article}\n\\begin{document}x\\end{document}\n";
const JS = "export const x = 1;\n";

/** The files paperlint owns in the fixture paper. */
const OWNED = [
  "papers/a/paper.tex",
  "papers/a/PIPELINE-STATUS.md",
  "papers/a/reviews/r1.md",
  "papers/a/siblings/smith2025.md",
];

/** Everything else a real paper folder and project carry. None of it may be linted. */
const NEIGHBOURS = {
  "papers/a/siblings/README.md": "# Siblings\n\n- [Smith](smith2025.md)\n",
  "papers/a/README.md": "# Paper a\n",
  "papers/a/notes/idea.md": "# An idea\n",
  "papers/a/repro/x.js": "return 1;\n",
  "papers/a/repro/lib/y.mjs": JS,
  "papers/a/repro/z.cjs": "module.exports = 1;\n",
  "papers/a/repro/t.ts": "const t: number = 1;\n",
  "script.js": JS,
  "node_modules/pkg/index.js": JS,
};

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-set-")));
  dirs.push(root);
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "c", private: true }),
    // A root `rules` block over every file of the project: the widest glob a consumer can write.
    "paperlint.json": JSON.stringify({
      rules: [
        {
          files: ["**/*.md", "**/*.tex", "**/*.js"],
          rules: {
            "pdf/last-page-balance": "warn",
            "paper/section-word": "warn",
          },
        },
      ],
    }),
    // A venue preset that carries `rules` of its own.
    "papers/a/paperlint.json": JSON.stringify({
      extends: "paperlint:agenticdev",
    }),
    "papers/a/paper.tex": TEX,
    "papers/a/PIPELINE-STATUS.md": "---\nstages: []\n---\n",
    "papers/a/reviews/r1.md": "# review\n",
    "papers/a/siblings/smith2025.md": "---\nread: full\n---\n# Smith 2025\n",
    ...NEIGHBOURS,
  };
  for (const [p, text] of Object.entries(all)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

/** `paperlint lint --json <args>` → the files it linted, relative to the project, sorted. */
async function lintedSet(root: string, args: string[]): Promise<string[]> {
  const out: string[] = [];
  await run(["lint", "--json", ...args], {
    cwd: root,
    log: (s: string) => out.push(s),
    err: () => {},
  });
  type Result = { filePath: string; messages: { ruleId: string | null }[] };
  return (
    (JSON.parse(out.join("\n")) as Result[])
      // A structure finding reports a MISSING file in the same shape; it was not linted.
      .filter(
        (r) => !r.messages.some((m) => m.ruleId === "structure/required-file"),
      )
      .map((r) => relative(root, r.filePath))
      .sort()
  );
}

describe("🔴 paperlint lint — the linted set is EXACTLY the owned files", () => {
  it.each([
    ["the papers directory from the config", []],
    ["the paper named on the command line", ["papers/a"]],
    // The widest scope: ESLint is handed the project root, so it enumerates `script.js` and
    // `node_modules/` too, and only the scope keeps them out.
    ["the whole project named on the command line", ["."]],
  ])("%s", async (_, args) => {
    // Guards: every route in at once — vendored JS/TS, a root script, node_modules, a README next
    // to the paper, the siblings index, notes. An extra member names the file that got through.
    expect(await lintedSet(project(), args)).toEqual([...OWNED].sort());
  });
});
