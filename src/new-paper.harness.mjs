/**
 * Both halves for `new-paper.ts` — the module behind `paperlint new` and `paperlint init --paper`.
 *
 * What is checked, and why each one matters:
 *   - the scaffold is what `paperlint lint` ACCEPTS: the old first run opened with "missing
 *     PIPELINE-STATUS.md", and a scaffold that still produced a finding would move that error
 *     from a missing file into a created one;
 *   - the scorecard carries `researchQuestion` and NO `stages` — a new paper has shipped nothing,
 *     and a placeholder stage would be a red `paper/stages` on the very first run;
 *   - the scorecard PARSES as a scorecard (`pipeline-check.mjs` finds its four sections). The
 *     template used to live in a code fence; moved into a file, it must still be the format the
 *     skills' checker reads;
 *   - it never overwrites, and on an existing folder adds only what is missing;
 *   - the project's `<papers>/.template/` wins over the package, file by file.
 *
 * ⚠️ Assertions at the TOP LEVEL: `vigiles test` imports the file and counts "did not throw"
 * as a pass.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { frontmatterBlock } from "../lib/markdown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const {
  newPaper,
  nameProblem,
  wantedFiles,
  PACKAGE_TEMPLATES,
  OVERRIDE_DIR,
  STATUS_FILE,
  SOURCE_FILE,
} = await import(join(HERE, "new-paper.ts"));
const { run } = await import(join(HERE, "cli.ts"));

let n = 0;
const check = (label, cond) => {
  n++;
  assert.ok(cond, label);
};

const work = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-new-")));
const read = (...p) => readFileSync(join(...p), "utf8");
const front = (text) => load(frontmatterBlock(text) ?? "") ?? {};

/** `paperlint lint <dir>` in-process, output captured. */
async function lint(dir) {
  const out = [];
  const code = await run(["lint", dir], {
    log: (...a) => out.push(a.join(" ")),
    err: (...a) => out.push(a.join(" ")),
    cwd: work,
  });
  return { code, text: out.join("\n") };
}

