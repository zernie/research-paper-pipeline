/**
 * `paperlint.json` through the commands, on a real directory: `paperlint lint` applies a paper's
 * `rules` to that paper alone and refuses an unknown rule id.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run, toolchainTex } from "./cli.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A project with two papers, `a` and `b`, each with paper.tex and PIPELINE-STATUS.md. */
function project(files: Record<string, string> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-settings-")));
  dirs.push(root);
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "c", private: true }),
    "papers/a/paper.tex":
      "\\documentclass{article}\n\\begin{document}x\\end{document}\n",
    "papers/a/PIPELINE-STATUS.md": "---\nstages: []\n---\n",
    "papers/b/paper.tex":
      "\\documentclass{article}\n\\begin{document}x\\end{document}\n",
    "papers/b/PIPELINE-STATUS.md": "---\nstages: []\n---\n",
    ...files,
  };
  for (const [p, text] of Object.entries(all)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

async function lint(
  root: string,
  args: string[] = [],
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["lint", "--json", ...args], {
    cwd: root,
    log: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const rulesIn = (stdout: string, paper: string): string[] =>
  (JSON.parse(stdout) as { filePath: string; messages: { ruleId: string }[] }[])
    .filter((r) => r.filePath.endsWith(join(paper, "paper.tex")))
    .flatMap((r) => r.messages.map((m) => m.ruleId));

describe("🔴 an optional rule that reaches no paper — judged against the PROJECT, not the run (#103)", () => {
  const THIRD = {
    "papers/c/paper.tex":
      "\\documentclass{article}\n\\begin{document}x\\end{document}\n",
    "papers/c/PIPELINE-STATUS.md": "---\nstages: []\n---\n",
  };
  const rootRules = (files: string[]) => ({
    "paperlint.json": JSON.stringify({
      rules: [{ files, rules: { "pdf/last-page-balance": "error" } }],
    }),
  });

  it("linting paper c alone passes when the block reaches papers a and b", async () => {
    const root = project({
      ...THIRD,
      ...rootRules(["papers/a/**", "papers/b/**"]),
    });
    const r = await lint(root, ["papers/c"]);
    // Guards: the defect — the guard counted only the paper.tex files this run linted.
    expect(r.err).not.toMatch(/no linted paper\.tex gets it/);
    expect(r.code).toBe(0);
    expect(rulesIn(r.out, "c")).not.toContain("pdf/last-page-balance");
  });

  it("…and a glob that reaches no paper of the project still fails, from a subset too", async () => {
    const root = project({ ...THIRD, ...rootRules(["papers/typo/**"]) });
    for (const args of [["papers/c"], []]) {
      const r = await lint(root, args);
      // Guards: the other half — widening the judged set did not turn the guard off.
      expect(r.err).toMatch(
        /pdf\/last-page-balance is turned on in "rules", but no paper\.tex/,
      );
      expect(r.code).toBe(1);
    }
  });
});

describe("paperlint lint — `rules` in a paper's paperlint.json", () => {
  it("turns an optional rule on for that paper alone", async () => {
    const root = project({
      "papers/a/paperlint.json": JSON.stringify({
        rules: { "pdf/last-page-balance": "error" },
      }),
    });
    const r = await lint(root);
    // The rule is on for `a` (no facts file: it says so, loudly) and for `b` it does not exist.
    expect(rulesIn(r.out, "a")).toContain("pdf/last-page-balance");
    expect(rulesIn(r.out, "b")).not.toContain("pdf/last-page-balance");
  });

  it("🔴 the paper's own `rules` come after the root paperlint.json's, so they win", async () => {
    const root = project({
      "paperlint.json": JSON.stringify({
        rules: [
          {
            files: ["papers/*/**"],
            rules: { "pdf/last-page-balance": "error" },
          },
        ],
      }),
      "papers/a/paperlint.json": JSON.stringify({
        rules: { "pdf/last-page-balance": "off" },
      }),
    });
    const r = await lint(root);
    expect(rulesIn(r.out, "a")).not.toContain("pdf/last-page-balance");
    expect(rulesIn(r.out, "b")).toContain("pdf/last-page-balance");
  });

  it.each([
    [
      "an unknown rule id",
      { rules: { "pdf/no-such-rule": "error" } },
      /not a rule paperlint ships/,
    ],
    ["an unknown key", { venu: "aisec" }, /unknown key "venu"/],
  ])("refuses %s before linting, naming the file", async (_, settings, why) => {
    const root = project({
      "papers/a/paperlint.json": JSON.stringify(settings),
    });
    const r = await lint(root);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(why);
    expect(r.err).toMatch(/papers\/a\/paperlint\.json/);
  });
});

describe("papersDir — optional, `papers` by default", () => {
  it("no paperlint.json, papers/x/paper.tex: that paper is linted", async () => {
    const r = await lint(project());
    expect(r.code).toBe(0);
    expect(
      (JSON.parse(r.out) as { filePath: string }[]).map((f) =>
        f.filePath.slice(f.filePath.indexOf("papers/")),
      ),
    ).toEqual(
      expect.arrayContaining(["papers/a/paper.tex", "papers/b/paper.tex"]),
    );
  });

  it("🔴 no paperlint.json and no papers/: exit 2 and the one clear sentence", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-empty-")));
    dirs.push(root);
    writeFileSync(join(root, "package.json"), "{}");
    const r = await lint(root);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      'no papers in papers/ — create one with `npx paperlint new <name>`, or set "papersDir" in paperlint.json if your papers live elsewhere',
    );
  });

  it("an explicit papersDir is honored", async () => {
    const root = project({
      "paperlint.json": JSON.stringify({ papersDir: "docs/drafts" }),
      "docs/drafts/c/paper.tex":
        "\\documentclass{article}\n\\begin{document}x\\end{document}\n",
      "docs/drafts/c/PIPELINE-STATUS.md": "---\nstages: []\n---\n",
    });
    const r = await lint(root);
    const linted = (JSON.parse(r.out) as { filePath: string }[]).map((f) =>
      f.filePath.slice(root.length + 1),
    );
    expect(linted).toContain("docs/drafts/c/paper.tex");
    expect(linted.some((f) => f.startsWith("papers/"))).toBe(false);
  });

  it("run from inside a paper, the root file is still found and papersDir is relative to it", async () => {
    const root = project({
      "paperlint.json": JSON.stringify({ papersDir: "papers" }),
      "papers/a/paperlint.json": JSON.stringify({ kind: "short" }),
    });
    const out: string[] = [];
    const code = await run(["lint", "--json"], {
      cwd: join(root, "papers/a"),
      log: (x: string) => out.push(x),
      err: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/papers\/b\/paper\.tex/);
  });
});

describe("paperlint lint — the venue preset's rules", () => {
  it("agenticdev's preset turns pdf/last-page-balance on for its paper alone", async () => {
    const root = project({
      "papers/a/paperlint.json": JSON.stringify({
        extends: "paperlint:agenticdev",
        kind: "short",
      }),
    });
    const cfgOf = await import("./cli.ts").then((m) =>
      m.paperRuleBlocks([join(root, "papers")]),
    );
    expect(cfgOf.ok && cfgOf.value).toEqual({
      preset: [
        {
          // Scoped to the paper by `basePath` alone: which of its files the rule reaches is decided
          // once, by narrowing to paperlint's owned scopes (#101), not by a copy of their globs.
          basePath: join(root, "papers/a"),
          rules: { "pdf/last-page-balance": ["error", { tolerancePt: 120 }] },
        },
      ],
      own: [],
    });
  });

  it("🔴 an unbuilt agenticdev paper: ONE warning (pdf/measured), and no balance error", async () => {
    const root = project({
      "papers/a/paperlint.json": JSON.stringify({
        extends: "paperlint:agenticdev",
        kind: "short",
      }),
    });
    const r = await lint(root);
    expect(r.code).toBe(0);
    expect(rulesIn(r.out, "a")).toEqual(["pdf/measured"]);
  });
});

describe("paperlint lint — the paper over its preset, and the project's own presets", () => {
  it("the paper's own rules win over its preset's", async () => {
    const root = project({
      "papers/a/paperlint.json": JSON.stringify({
        extends: "paperlint:agenticdev",
        rules: { "pdf/last-page-balance": "off" },
      }),
    });
    const blocks = await import("./cli.ts").then((m) =>
      m.paperRuleBlocks([join(root, "papers")]),
    );
    // The preset's block comes first and the paper's own after it: the later block wins.
    expect(blocks.ok && blocks.value.preset[0]?.rules).toEqual({
      "pdf/last-page-balance": ["error", { tolerancePt: 120 }],
    });
    expect(blocks.ok && blocks.value.own[0]?.rules).toEqual({
      "pdf/last-page-balance": "off",
    });
  });

  it("a project's own preset, by relative path: its rules apply, an unknown rule id is refused", async () => {
    const root = project({
      "venues/usenix-sec.jsonc": JSON.stringify({
        extends: "paperlint:acm-sigconf",
        rules: { "pdf/no-such-rule": "error" },
      }),
      "papers/a/paperlint.json": JSON.stringify({
        extends: "../../venues/usenix-sec.jsonc",
      }),
    });
    const r = await lint(root);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usenix-sec\.jsonc.*not a rule paperlint ships/);
  });

  it("a typo in extends is a pdf/profile error listing the shipped presets", async () => {
    const root = project({
      "papers/a/paperlint.json": JSON.stringify({
        extends: "paperlint:agenticdve",
      }),
    });
    const r = await lint(root);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/acm-sigconf, agenticdev, aisec, realm/);
  });
});

describe("paperlint toolchain — installs what the project's own presets need", () => {
  it("the shipped union plus a relative preset's tex packages", () => {
    const root = project({
      "venues/usenix-sec.jsonc": JSON.stringify({
        extends: "paperlint:acm-sigconf",
        tex: { packages: { usenix: ["usenix.sty"] } },
      }),
      "papers/a/paperlint.json": JSON.stringify({
        extends: "../../venues/usenix-sec.jsonc",
      }),
    });
    const tex = toolchainTex(root);
    expect(tex.packages["usenix"]).toEqual(["usenix.sty"]);
    expect("acmart" in tex.packages).toBe(true);
    expect("hyperref" in tex.packages).toBe(true);
  });

  it("without papers of its own: the shipped union alone", () => {
    const tex = toolchainTex(project());
    expect("usenix" in tex.packages).toBe(false);
    expect("acmart" in tex.packages).toBe(true);
  });
});
