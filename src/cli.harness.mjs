/**
 * Both halves for the `research-paper-pipeline lint` utility, and separately — failures, each
 * of which must be EXPLAINABLE, not just nonzero.
 *
 * 🔴 Two of the defects checked here the utility already had, and both were found by the
 * FIRST run, not by reading:
 *   1. `rpp --help` used to answer "unknown command `--help`" — argv[0] unconditionally became
 *      the command;
 *   2. on an empty set ESLint THROWS `NoFilesFoundError`, and the guard against a false green
 *      zero never lived long enough to reach its own check: instead of a message, a stack trace
 *      leaked out of the depths of eslint-helpers.
 * Both are pinned down by the assertions below so there is no going back.
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { run, parseArgs, buildConfig, nextSteps, findConfig, findDeclaration, toPaths, runHook } =
  await import(join(HERE, "cli.ts"));
const { init, choosePapers, offerWorkflow, syncRppJson, missingPrograms, WORKFLOW_PATH } =
  await import(join(HERE, "init.ts"));
const { PROGRAMS } = await import(join(HERE, "doctor.ts"));

let n = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  n++;
};

/** Runs the utility with output captured — quieter and faster than spawning a process. */
async function cli(args, cwd) {
  // 🔴 THE STREAMS ARE SPLIT, AND THAT IS LOAD-BEARING. As long as the harness dumped log and
  // err into one array, it physically could not see that the `config: …` line was leaking into
  // stdout BEFORE the JSON and breaking any consumer's parser. The defect was not found by a
  // test but by trying to hook a real action to this output — i.e. the test was blind to
  // exactly what it was supposed to catch.
  // `out` stays a merged string for text assertions; `stdout` is what actually goes down a pipe.
  const stdout = [];
  const stderr = [];
  const prev = process.cwd();
  if (cwd) process.chdir(cwd);
  try {
    const code = await run(args, {
      log: (...a) => stdout.push(a.join(" ")),
      err: (...a) => stderr.push(a.join(" ")),
    });
    return {
      code,
      out: [...stdout, ...stderr].join("\n"),
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
    };
  } catch (e) {
    // 🔴 A LEAKED EXCEPTION IS A PROPERTY THAT MUST BE ASSERTED, NOT CAUGHT BY LETTING THE
    // HARNESS CRASH. The mutation that removes the catch around ESLint used to bring the
    // harness down with a stack trace, and the driver — under its own strict rule "killed only
    // by ITS OWN assertion" — refused to count that as a kill and printed "survived". I.e. the
    // real defect looked like a weak test.
    return {
      code: 99,
      out: `THREW: ${e?.message ?? e}`,
      stdout: "",
      stderr: `THREW: ${e?.message ?? e}`,
    };
  } finally {
    process.chdir(prev);
  }
}

// ── argument parsing ───────────────────────────────────────────────────────────────────
check(
  "`--help` as the first argument — is a FLAG, not a command",
  parseArgs(["--help"]).help === true,
);
check("and a command is not invented in the process", parseArgs(["--help"]).cmd === null);
check(
  "the path and config are parsed",
  (() => {
    const a = parseArgs(["lint", "papers", "--config", "o.json", "--json"]);
    return (
      a.cmd === "lint" &&
      a.paths[0] === "papers" &&
      a.config === "o.json" &&
      a.json === true
    );
  })(),
);
check(
  "the default warning threshold is NEGATIVE — advice does not fail the run",
  parseArgs(["lint"]).maxWarnings === -1,
);
check(
  "and it is parsed when named explicitly",
  parseArgs(["lint", "--max-warnings", "0"]).maxWarnings === 0,
);
check(
  "the old `--options` spelling keeps working — a flag in someone else's CI is not ours to break",
  parseArgs(["lint", "--options", "o.json"]).config === "o.json",
);
check(
  "`papers` as a string and as a list normalize the same way",
  toPaths("papers")[0] === "papers" &&
    toPaths(["a", "b"]).length === 2 &&
    toPaths(undefined).length === 0 &&
    toPaths("  ").length === 0,
);

// ── config is assembled, and consumer data gets through ────────────────────────────────────
{
  const cfg = buildConfig(
    { typographyDebt: { x: { sectionSign: 3 } }, authorListCommand: "run-me" },
    null,
  );
  check(
    "without a LaTeX language the config still gets built — a corpus with no .tex is not a reason to refuse",
    Array.isArray(cfg) && cfg.length === 3,
  );
  check(
    "with a LaTeX language a fourth block is added",
    buildConfig({}, {}).length === 4,
  );
  const status = cfg.find((c) =>
    c.files.some((f) => f.includes("PIPELINE-STATUS")),
  );
  check(
    "the command from options gets through to the rule",
    status.rules["paper/author-list"][1].command === "run-me",
  );
}