try {
  // ── the templates are FILES in the package, one per required file ──────────────────────
  for (const f of [STATUS_FILE, SOURCE_FILE.tex, SOURCE_FILE.md])
    check(
      `the package ships templates/paper/${f}`,
      existsSync(join(PACKAGE_TEMPLATES, f)),
    );
  check(
    "🔴 the templates ship in the npm tarball — `templates` is in package.json `files`",
    JSON.parse(read(ROOT, "package.json")).files.includes("templates"),
  );

  // ── names ───────────────────────────────────────────────────────────────────────────
  for (const ok of ["demo", "aisec-2026", "v1.2_final"])
    check(`\`${ok}\` is a valid name`, nameProblem(ok) === null);
  for (const bad of ["Demo", "my paper", "a/b", "../x", "", "ÿ"])
    check(`\`${bad}\` is refused`, typeof nameProblem(bad) === "string");
  for (const dot of [".template", ".x", ".."])
    check(
      `\`${dot}\` is refused — discovery skips dot-directories, so it would never be linted`,
      /starting with a dot/.test(nameProblem(dot) ?? ""),
    );
  check(
    "a refused name creates nothing",
    newPaper(work, "Bad", "tex").ok === false && !existsSync(join(work, "Bad")),
  );

  // ── a fresh LaTeX paper ─────────────────────────────────────────────────────────────
  const papers = join(work, "papers");
  const r = newPaper(papers, "demo", "tex");
  check(
    "a fresh folder gets the scorecard, a .tex source and paperlint.json, all from the package",
    r.ok &&
      r.fresh &&
      r.files.map((f) => `${f.file}:${f.status}:${f.from}`).join(" ") ===
        "PIPELINE-STATUS.md:created:package paper.tex:created:package paperlint.json:created:package",
  );
  const status = read(papers, "demo", STATUS_FILE);
  const fm = front(status);
  check(
    "🔴 the scorecard has NO `stages` — a new paper has shipped nothing and owes nothing",
    !("stages" in fm),
  );
  check(
    "and carries `researchQuestion`, present and empty",
    "researchQuestion" in fm && fm.researchQuestion === "",
  );
  check(
    "the name is filled in, and no placeholder survives in any file",
    /PIPELINE-STATUS — demo/.test(status) &&
      !status.includes("{{name}}") &&
      !read(papers, "demo", "paper.tex").includes("{{name}}"),
  );
  const l = await lint(join(papers, "demo"));
  check(
    "🔴 `paperlint lint` passes the scaffold — exit 0, not a missing-file error — with the one warning that no venue is chosen yet",
    l.code === 0 &&
      /names no venue preset yet/.test(l.text) &&
      /1 problem \(0 errors, 1 warning\)/.test(l.text),
  );

  // The format contract of the skills' checker: four sections, parsed.
  const pc = spawnSync(
    process.execPath,
    [
      join(ROOT, "skills", "paper-pipeline", "scripts", "pipeline-check.mjs"),
      join(papers, "demo"),
      "--json",
      "--today=2026-09-23",
    ],
    { cwd: work, encoding: "utf8" },
  );
  let parsed = null;
  try {
    parsed = JSON.parse(pc.stdout);
  } catch {
    parsed = null;
  }
  check(
    "the scorecard PARSES for pipeline-check — its four sections are found (it prints JSON, not the format warning)",
    Array.isArray(parsed) && !/expected the four sections/.test(pc.stderr),
  );

  // ── never overwrite; on an existing folder only the missing files ─────────────────────
  writeFileSync(join(papers, "demo", STATUS_FILE), "mine\n");
  const again = newPaper(papers, "demo", "md");
  check(
    "🔴 a second run overwrites nothing and adds no second source",
    again.ok &&
      !again.fresh &&
      read(papers, "demo", STATUS_FILE) === "mine\n" &&
      !existsSync(join(papers, "demo", "paper.md")) &&
      again.files.every((f) => f.status === "kept"),
  );
  mkdirSync(join(papers, "old"), { recursive: true });
  writeFileSync(join(papers, "old", "paper.md"), "# Old\n");
  const migrated = newPaper(papers, "old", "tex");
  check(
    "an old folder with only paper.md gets ONLY the scorecard — that is the migration",
    migrated.ok &&
      existsSync(join(papers, "old", STATUS_FILE)) &&
      !existsSync(join(papers, "old", "paper.tex")) &&
      read(papers, "old", "paper.md") === "# Old\n",
  );
  check(
    "wantedFiles asks for a source only when neither format is there",
    wantedFiles(join(papers, "old"), "tex").join() ===
      `${STATUS_FILE},paperlint.json` &&
      wantedFiles(join(papers, "nowhere"), "md").join() ===
        `${STATUS_FILE},paper.md,paperlint.json`,
  );
  writeFileSync(join(papers, "afile"), "x");
  check(
    "a name taken by a FILE is refused, not written through",
    newPaper(papers, "afile", "tex").ok === false,
  );

  // ── the project's template wins, file by file ─────────────────────────────────────────
  mkdirSync(join(papers, OVERRIDE_DIR), { recursive: true });
  writeFileSync(
    join(papers, OVERRIDE_DIR, STATUS_FILE),
    "---\n---\n# House scorecard for {{name}}\n",
  );
  const own = newPaper(papers, "house", "md");
  // Guards: the override slot — `fromTemplate` in new-paper.ts reads `<papers>/.template/<file>`
  // before the package's copy. Replace that lookup with the package's alone and this goes red.
  check(
    "🔴 <papers>/.template/ is preferred for the file it holds, the package fills the rest",
    own.ok &&
      read(papers, "house", STATUS_FILE) ===
        "---\n---\n# House scorecard for house\n" &&
      own.files.find((f) => f.file === STATUS_FILE)?.from === "project" &&
      own.files.find((f) => f.file === "paper.md")?.from === "package",
  );

  // ── a missing template is a broken install, not an empty file ─────────────────────────
  const broken = newPaper(join(work, "b"), "x", "tex", {
    packageTemplates: join(work, "no-such-dir"),
  });
  check(
    "a missing package template refuses and leaves no half-made folder",
    broken.ok === false &&
      /no template for/.test(broken.reason) &&
      !existsSync(join(work, "b", "x")),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(
  `✓ ${String(n)} assertions passed — paperlint new scaffolds what paperlint lint accepts`,
);
