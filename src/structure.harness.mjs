/**
 * Both halves for `structure.mjs` — the package's only check whose subject is a file's ABSENCE.
 *
 * 🔴 THE MAIN THING PINNED DOWN HERE IS NOT FIRING, IT'S SILENCE. An error-level check that
 * fails on a correct tree does not get fixed, it gets turned off, and real findings go with it.
 * So every "found" here has a paired "not found on the neighboring directory", and the defaults
 * are separately checked against the shape of the live corpus.
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { checkStructure, formatStructure, asEslintResults, STRUCTURE_DEFAULTS } =
  await import(join(HERE, "structure.ts"));

let n = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  n++;
};

const root = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-struct-")));
const papers = join(root, "papers");
const paper = (name, files) => {
  const dir = join(papers, name);
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), "x");
  }
  return dir;
};

try {
  paper("complete", ["PIPELINE-STATUS.md", "paper.tex", "refs.bib"]);
  paper("complete-md", ["PIPELINE-STATUS.md", "paper.md"]);
  // the marker is present (paper.tex), the scorecard is not — the directory is linted by ZERO
  // rules and reports clean
  paper("no-scorecard", ["paper.tex", "refs.bib"]);
  // the scorecard is present, the source is not
  paper("no-source", ["PIPELINE-STATUS.md"]);
  // not a single marker — this is a sibling in the corpus, not a paper
  paper("research", ["NOTES.md", "plan/ideas.md"]);
  mkdirSync(join(papers, ".hidden"), { recursive: true });
  writeFileSync(join(papers, ".hidden", "paper.tex"), "x");

  const f = checkStructure([papers], undefined, { cwd: root });
  const at = (name) => f.filter((x) => x.file.endsWith(name));

  check(
    "a complete paper directory — NOT A SINGLE finding",
    at("complete").length === 0,
  );
  check(
    "and `paper.md` counts on equal footing with `paper.tex` — the corpus holds both forms",
    at("complete-md").length === 0,
  );
  check(
    "a missing scorecard — a finding",
    at("no-scorecard").length === 1 &&
      /missing `PIPELINE-STATUS\.md`/.test(at("no-scorecard")[0].message),
  );
  check(
    "and the message names the CONSEQUENCE, not a restatement of the condition",
    /are skipped/.test(at("no-scorecard")[0].message) &&
      /stage, source and research-question checks/.test(
        at("no-scorecard")[0].message,
      ),
  );
  check(
    "and the consequence names THIS directory by name",
    /no-scorecard/.test(at("no-scorecard")[0].message),
  );
  check(
    "a directory with no source — a finding, and BOTH accepted forms are listed",
    at("no-source").length === 1 &&
      /`paper\.tex`/.test(at("no-source")[0].message) &&
      /`paper\.md`/.test(at("no-source")[0].message),
  );

  // 🔴 THE PAIRED HALF: detection is GENEROUS. Without this the check would scream about every
  // neighboring directory in the corpus, get turned off, and take the three findings above with it.
  check(
    "a directory WITHOUT a single pipeline marker is left alone entirely",
    at("research").length === 0,
  );
  check("and so are hidden directories", at(".hidden").length === 0);
  check("exactly two findings total — nothing extra turned up", f.length === 2);

  // ── consumer config ────────────────────────────────────────────────────────────────
  check(
    "`ignore` exempts a directory by name",
    checkStructure(
      [papers],
      { ignore: ["no-scorecard", "no-source"] },
      {
        cwd: root,
      },
    ).length === 0,
  );
  check(
    "`structure: false` turns the check off entirely",
    checkStructure([papers], false, { cwd: root }).length === 0,
  );
  check(
    "a requirement ON TOP OF the defaults fires — the config genuinely gets through",
    checkStructure(
      [papers],
      { require: ["PIPELINE-STATUS.md", "refs.bib"] },
      {
        cwd: root,
      },
    ).some(
      (x) => x.file.endsWith("complete-md") && /refs\.bib/.test(x.message),
    ),
  );
  check(
    "a nonexistent root does not crash it — that's the empty-set guard talking",
    checkStructure([join(root, "nope")], undefined, { cwd: root }).length === 0,
  );

  // ── defaults: a measurement, not a taste ───────────────────────────────────────────────
  check(
    "`paper.pdf` is NOT in the defaults — two papers in the live corpus keep the pdf under a different name",
    !STRUCTURE_DEFAULTS.require.includes("paper.pdf"),
  );
  check(
    "and `paperlint.json` counts as a marker but not a requirement",
    STRUCTURE_DEFAULTS.markers.includes("paperlint.json") &&
      !STRUCTURE_DEFAULTS.require.includes("paperlint.json"),
  );

  // ── one schema for both halves ────────────────────────────────────────────────────────
  const asResults = asEslintResults(f);
  check(
    "findings come back shaped like an ESLint result — `--json` stays one array",
    asResults.length === 2 &&
      asResults.every(
        (r) =>
          r.errorCount === 1 &&
          r.warningCount === 0 &&
          r.messages[0].ruleId === "structure/required-file" &&
          r.messages[0].severity === 2,
      ),
  );
  check(
    "two findings in ONE directory collapse into one result with errorCount 2",
    (() => {
      const two = checkStructure(
        [papers],
        { require: ["PIPELINE-STATUS.md", "refs.bib"] },
        { cwd: root },
      ).filter((x) => x.file.endsWith("no-source"));
      return asEslintResults(two)[0].errorCount === 2;
    })(),
  );
  check(
    "the human-readable format names the directory and the finding",
    /no-scorecard/.test(formatStructure(f)) &&
      /error {2}missing/.test(formatStructure(f)),
  );
  check(
    "and the path is RELATIVE — an absolute path to the temp directory tells the reader nothing",
    f.every((x) => !x.file.startsWith("/")),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(
  `✓ ${String(n)} assertions passed — structure: a missing file cannot complain for itself`,
);