// ── failures must be EXPLAINABLE ─────────────────────────────────────────────────────────
{
  const r = await cli(["--help"]);
  check(
    "`--help` prints usage and exits zero",
    r.code === 0 && /npx rpp lint/.test(r.out),
  );
}
// ── ONE DECLARATION, READ BY THE SAME THING THAT WRITES IT ─────────────────────────────
//
// 🔴 WITHOUT THIS BLOCK THE REWRITTEN `init` WOULD PRODUCE A BROKEN INSTALL. It writes one
// declaration — into `package.json`, the file the hooks know how to read (a hook does not
// import code and cannot walk up the tree; it can only read a path it is able to name). The
// utility, though, read ONLY `rpp.json`, so right after `rpp init` its `lint` would say
// "nothing to lint". I.e. the install command and the check command would be looking at
// different files — exactly the defect it exists to close, just from the other side.
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rpp-carrier-")));
  try {
    const paper = join(root, "papers", "p1");
    mkdirSync(join(paper, "versions"), { recursive: true });
    writeFileSync(join(paper, "versions", "s.tex"), "abcd");
    writeFileSync(join(paper, "versions", "2026-07-22-submitted.pdf"), "x".repeat(100));
    writeFileSync(join(paper, "paper.md"), "# Intro\n\nRQ1: does it hold?\n");
    writeFileSync(
      join(paper, "PIPELINE-STATUS.md"),
      `---\nstages:\n  - stage: submitted\n    date: 2026-07-22\n    pdf: versions/2026-07-22-submitted.pdf\n    bytes: 100\n    source: versions/s.tex\n    sourceBytes: 4\nresearchQuestion: "does it hold?"\n---\n# S\n\n| id | note |\n|---|---|\n| cites | bib-authors run |\n`,
    );
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        { name: "c", version: "1.0.0", "research-paper-pipeline": { papers: "papers" } },
        null,
        2,
      ),
    );

    const r = await cli(["lint"], root);
    check(
      "🔴 THE UTILITY READS THE DECLARATION FROM package.json — otherwise `rpp init` sets up something `rpp lint` cannot see",
      r.code === 0 && /no findings/.test(r.out),
    );
    check(
      "and NAMES the carrier out loud — swapping settings is never silent",
      /config: package\.json/.test(r.out),
    );
    check(
      "package.json carries no deprecation notice — it is not the one that is deprecated",
      !/is deprecated/.test(r.out),
    );

    // The key is present, `papers` inside it is not: this is not an "empty config" but an
    // unfinished one, and the failure must name the EXACT shape that needs adding.
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "c", version: "1.0.0", "research-paper-pipeline": {} }, null, 2),
    );
    const noPapers = await cli(["lint"], root);
    check(
      "a key with no `papers` — a failure, and the shape is shown INSIDE package.json",
      noPapers.code === 2 &&
        /must declare `papers`/.test(noPapers.out) &&
        /"research-paper-pipeline": \{ "papers": "papers" \}/.test(noPapers.out),
    );

    // 🔴 A package.json WITHOUT the key does not stop the walk upward. Otherwise the search
    // would end at the first project going up the tree — and every project has a package.json —
    // and would never find anything, ever.
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "c", version: "1.0.0" }));
    writeFileSync(join(root, "rpp.json"), JSON.stringify({ papers: "papers" }));
    const viaRpp = await cli(["lint"], root);
    check(
      "a keyless package.json does not intercept the search — rpp.json is still found",
      viaRpp.code === 0 && /config: rpp\.json/.test(viaRpp.out),
    );
    check(
      "🔴 but a deprecated carrier is NAMED, not just silently read",
      /rpp\.json is deprecated/.test(viaRpp.out) &&
        /the hooks read only that file/.test(viaRpp.out),
    );

    // Both carriers side by side: the one everything ELSE reads wins.
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "c",
        version: "1.0.0",
        "research-paper-pipeline": { papers: "papers" },
      }),
    );
    check(
      "with both carriers present package.json is chosen — that is what \"one declaration\" means",
      findDeclaration(root)?.kind === "package.json" &&
        findDeclaration(root)?.path === join(root, "package.json"),
    );
    check(
      "and findConfig still answers the question \"which file holds the settings\"",
      findConfig(root) === join(root, "package.json"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── `init` — THREE ACTIONS INSTEAD OF NINE ────────────────────────────────────────────────
//
// 🔴 THE DEFECT THIS COMMAND WAS REWRITTEN FOR (issue #33, measured 09-18): init wrote
// `rpp.json` with a GUESSED `"papers": "papers"` and never touched `package.json` — while the
// three hooks read the papers directory from exactly there. A consumer who did everything by
// the book got a `paper-edit-guard` guarding a directory that did not exist; from outside that
// is indistinguishable from a working guard, because silence is its success state.
//
// ⚠️ Questions here are NOT ASKED blind: `interactive` is passed explicitly, never read from
// stdin. A harness stuck at an input prompt is not a red test, it is the absence of any answer
// at all.
{
  const workRoot = realpathSync(mkdtempSync(join(tmpdir(), "rpp-init-")));
  const project = (name, { pkg = { name: "consumer", version: "1.0.0" }, papers = [] } = {}) => {
    const dir = join(workRoot, name);
    mkdirSync(dir, { recursive: true });
    for (const rel of papers) {
      mkdirSync(join(dir, rel, "p1"), { recursive: true });
      writeFileSync(join(dir, rel, "p1", "paper.tex"), "\\documentclass{article}\n");
    }
    if (pkg) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    return dir;
  };
  const say = () => {
    const lines = [];
    return { lines, log: (...a) => lines.push(a.join(" ")), text: () => lines.join("\n") };
  };
  const declared = (dir) =>
    JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))["research-paper-pipeline"];
  // No check should depend on what is installed ON THIS MACHINE: `command -v` is faked,
  // otherwise "no external programs" would read as a finding about init.
  const haveAll = () => ({ status: 0 });
  const haveNone = () => ({ status: 1 });

  try {
    // ── 1. THE PAPERS DIRECTORY IS MEASURED, NOT GUESSED ────────────────────────────
    {
      const dir = project("detect", { papers: ["writing/drafts"] });
      const out = say();
      const code = await init(dir, { log: out.log, err: out.log, interactive: false, run: haveAll });
      check(
        "🔴 THE DECLARATION SHOWS UP IN package.json — the file the hooks read",
        declared(dir) !== undefined && typeof declared(dir).papers === "string",
      );
      check(
        "🔴 and its value is MEASURED, not taken from the `papers` default",
        declared(dir).papers === "writing/drafts",
      );
      check(
        "and it says HOW it was measured — otherwise a guess reads as a fact",
        /measured: its subdirectories carry/.test(out.text()),
      );
      check(
        "🔴 `rpp.json` IS NO LONGER CREATED — a second declaration is what doctor exists to catch",
        !existsSync(join(dir, "rpp.json")),
      );
      check(
        "init ends with doctor's report: the install vouches for its OWN state",
        /rpp doctor — what is wired/.test(out.text()),
      );
      check(
        "and exits zero on a consistent install",
        code === 0 && /the same directory/.test(out.text()),
      );
    }

    // ── 2. A GUESS IS CALLED A GUESS ───────────────────────────────────────────────
    {
      const dir = project("empty");
      const out = say();
      const code = await init(dir, { log: out.log, err: out.log, interactive: false, run: haveAll });
      check(
        "nothing to measure — the documented default is taken",
        declared(dir).papers === "papers",
      );
      check(
        "🔴 and it is MARKED as a guess, not presented as a measurement",
        /A GUESS/.test(out.text()) && /Nothing here looks like a papers directory/.test(out.text()),
      );
      check(
        "🔴 no directory ⇒ doctor goes red, and init returns ITS verdict, not its own success",
        code === 2 && /the install is NOT finished/.test(out.text()),
      );
    }

    // ── 3. SOMEONE ELSE'S VALUE DOES NOT GET OVERWRITTEN ─────────────────────────────
    {
      const dir = project("mine", {
        pkg: { name: "c", version: "1.0.0", "research-paper-pipeline": { papers: "mine" } },
        papers: ["writing"],
      });
      const before = readFileSync(join(dir, "package.json"), "utf8");
      const out = say();
      await init(dir, { log: out.log, err: out.log, interactive: false, run: haveAll });
      check(
        "🔴 an already-declared value stays intact byte for byte — silently replacing a setting is worse than doing nothing",
        readFileSync(join(dir, "package.json"), "utf8") === before,
      );
      check(
        "and it says so out loud, rather than skipping it",
        /already declares papers = "mine" — kept, nothing overwritten/.test(out.text()),
      );
    }

    // ── 4. NOWHERE TO WRITE — A FAILURE WITH A REMEDY ─────────────────────────────
    {
      const dir = project("nopkg", { pkg: null, papers: ["writing"] });
      const out = say();
      const code = await init(dir, { log: out.log, err: out.log, interactive: false, run: haveAll });
      check(
        "without package.json init FAILS and carries a remedy, not just a diagnosis",
        code === 2 &&
          /npm init -y/.test(out.text()) &&
          /nowhere to put the declaration/.test(out.text()),
      );
      check("and creates nothing in its place", !existsSync(join(dir, "package.json")));
    }

    // ── 5. ONLY WHAT CANNOT BE GUESSED IS ASKED, AND ONLY OF A HUMAN ─────────────────
    {
      const dir = project("ci", { papers: ["writing"] });
      const out = say();
      await init(dir, { log: out.log, err: out.log, interactive: false, run: haveAll });
      check(
        "🔴 not a terminal — the question is NOT asked, and the default taken is NAMED",
        /stdin is not a terminal, so nothing was asked. Default taken: NO file written/.test(
          out.text(),
        ),
      );
      check(
        "and the safe default is the absence of a file",
        !existsSync(join(dir, WORKFLOW_PATH)),
      );
      check(
        "and the CI step is still printed — it just gets pasted in by hand",
        /uses: zernie\/research-paper-pipeline@/.test(out.text()) &&
          /paths: writing/.test(out.text()),
      );
    }
    {
      const dir = project("ci-yes", { papers: ["writing"] });
      const asked = [];
      const wf = await offerWorkflow(dir, "writing", {
        interactive: true,
        ask: async (q) => {
          asked.push(q);
          return "y";
        },
      });
      check("saying yes WRITES the workflow", wf === "written" && existsSync(join(dir, WORKFLOW_PATH)));
      check(
        "and the workflow carries THE directory that was actually discussed",
        /paths: writing/.test(readFileSync(join(dir, WORKFLOW_PATH), "utf8")),
      );
      check("the question is asked exactly once", asked.length === 1);
      const again = await offerWorkflow(dir, "writing", {
        interactive: true,
        ask: async () => "y",
      });
      check("an existing workflow is neither overwritten nor asked about again", again === "kept");
    }
    {
      const dir = project("ci-no", { papers: ["writing"] });
      const no = await offerWorkflow(dir, "writing", { interactive: true, ask: async () => "" });
      check(
        "an empty answer is a NO, and no file appears",
        no === "declined" && !existsSync(join(dir, WORKFLOW_PATH)),
      );
      // 🔴 Measured 09-18 on a real pseudo-terminal: `readline.question()` REJECTS with
      // `AbortError: Aborted with Ctrl+D`, and this exception used to escape AFTER the
      // declaration had already been written — i.e. the install both succeeded and looked like
      // a crash.
      // 🔴 THE `.catch` HERE IS LOAD-BEARING, NOT CAUTION. A leaked exception is a PROPERTY that
      // gets asserted; caught by letting the harness crash it reads to the battery's driver as
      // "the mutation survived", i.e. the real defect would look like a hole in the test.
      const aborted = await offerWorkflow(dir, "writing", {
        interactive: true,
        ask: async () => {
          throw new Error("Aborted with Ctrl+D");
        },
      }).catch((e) => `THREW: ${e?.message ?? e}`);
      check("🔴 an interrupted question does NOT crash the command — it means the default", aborted === "declined");
    }

    // ── 6. SEVERAL CANDIDATES — THE ONLY CASE WHERE A QUESTION IS ASKED ───────────────
    {
      const dir = project("many", { papers: ["alpha", "beta"] });
      const picked = await choosePapers(dir, { interactive: true, ask: async () => "2" });
      check(
        "🔴 the human's answer DECIDES, it does not just decorate the output",
        picked.how === "chosen" && picked.papers === picked.candidates[1],
      );
      const quiet = await choosePapers(dir, { interactive: false });
      check(
        "outside a terminal the first one is taken, and this is NAMED, not passed off as a choice",
        quiet.how === "not-asked" && quiet.papers === quiet.candidates[0],
      );
      const aborted = await choosePapers(dir, {
        interactive: true,
        ask: async () => {
          throw new Error("Aborted with Ctrl+D");
        },
      }).catch((e) => ({ how: `THREW: ${e?.message ?? e}`, papers: null, candidates: [] }));
      check(
        "an interrupted choice is also a default, not a crash",
        aborted.how === "no-answer" && aborted.papers === aborted.candidates[0],
      );
    }

    // ── 7. EXTERNAL TOOLING IS REPORTED, NOT INSTALLED ───────────────────────────────
    //
    // npm's own rule, quoted in the analysis of husky: "The only valid use of install or
    // preinstall scripts is for compilation". An install that can silently fail to happen is
    // worse than an explicit step.
    {
      const dir = project("tools", { papers: ["writing"] });
      const out = say();
      await init(dir, { log: out.log, err: out.log, interactive: false, run: haveNone });
      // 🔴 JUDGE ONLY init's OWN REPORT, BEFORE doctor's banner. The first version of these
      // three assertions looked at the WHOLE output — and doctor also prints `✗ pdflatex` and
      // the same install command. The mutation that stripped the remedy OUT of init stayed
      // green: the assertion found a line printed by a different command and reported coverage
      // that did not exist.
      const own = out.text().split("── rpp doctor")[0];
      check(
        "every absence is NAMED, and the count matches the names",
        /✗ 7 of 7 missing: pdflatex, bibtex/.test(own),
      );
      check(
        "🔴 and it carries the INSTALL COMMAND — a remedy, not just a diagnosis",
        /apt-get install -y texlive-latex-recommended/.test(own),
      );
      check(
        "and it says outright that nothing is installed on the user's behalf",
        /Nothing is installed for you/.test(own),
      );
      // One fact, one author: the consequence of each absence is printed by doctor, and printed
      // ONCE.
      check(
        "and init does NOT repeat doctor's table twenty lines above it",
        !/no PDF is produced/.test(own) &&
          /no PDF is produced/.test(out.text().split("── rpp doctor")[1] ?? ""),
      );
      check(
        "and asking a system that has everything gives zero absences",
        missingPrograms(haveAll).length === 0,
      );
      check(
        "and an empty system gives all of them — the counter counts the same thing it prints",
        missingPrograms(haveNone).length === PROGRAMS.length,
      );
    }

    // ── 8. `rpp.json` FOR THOSE WHO ALREADY HAVE ONE ──────────────────────────────────
    {
      const dir = project("legacy", { papers: ["writing"] });
      writeFileSync(join(dir, "rpp.json"), JSON.stringify({ minFindings: 5 }, null, 2) + "\n");
      const out = say();
      await init(dir, { log: out.log, err: out.log, interactive: false, run: haveAll });
      check(
        "an existing rpp.json gets the SAME value, rather than drifting silently",
        JSON.parse(readFileSync(join(dir, "rpp.json"), "utf8")).papers === "writing",
      );
      check("and is named deprecated", /rpp\.json was already here/.test(out.text()));

      const own = join(workRoot, "legacy-own");
      mkdirSync(own, { recursive: true });
      writeFileSync(join(own, "package.json"), '{"name":"c","version":"1.0.0"}');
      writeFileSync(join(own, "rpp.json"), '{"papers":"mine"}');
      check(
        "and the `papers` value it already declares stays byte for byte — this too is someone else's value",
        syncRppJson(own, "writing") === "kept" &&
          readFileSync(join(own, "rpp.json"), "utf8") === '{"papers":"mine"}',
      );
    }

    // ── 9. THE COMMAND IS WIRED TO `run`, NOT MERELY EXPORTED ────────────────────────
    {
      const dir = project("wired", { papers: ["writing"] });
      const r = await cli(["init", dir]);
      check(
        "`rpp init` reaches the implementation and declares the measured directory",
        declared(dir).papers === "writing" && /rpp init — each decision/.test(r.out),
      );
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}
{
  const r = await cli(["frobnicate"]);
  check(
    "an unknown command is NAMED",
    r.code === 2 && /unknown command `frobnicate`/.test(r.out),
  );
}
{
  // A flag with no value. The defect was found by the compiler while porting to TypeScript:
  // `rest[++i]` past the last argument gives undefined, and `--config` with no value silently
  // meant "no config was set" — i.e. an autodiscovered file instead of the named one.
  const r = await cli(["lint", "--config"]);
  check(
    "a flag with no value — a FAILURE, not a silent default",
    r.code === 2 && /--config needs a value/.test(r.out),
  );
}
{
  // A "." default would give a green run over whatever happens to be lying around — the same
  // contract as the action, and the same reason. An empty directory with no config is exactly
  // that case.
  const bare = realpathSync(mkdtempSync(join(tmpdir(), "rpp-bare-")));
  try {
    const r = await cli(["lint"], bare);
    check(
      "`lint` with NO path AND no config refuses and names BOTH ways out",
      r.code === 2 &&
        /nothing to lint/.test(r.out) &&
        /rpp init/.test(r.out) &&
        /rpp lint papers/.test(r.out),
    );
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
}

// ── on live files: both halves ───────────────────────────────────────────────────────
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rpp-cli-")));
  try {
    const paper = join(root, "papers", "p1");
    mkdirSync(join(paper, "versions"), { recursive: true });
    writeFileSync(
      join(paper, "versions", "2026-07-22-submitted.pdf"),
      "x".repeat(100),
    );
    const status = (bytes) =>
      `---\nstages:\n  - stage: submitted\n    date: 2026-07-22\n    pdf: versions/2026-07-22-submitted.pdf\n    bytes: ${bytes}\n    source: versions/s.tex\n    sourceBytes: 4\nresearchQuestion: "does it hold?"\n---\n# S\n\n| id | note |\n|---|---|\n| cites | bib-authors run |\n`;
    writeFileSync(join(paper, "versions", "s.tex"), "abcd");
    writeFileSync(join(paper, "paper.md"), "# Intro\n\nRQ1: does it hold?\n");

    writeFileSync(join(paper, "PIPELINE-STATUS.md"), status(100));
    const clean = await cli(["lint", "papers"], root);
    check(
      "on a clean corpus — zero and a legible report",
      clean.code === 0 && /no findings/.test(clean.out),
    );

    writeFileSync(join(paper, "PIPELINE-STATUS.md"), status(999));
    const dirty = await cli(["lint", "papers"], root);
    check("a planted byte mismatch — a finding and code 1", dirty.code === 1);
    check(
      "and the finding names BOTH numbers",
      /999/.test(dirty.out) && /100/.test(dirty.out),
    );

    const json = await cli(["lint", "papers", "--json"], root);
    check(
      "`--json` gives back parseable JSON",
      (() => {
        try {
          return Array.isArray(JSON.parse(json.stdout));
        } catch {
          return false;
        }
      })(),
    );

    // 🔴 The guard against a false green zero: ESLint throws on an empty set, and before the
    // fix a stack trace flew out here instead of an explanation.
    mkdirSync(join(root, "nothing"), { recursive: true });
    const empty = await cli(["lint", "nothing"], root);
    check(
      "the utility does NOT let an exception escape — a failure is declared by the exit code",
      empty.code !== 99,
    );
    check("an empty set — a FAILURE, not a green zero", empty.code === 1);
    check(
      "and the failure explains exactly what was not found",
      /nothing was linted/.test(empty.out) &&
        /not a clean report/.test(empty.out),
    );

    writeFileSync(join(root, "bad.json"), "{ not json");
    const bad = await cli(["lint", "papers", "--config", "bad.json"], root);
    check(
      "a broken config is NAMED, not a dropped stack trace",
      bad.code === 2 && /not valid JSON/.test(bad.out),
    );

    const noFile = await cli(["lint", "papers", "--config", "nope.json"], root);
    check(
      "a missing config is also named",
      noFile.code === 2 && /config file not found/.test(noFile.out),
    );

    // `check` stays an alias: someone else's workflow is not broken, but they are told what it
    // was replaced by.
    const alias = await cli(["check", "papers"], root);
    check(
      "`check` still works and prints what replaced it",
      alias.code === 1 && /`check` is now `lint`/.test(alias.out),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── THE CONFIG FINDS ITSELF, AND THE PAPERS DIRECTORY IS DECLARED IN IT ──────────────────
//
// 🔴 THE DEFECT THIS BLOCK EXISTS FOR: `rpp init` wrote `rpp.json`, and `rpp check` only read
// it via an explicit `--options`. I.e. the file the utility itself created had no effect on the
// run — and there was no way to find that out: zero typography debt looks exactly like a
// config that was never found.
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rpp-cfg-")));
  try {
    const paper = join(root, "papers", "p1");
    mkdirSync(join(paper, "versions"), { recursive: true });
    writeFileSync(join(paper, "versions", "s.tex"), "abcd");
    writeFileSync(
      join(paper, "versions", "2026-07-22-submitted.pdf"),
      "x".repeat(100),
    );
    writeFileSync(join(paper, "paper.md"), "# Intro\n\nRQ1: does it hold?\n");
    const status = (bytes) =>
      `---\nstages:\n  - stage: submitted\n    date: 2026-07-22\n    pdf: versions/2026-07-22-submitted.pdf\n    bytes: ${bytes}\n    source: versions/s.tex\n    sourceBytes: 4\nresearchQuestion: "does it hold?"\n---\n# S\n\n| id | note |\n|---|---|\n| cites | bib-authors run |\n`;
    writeFileSync(join(paper, "PIPELINE-STATUS.md"), status(100));

    // findConfig — kept separate from the run so the failure is distinguishable
    writeFileSync(join(root, "rpp.json"), JSON.stringify({ papers: "papers" }));
    check(
      "findConfig walks up from a subdirectory and finds the file at the root",
      findConfig(paper) === join(root, "rpp.json"),
    );
    // There can be no tautology here: a neighboring tree must NOT pick up our file. Asserting
    // `=== null` against a live filesystem is not safe — someone else's rpp.json may sit further
    // up the chain — so what is asserted is what is actually checkable: our config is not
    // visible from there.
    const sibling = realpathSync(mkdtempSync(join(tmpdir(), "rpp-other-")));
    check(
      "the config does NOT leak into a neighboring tree — the search goes up, not sideways",
      findConfig(sibling) !== join(root, "rpp.json"),
    );
    rmSync(sibling, { recursive: true, force: true });

    const found = await cli(["lint"], root);
    check(
      "the config is FOUND on its own: `lint` with no argument at all runs",
      found.code === 0 && /no findings/.test(found.out),
    );
    check(
      "and the found file is NAMED out loud — swapping settings silently is not acceptable",
      /config: rpp\.json/.test(found.out),
    );

    // 🔴 THE RESOLUTION DISCRIMINATOR. Run FROM the paper's directory: same config, and
    // `"papers": "papers"` resolved relative to the CURRENT directory would point at
    // `papers/p1/papers` — which does not exist, and the run would fail with "nothing was
    // linted" right where the whole corpus is present.
    const fromSub = await cli(["lint"], paper);
    check(
      "the path from the config resolves relative to the CONFIG'S DIRECTORY, not the current one",
      fromSub.code === 0 && /no findings/.test(fromSub.out),
    );

    // Consumer data from the found config actually reaches the rules, not just gets read.
    writeFileSync(join(paper, "PIPELINE-STATUS.md"), status(999));
    const dirty = await cli(["lint"], root);
    check(
      "a found config does not cancel findings — the mismatch is still caught",
      dirty.code === 1 && /999/.test(dirty.out),
    );
    writeFileSync(join(paper, "PIPELINE-STATUS.md"), status(100));

    // An argument OVERRIDES the config: one paper instead of the corpus, with no file edit.
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    const override = await cli(["lint", "elsewhere"], root);
    check(
      "a command-line argument OVERRIDES `papers` from the config",
      override.code === 1 &&
        /nothing was linted under elsewhere/.test(override.out),
    );

    // 🔴 `papers` — A REQUIRED FIELD. A config without it is not an "empty config" but an
    // unfinished one: silently falling back to "." means running the rules over the whole checkout.
    writeFileSync(join(root, "rpp.json"), JSON.stringify({ minFindings: 3 }));
    const noPapers = await cli(["lint"], root);
    check(
      "a config WITHOUT `papers` — a failure, and the field is named by name",
      noPapers.code === 2 &&
        /must declare `papers`/.test(noPapers.out) &&
        /cannot guess/.test(noPapers.out),
    );
    check(
      'an empty string in `papers` counts as absent, not as the directory ""',
      (
        await (async () => {
          writeFileSync(join(root, "rpp.json"), JSON.stringify({ papers: "" }));
          return await cli(["lint"], root);
        })()
      ).code === 2,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── THE WARNING THRESHOLD ───────────────────────────────────────────────────────────────
//
// The action has a `max-warnings` input, and once the action stopped calling eslint directly,
// the threshold had to show up here too — otherwise it would have been lost SILENTLY: the run
// would stay green, and the consumer's setting would stop meaning anything.
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rpp-warn-")));
  try {
    const paper = join(root, "papers", "p1");
    mkdirSync(join(paper, "versions"), { recursive: true });
    writeFileSync(join(paper, "versions", "s.tex"), "abcd");
    writeFileSync(
      join(paper, "versions", "2026-07-22-submitted.pdf"),
      "x".repeat(100),
    );
    // Three § signs — the `paper/typography` rule, warn level and only warn.
    writeFileSync(
      join(paper, "paper.md"),
      "# Intro\n\nRQ1: does it hold?\n\nSee \u00a7 5 and \u00a7 6 and \u00a7 7.\n",
    );
    writeFileSync(
      join(paper, "PIPELINE-STATUS.md"),
      `---\nstages:\n  - stage: submitted\n    date: 2026-07-22\n    pdf: versions/2026-07-22-submitted.pdf\n    bytes: 100\n    source: versions/s.tex\n    sourceBytes: 4\nresearchQuestion: "does it hold?"\n---\n# S\n\n| id | note |\n|---|---|\n| cites | bib-authors run |\n`,
    );
    writeFileSync(join(root, "rpp.json"), JSON.stringify({ papers: "papers" }));

    const lax = await cli(["lint"], root);
    check(
      "a warning WITH NO threshold does not fail the run — otherwise a gate on advice would be muted entirely",
      lax.code === 0,
    );
    const strict = await cli(["lint", "--max-warnings", "0"], root);
    check(
      "and with a threshold of 0 it fails, and it's the very same warning",
      strict.code === 1,
    );
    check(
      "and the failure names the NUMBER and the THRESHOLD, not just \"too many\"",
      /1 warning\(s\) exceed the --max-warnings limit of 0/.test(strict.out),
    );
    const generous = await cli(["lint", "--max-warnings", "5"], root);
    check(
      "a threshold ABOVE the finding count stays quiet — the check is about the threshold, not about a warning existing",
      generous.code === 0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── STRUCTURE GETS THROUGH TO THE COMMAND ──────────────────────────────────────────────
//
// `structure.mjs` is checked separately and in full (`structure.harness.mjs`). Here — exactly
// one fact that harness cannot know: that the module is WIRED IN. A correct module forgotten in
// `run()` gives zero findings and looks like a clean corpus.
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rpp-wired-")));
  try {
    const paper = join(root, "papers", "orphan");
    mkdirSync(paper, { recursive: true });
    // The marker is present, the scorecard is not: NOT ONE pipeline rule runs over this directory.
    writeFileSync(join(paper, "paper.tex"), "\\documentclass{article}\n");
    writeFileSync(join(root, "rpp.json"), JSON.stringify({ papers: "papers" }));

    const r = await cli(["lint"], root);
    check(
      "a directory with no scorecard is NOT a green zero: the command exits one",
      r.code === 1,
    );
    check(
      "and the finding is printed before the ESLint report, with its consequence",
      /missing `PIPELINE-STATUS\.md`/.test(r.out) && /ZERO rules/.test(r.out),
    );
    check(
      "and it does NOT print \"no findings\" over something that was found",
      !/no findings/.test(r.out),
    );

    const j = await cli(["lint", "--json"], root);
    // 🔴 The defect the streams were split for: a `config: …` line in stdout before the array
    // breaks `| jq` for a consumer. Both halves — stdout is clean, and the line is NOT LOST.
    check(
      "`--json`: stdout is clean JSON, not one incidental line before it",
      (() => {
        try {
          JSON.parse(j.stdout);
          return true;
        } catch {
          return false;
        }
      })(),
    );
    check(
      "and the line about the found config is not lost — it went to stderr",
      /config: rpp\.json/.test(j.stderr) && !/config:/.test(j.stdout),
    );
    check(
      "`--json` gives back ONE array, where the missing-file finding sits next to the rule findings",
      (() => {
        try {
          const parsed = JSON.parse(j.stdout);
          return parsed.some((x) =>
            x.messages?.some((m) => m.ruleId === "structure/required-file"),
          );
        } catch {
          return false;
        }
      })(),
    );

    // The paired half RIGHT HERE: the scorecard is added — the check falls silent.
    writeFileSync(
      join(paper, "PIPELINE-STATUS.md"),
      "---\nstages: []\n---\n# S\n",
    );
    const after = await cli(["lint"], root);
    check(
      "the scorecard was added — the structural complaint is gone",
      !/missing `PIPELINE-STATUS\.md`/.test(after.out),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── `rpp hook` — THE RUNTIME RESOLVES FROM THE PACKAGE, NOT FROM THE PROJECT ROOT ────────
//
// 🔴 The measurement that gave rise to this command: one tarball, two package managers.
//     npm:  node_modules/vigiles/dist/cli.js  EXISTS
//     pnpm: node_modules/vigiles/dist/cli.js  DOES NOT
// The old wiring addressed the runtime from the project root and did not resolve under pnpm,
// and `|| exit 2` on PreToolUse(Bash) turned that into a block on ANY command. The end-to-end
// half (both installs, real processes) lives in `scripts/install-e2e.mjs`; here — the verdicts.
{
  const calls = [];
  const fake = (code) => (bin, args, opts) => {
    calls.push({ bin, args, opts });
    return { status: code };
  };
  let said = "";
  const err = (...a) => {
    said += a.join(" ") + "\n";
  };

  said = "";
  check(
    "no name — a failure, and the right invocation is suggested",
    runHook(undefined, { err }) === 2 && /rpp hook paper-edit-guard/.test(said),
  );

  said = "";
  check(
    "an unknown hook is NAMED together with the path it was looked for at",
    runHook("no-such-hook", { err }) === 2 &&
      /unknown hook `no-such-hook`/.test(said) &&
      /no-such-hook\.hook\.mjs/.test(said),
  );

  // 🔴 THE MAIN ASSERTION. A runtime that cannot be found HAS NO RIGHT to return 2: on
  // PreToolUse that blocks any Bash command, including the one that would fix it. It must say
  // so LOUDLY and let it through. Silent degradation is worse than an explicit one, but blocking
  // everything is worse than both.
  said = "";
  calls.length = 0;
  const brokenResolve = () => {
    throw new Error("Cannot find module 'vigiles/dist/cli.js'");
  };
  const code = runHook("paper-edit-guard", {
    err,
    run: fake(0),
    resolve: brokenResolve,
  });
  check(
    "the runtime does not resolve — work is NOT blocked (code 0, not 2)",
    code === 0,
  );
  check(
    "and the complaint is LOUD: the hook is named, the effect is named, the remedy is named",
    /paper-edit-guard/.test(said) &&
      /is NOT running/.test(said) &&
      /Reinstall this package/.test(said),
  );
  check("and the runtime was NOT started in the process", calls.length === 0);

  // The hook's real verdict passes through — otherwise the guard stops being a guard.
  calls.length = 0;
  check(
    "the hook's verdict passes STRAIGHT THROUGH: 2 stays 2",
    runHook("paper-edit-guard", { err, run: fake(2) }) === 2,
  );
  check(
    "and EXACTLY the runtime with this hook's program is run",
    calls.length === 1 &&
      calls[0].args[1] === "hook-runtime" &&
      calls[0].args[2] === "run-program" &&
      /paper-edit-guard\.hook\.mjs$/.test(calls[0].args[3]),
  );
  check(
    "zero stays zero",
    runHook("paper-skills-nudge", { err, run: fake(0) }) === 0,
  );
}

// ── RUNNING THROUGH A SYMLINK — the only way a consumer ever calls the utility ───────
//
// 🔴 npm puts a SYMLINK in `node_modules/.bin/`. The first version compared `import.meta.url`
// against `file://${process.argv[1]}`: for a symlink those two paths are DIFFERENT, the
// condition is false, and the utility silently exited zero. A direct `node bin/rpp.mjs` worked
// fine, meanwhile — i.e. the defect was invisible in exactly the way it is normally checked.
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rpp-link-")));
  try {
    const link = join(root, "rpp-shim");
    symlinkSync(join(HERE, "..", "bin", "rpp.mjs"), link);
    const paper = join(root, "papers", "p");
    mkdirSync(join(paper, "versions"), { recursive: true });
    writeFileSync(
      join(paper, "PIPELINE-STATUS.md"),
      "---\nstages:\n  - stage: submitted\n    date: 2026-07-22\n    pdf: versions/a.pdf\n    bytes: 1\n---\n# S\n",
    );
    const r = spawnSync(process.execPath, [link, "lint", "papers"], {
      cwd: root,
      encoding: "utf8",
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    check(
      "through a SYMLINK the utility works, rather than silently exiting zero",
      r.status === 1,
    );
    check("and prints findings", /paper\/stages/.test(out));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(
  `✓ ${String(n)} assertions passed — rpp lint, one command instead of hand-rolled config`,
);

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 has ONE shape now: two lines typed inside Claude Code.
//
// 🔴 It must never ask for a manual runtime install again. That instruction went through three
// forms — a copy-paste line, a `--with-hooks` flag, a self-contained bundle — and all three were
// wrong for the same reason: the runtime is an ordinary dependency, so there is nothing to do.

{
  const steps = nextSteps("papers");
  check(
    "step 3 gives the two /plugin lines",
    steps.includes("/plugin marketplace add") &&
      steps.includes("/plugin install research-paper-pipeline"),
  );
  check("and asks for NO manual install", !/npm i -D vigiles/.test(steps));
  check(
    "and says the runtime already came along",
    /runtime came with this package/.test(steps),
  );
  check(
    "skipping it is still safe, and says so",
    /everything above still works/.test(steps),
  );
}
