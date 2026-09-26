/**
 * Both halves for `build.ts` — the shell that compiles a paper with pdflatex and bibtex.
 *
 * The process runner is replaced by a fake that writes what pdflatex and bibtex would write, so
 * these assertions check the SHELL's decisions: what is run, with which environment, in which
 * order, and what is left on disk. Whether a real pdflatex produces a real PDF is the other half,
 * `test/e2e/build.mjs`.
 *
 * 🔴 THE TWO THINGS PINNED DOWN HERE THAT A RETURNED OBJECT CANNOT SHOW: a paper-supplied
 * `build.sh` is never executed (checked by the trace it would leave on disk and by the list of
 * processes started), and a failed build removes the stale `paper.pdf` (checked on disk).
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const {
  buildPaper,
  buildPapers,
  papersIn,
  formatResult,
  anyFailed,
  remedyFor,
  parseDocumentclass,
  readFacts,
  withTexInputs,
  pdflatexArgs,
  planFor,
  STEPS,
  IGNORED_SCRIPTS,
} = await import(join(HERE, "build.ts"));
const { packageVenuesDir } = await import(
  join(HERE, "..", "skills", "paper-pipeline", "scripts", "consumer.mjs")
);

let n = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  n++;
};

const root = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-build-")));
// 🔴 banal is looked for under the temp root, never in the developer's cache: with the real
// `~/.cache/paperlint/banal` present, the measure step would run the real banal on the fake reader's pages.
const ENV = { PAPERLINT_BANAL_DIR: join(root, "no-banal") };
const paper = (name, files) => {
  const dir = join(root, "papers", name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
};

/**
 * A fake TeX. `pdflatex` writes paper.aux / paper.log (and paper.pdf on success) in its cwd;
 * `bibtex` writes paper.bbl. Every call is recorded with its argv, cwd and TEXINPUTS.
 */
function fakeTex({
  aux = "\\relax\n",
  exitCode = 0,
  log = "",
  missing = false,
  noPdf = false,
  // `noLog`: pdflatex that dies before it opens paper.log (a format it cannot load); what it
  // printed is `stdout`.
  noLog = false,
  stdout = "",
} = {}) {
  const calls = [];
  const run = (bin, args, opts) => {
    calls.push({ bin, args, cwd: opts?.cwd, texinputs: opts?.env?.TEXINPUTS });
    if (missing)
      return {
        error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
        status: null,
      };
    if (bin === "pdflatex") {
      writeFileSync(join(opts.cwd, "paper.aux"), aux);
      if (!noLog) writeFileSync(join(opts.cwd, "paper.log"), log);
      // `noPdf`: what real pdflatex does on a document with no pages — "No pages of output.", exit 0.
      if (exitCode === 0 && !noPdf)
        writeFileSync(join(opts.cwd, "paper.pdf"), "%PDF-fake");
      return { status: exitCode, stdout, stderr: "" };
    }
    if (bin === "bibtex") {
      writeFileSync(join(opts.cwd, "paper.bbl"), "\\begin{thebibliography}{1}");
      return { status: 0, stdout: "This is BibTeX\n", stderr: "" };
    }
    return { status: 99 };
  };
  return { run, calls };
}
const quiet = () => {};

/**
 * pdf.js's port, faked: the build's measure step reads the PDF the fake TeX wrote (`%PDF-fake`),
 * which a real reader would refuse. Every call is recorded; `fail` makes the read fail.
 */
const reads = [];
const lastPage = {
  widthPt: 612,
  heightPt: 792,
  words: Array.from({ length: 80 }, (_, i) => ({
    x0: i < 40 ? 54 : 320,
    y0: 60 + (i % 40) * 10,
    x1: i < 40 ? 74 : 340,
    y1: 70 + (i % 40) * 10,
    text: "w",
  })),
};
const fakeRead = async (pdf) => {
  reads.push(pdf);
  // Like the real reader: a PDF that is not on disk is unreadable, not a clean read.
  if (!existsSync(pdf))
    return { ok: false, reason: "unreadable", detail: `ENOENT: ${pdf}` };
  return {
    ok: true,
    facts: {
      pages: 1,
      fonts: {
        kind: "drawn",
        list: [{ kind: "embedded", name: "CMR10", program: "Type1" }],
      },
      last: lastPage,
    },
  };
};
const CLEAN_TEX = "\\documentclass{article}\\begin{document}x\\end{document}";

try {
  // ── inputs: paperlint's own venues directory, no configuration ───────────────────────────────
  // First: the facts below resolve a paper's venue preset in this same directory, so a wrong one
  // must be named HERE, not as a missing venue label two checks later.
  const venues = packageVenuesDir();
  check(
    "the venues directory is paperlint's own and holds paper-guards.tex",
    existsSync(join(venues, "paper-guards.tex")),
  );
  check(
    "🔴 with no TEXINPUTS set, the value ENDS in the separator — otherwise the system tree stops resolving",
    withTexInputs({}, [venues]).TEXINPUTS === `${venues}${delimiter}`,
  );
  check(
    "an existing TEXINPUTS is kept, after ours",
    withTexInputs({ TEXINPUTS: `/mine${delimiter}` }, [venues]).TEXINPUTS ===
      `${venues}${delimiter}/mine${delimiter}`,
  );

  // ── facts: parsed from the paper, not configured ──────────────────────────────────────
  check(
    "documentclass and options come from the parser",
    JSON.stringify(
      parseDocumentclass(
        "\\documentclass[sigconf, review]{acmart}\n\\begin{document}x\\end{document}",
      ),
    ) === JSON.stringify({ name: "acmart", options: ["sigconf", "review"] }),
  );
  check(
    "a \\documentclass inside a COMMENT is not the class",
    parseDocumentclass("% \\documentclass{fake}\n\\documentclass{article}\n")
      ?.name === "article",
  );
  check(
    "no \\documentclass — null, not a guess",
    parseDocumentclass("hello") === null,
  );
  const venued = paper("venued", {
    "paper.tex": CLEAN_TEX,
    "paperlint.json": JSON.stringify({
      extends: "paperlint:agenticdev",
      kind: "short",
    }),
    "build.sh": "exit 0\n",
  });
  const facts = readFacts(venued);
  check("the venue comes from paperlint.json", facts.venue === "agenticdev");
  check(
    "a leftover build.sh is a FACT (reported), not a step",
    JSON.stringify(facts.ignoredScripts) === JSON.stringify(["build.sh"]) &&
      IGNORED_SCRIPTS.includes("repro/build-submission.sh"),
  );

  // ── the plan ──────────────────────────────────────────────────────────────────────────
  const plan = planFor(facts);
  check(
    "the plan has one line per step, in order, each with a why",
    plan.map((p) => p.step).join(",") === STEPS.map((s) => s.name).join(",") &&
      plan.every((p) => p.why.length > 0),
  );
  check(
    "compile's why names the source, the class and the venue",
    /paper\.tex/.test(plan[1].why) &&
      /article/.test(plan[1].why) &&
      /agenticdev/.test(plan[1].why),
  );

  // ── pdflatex arguments ────────────────────────────────────────────────────────────────
  check(
    "every pass is nonstop, halts on error, and reports file:line",
    ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error"].every(
      (f) => pdflatexArgs(false).includes(f),
    ),
  );
  check(
    "the FINAL pass defines \\finalpass (the paper-guards switch) and keeps the job name",
    pdflatexArgs(true).includes("-jobname=paper") &&
      pdflatexArgs(true).at(-1) === "\\def\\finalpass{}\\input{paper.tex}",
  );

  // ── a clean build, with leftover scripts that must NOT run ────────────────────────────
  const clean = paper("clean", {
    "paper.tex": CLEAN_TEX,
    "build.sh": '#!/usr/bin/env bash\ntouch "$(dirname "$0")/RAN"\nexit 1\n',
    "repro/build-submission.sh":
      '#!/usr/bin/env bash\ntouch "$(dirname "$0")/../RAN2"\n',
  });
  const events = [];
  const tex = fakeTex();
  const r = await buildPaper(clean, {
    cwd: root,
    readPdf: fakeRead,
    run: (...a) => {
      events.push("run");
      return tex.run(...a);
    },
    env: ENV,
    log: (l) => events.push(l),
  });
  check("a clean paper builds", r.status === "built");
  check(
    "🔴 the paper's build scripts were NOT executed — no trace on disk",
    !existsSync(join(clean, "RAN")) && !existsSync(join(clean, "RAN2")),
  );
  check(
    "🔴 and nothing but pdflatex/bibtex was started",
    tex.calls.every((c) => c.bin === "pdflatex" || c.bin === "bibtex"),
  );
  check(
    "one line per ignored script tells the author it is ignored",
    events.filter(
      (e) =>
        e !== "run" && /is ignored — paperlint builds the paper itself/.test(e),
    ).length === 2,
  );
  check(
    "the plan is printed BEFORE anything runs",
    events.indexOf("run") >
      events.findIndex((e) => e !== "run" && e.startsWith("  compile:")),
  );
  check(
    "a stable aux: pass, pass, final pass — three pdflatex runs, the last one final",
    tex.calls.length === 3 &&
      tex.calls.at(-1).args.at(-1).includes("\\finalpass"),
  );
  check(
    "pdflatex runs IN the paper directory",
    tex.calls.every((c) => c.cwd === clean),
  );
  check(
    "🔴 pdflatex got paperlint's venues directory on TEXINPUTS, trailing separator kept",
    tex.calls.every((c) => c.texinputs === `${venues}${delimiter}`),
  );

  // ── the measure step: facts for the lint rules ────────────────────────────────────────
  const factsFile = join(clean, "_build", "paper.facts.json");
  check(
    "measure: the plan's measure step writes the facts, and says it judges nothing",
    r.plan.find((p) => p.step === "measure") !== undefined &&
      /pdf\.js → _build\/paper\.facts\.json/.test(
        r.plan.find((p) => p.step === "measure")?.why ?? "",
      ) &&
      /nothing is judged/.test(
        r.plan.find((p) => p.step === "measure")?.why ?? "",
      ),
  );
  check(
    "🔴 measure: a green build wrote _build/paper.facts.json through the readPdf port, on paper.pdf",
    existsSync(factsFile) && reads.includes(join(clean, "paper.pdf")),
  );
  if (existsSync(factsFile)) {
    const f = JSON.parse(readFileSync(factsFile, "utf8"));
    check(
      "measure: the facts are schema 2, about paper.pdf, with the last page's heights",
      f.schema === 2 &&
        f.pdf === "paper.pdf" &&
        JSON.stringify(f.last_page_cols_pt) === "[400,400]",
    );
  }
  check(
    "measure: the result line reports the facts file and the heights — a measurement, no verdict",
    (r.notes ?? []).some(
      (x) =>
        x.includes("facts: _build/paper.facts.json") &&
        x.includes("last page 400.0 / 400.0 pt"),
    ),
  );
  const unread = paper("unreadable-pdf", { "paper.tex": CLEAN_TEX });
  const ur = await buildPaper(unread, {
    cwd: root,
    readPdf: async () => ({
      ok: false,
      reason: "unreadable",
      detail: "InvalidPDFException: Invalid PDF structure.",
    }),
    run: fakeTex().run,
    env: ENV,
    log: quiet,
  });
  check(
    "🔴 measure: a PDF pdf.js cannot read FAILS the build at `measure`, and no facts are written",
    ur.status === "failed" &&
      ur.failure?.step === "measure" &&
      /could not read .*pdf\.js \(unreadable\)/.test(ur.failure.lines[0]) &&
      !existsSync(join(unread, "_build", "paper.facts.json")),
  );

  // ── the bibtex path ───────────────────────────────────────────────────────────────────
  const cited = paper("cited", {
    "paper.tex": CLEAN_TEX,
    "refs.bib": "@misc{k, title={T}}",
  });
  const btex = fakeTex({
    aux: "\\relax\n\\citation{k}\n\\bibstyle{plain}\n\\bibdata{refs}\n",
  });
  const rb = await buildPaper(cited, {
    cwd: root,
    readPdf: fakeRead,
    run: btex.run,
    env: ENV,
    log: quiet,
  });
  check("a paper with a \\cite builds", rb.status === "built");
  const bibCalls = btex.calls.filter((c) => c.bin === "bibtex");
  check(
    "bibtex ran exactly once, on the job name",
    bibCalls.length === 1 && bibCalls[0].args.join(" ") === "paper",
  );
  check(
    "…between two pdflatex passes, and the build still ends on the final pass",
    btex.calls[0].bin === "pdflatex" &&
      btex.calls[1].bin === "bibtex" &&
      btex.calls.at(-1).args.at(-1).includes("\\finalpass"),
  );

  // ── a failing build: the error, its context, and NO stale PDF ─────────────────────────
  const broken = paper("broken", {
    "paper.tex": CLEAN_TEX,
    "paper.pdf": "%PDF-stale-from-yesterday",
  });
  const ftex = fakeTex({
    exitCode: 1,
    log: [
      "(./paper.tex",
      "./paper.tex:4: Undefined control sequence.",
      "l.4 \\foo",
      "         bar baz ",
      "Here is how much of TeX's memory you used:",
    ].join("\n"),
  });
  const rf = await buildPaper(broken, {
    cwd: root,
    readPdf: fakeRead,
    run: ftex.run,
    env: ENV,
    log: quiet,
  });
  check(
    "a pdflatex error fails the build",
    rf.status === "failed" && anyFailed([rf]),
  );
  check(
    "🔴 the stale paper.pdf is DELETED — a red build cannot leave a PDF that looks current",
    !existsSync(join(broken, "paper.pdf")),
  );
  const shown = formatResult(rf);
  check(
    "the failure names the step and the program with its exit code",
    shown.includes("✗ compile: pdflatex exited with 1"),
  );
  check(
    "…quotes the first error line and the l.NNN context from the log",
    shown.includes("./paper.tex:4: Undefined control sequence.") &&
      shown.includes("l.4 \\foo") &&
      shown.includes("bar baz"),
  );
  check("…and says the PDF was removed", /paper\.pdf removed/.test(shown));
  check("a failed pass is not retried", ftex.calls.length === 1);

  // ── pdflatex dies before writing a log ────────────────────────────────────────────────
  // Seen 2026-09-26: a TeX Live whose pdflatex format was never built. pdflatex exits 1 having
  // printed the reason, and paper.log is either absent or left over from an earlier build.
  const nolog = paper("nolog", {
    "paper.tex": CLEAN_TEX,
    "paper.log": "./paper.tex:9: OLD ERROR FROM YESTERDAY\nl.9 \\old\n",
  });
  const dieTex = fakeTex({
    exitCode: 1,
    noLog: true,
    stdout:
      "This is pdfTeX, Version 3.141592653-2.6-1.40.28 (TeX Live 2026) (INITEX)\n" +
      "I can't find the format file `pdflatex.fmt'!\n",
  });
  const rn = await buildPaper(nolog, {
    cwd: root,
    readPdf: fakeRead,
    run: dieTex.run,
    env: ENV,
    log: quiet,
  });
  const shownN = formatResult(rn);
  // Guards: the reason pdflatex printed reaches the human when there is no log to quote.
  check(
    "🔴 no log: the failure shows what pdflatex printed",
    rn.status === "failed" && shownN.includes("I can't find the format file"),
    shownN,
  );
  // Guards: a log from an earlier build is never quoted as this build's error.
  check(
    "🔴 no log: a stale paper.log from an earlier build is not quoted",
    !shownN.includes("OLD ERROR FROM YESTERDAY"),
    shownN,
  );
  check(
    "no log: it does not point at a log file that this run did not write",
    !shownN.includes("full log:") && shownN.includes("wrote no paper.log"),
    shownN,
  );

  // ── pdflatex not installed ────────────────────────────────────────────────────────────
  const rm = await buildPaper(clean, {
    cwd: root,
    readPdf: fakeRead,
    run: fakeTex({ missing: true }).run,
    env: ENV,
    log: quiet,
  });
  check(
    "a missing pdflatex is a FAILURE that says what is missing, not a crash",
    rm.status === "failed" &&
      /pdflatex could not be started/.test(rm.failure.lines.join("\n")),
  );

  // ── 🔴 --dry-run runs NOTHING, checked by effect ──────────────────────────────────────
  const dryDir = paper("dry", {
    "paper.tex": CLEAN_TEX,
    "paper.pdf": "%PDF-untouched",
  });
  const dtex = fakeTex();
  const dryLog = [];
  const dry = await buildPaper(dryDir, {
    cwd: root,
    readPdf: fakeRead,
    run: dtex.run,
    env: ENV,
    dryRun: true,
    log: (l) => dryLog.push(l),
  });
  check("--dry-run: nothing was started", dtex.calls.length === 0);
  check(
    "--dry-run: the PDF on disk is untouched",
    readFileSync(join(dryDir, "paper.pdf"), "utf8") === "%PDF-untouched",
  );
  check(
    "--dry-run: nothing was measured and no facts were written",
    !reads.includes(join(dryDir, "paper.pdf")) &&
      !existsSync(join(dryDir, "_build")),
  );
  check(
    "--dry-run: the plan is printed, and the result says it did not run",
    dryLog.some((l) => l.startsWith("  compile: paper.tex")) &&
      dry.dry === true &&
      /--dry-run/.test(formatResult(dry)),
  );

  // ── no paper.tex: a REFUSAL, not a skip ───────────────────────────────────────────────
  const bare = paper("bare", { "paper.md": "# x" });
  const ntex = fakeTex();
  const nr = await buildPaper(bare, {
    cwd: root,
    readPdf: fakeRead,
    run: ntex.run,
    env: ENV,
    log: quiet,
  });
  check("no paper.tex — status no-source", nr.status === "no-source");
  check("🔴 and this COUNTS AS A FAILURE", anyFailed([nr]) === true);
  check("nothing was run for it", ntex.calls.length === 0);
  const compileLine = nr.plan.find((p) => p.step === "compile");
  check(
    "the compile step is required and did not apply",
    compileLine?.applies === false && compileLine?.required === true,
  );
  check(
    'the remedy says this is NOT "nothing to build" and names paper.tex',
    /NOT "nothing to build"/.test(remedyFor([nr])) &&
      /paper\.tex/.test(remedyFor([nr])),
  );
  check("on full success there is no remedy", remedyFor([r]) === "");

  // ── 🔴 A STALE PDF NEVER SURVIVES A RUN THAT DID NOT REPLACE IT — every path of buildPapers ──
  // The order matters for the battery: the up-front removal is killed by the no-engine case, the
  // existence check by the empty document, and neither case depends on the other defence.
  const REMOVED =
    "paper.pdf removed — a stale PDF must not pass for this build";

  // (b) no qualifying engine: the command stops before any paper is built.
  const noEng = paper("no-engine", {
    "paper.tex": CLEAN_TEX,
    "paper.pdf": "%PDF-stale-from-yesterday",
  });
  const neTex = fakeTex();
  const neLog = [];
  let pdfWhenEngineAsked = null;
  const ne = await buildPapers([noEng], {
    cwd: root,
    readPdf: fakeRead,
    run: neTex.run,
    env: ENV,
    log: (l) => neLog.push(l),
    engine: async () => {
      pdfWhenEngineAsked = existsSync(join(noEng, "paper.pdf"));
      return null;
    },
  });
  check(
    "🔴 no engine: the stale paper.pdf is removed BEFORE the engine is resolved",
    pdfWhenEngineAsked === false && !existsSync(join(noEng, "paper.pdf")),
  );
  check(
    "no engine: the run stops — nothing compiled, no results",
    ne.kind === "no-engine" && neTex.calls.length === 0,
  );
  check(
    "no engine: the run says so, with the line a failed build prints",
    neLog.includes(`papers/no-engine: ${REMOVED}`),
  );

  // (c) no paper.tex: refused, and a PDF left from some earlier build goes too.
  const bareStale = paper("bare-stale", {
    "paper.md": "# x",
    "paper.pdf": "%PDF-stale-from-yesterday",
  });
  const bsTex = fakeTex();
  const bsLog = [];
  const bs = await buildPapers([bareStale, bare], {
    cwd: root,
    readPdf: fakeRead,
    run: bsTex.run,
    env: ENV,
    log: (l) => bsLog.push(l),
    engine: async () => ENV,
  });
  check(
    "🔴 no-source: the stale paper.pdf is GONE",
    bs.kind === "ran" &&
      bs.results[0].status === "no-source" &&
      !existsSync(join(bareStale, "paper.pdf")),
  );
  check(
    "no-source: the refusal says the PDF was removed…",
    bsLog.includes(`  ✗ nothing to compile: no paper.tex\n      ${REMOVED}`),
  );
  check(
    "…and a paper that had no PDF is not told one was removed",
    bsLog.includes("  ✗ nothing to compile: no paper.tex") &&
      bs.results[1].staleRemoved === false,
  );

  // (d) --dry-run: no side effect, including this one.
  const dryStale = paper("dry-stale", {
    "paper.tex": CLEAN_TEX,
    "paper.pdf": "%PDF-untouched",
  });
  const dsTex = fakeTex();
  const ds = await buildPapers([dryStale], {
    cwd: root,
    readPdf: fakeRead,
    run: dsTex.run,
    env: ENV,
    dryRun: true,
    log: quiet,
    engine: async () => ENV,
  });
  // Read only if present: a deleted file must fail THIS assertion, not throw ENOENT before it.
  const bodyOf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  check(
    "🔴 buildPapers --dry-run: the PDF on disk is untouched, and nothing ran",
    bodyOf(join(dryStale, "paper.pdf")) === "%PDF-untouched" &&
      dsTex.calls.length === 0 &&
      ds.kind === "ran" &&
      ds.results[0].dry === true,
  );

  // A success replaces the stale PDF and says nothing about removing it.
  const fresh = paper("fresh", {
    "paper.tex": CLEAN_TEX,
    "paper.pdf": "%PDF-stale-from-yesterday",
  });
  const frLog = [];
  const fr = await buildPapers([fresh], {
    cwd: root,
    readPdf: fakeRead,
    run: fakeTex().run,
    env: ENV,
    log: (l) => frLog.push(l),
    engine: async () => ENV,
  });
  check(
    "a success: the PDF on disk is the one this run wrote, and nothing says 'removed'",
    fr.kind === "ran" &&
      fr.results[0].status === "built" &&
      bodyOf(join(fresh, "paper.pdf")) === "%PDF-fake" &&
      !frLog.some((l) => l.includes("removed")),
  );

  // (a) pdflatex exits 0 and writes no PDF — an empty document.
  const empty = paper("empty", {
    "paper.tex": "\\documentclass{article}\\begin{document}\\end{document}",
  });
  const emLog = [];
  const em = await buildPapers([empty], {
    cwd: root,
    readPdf: fakeRead,
    run: fakeTex({ noPdf: true }).run,
    env: ENV,
    log: (l) => emLog.push(l),
    engine: async () => ENV,
  });
  check(
    "🔴 empty document: pdflatex exit 0 with no PDF FAILS the build",
    em.kind === "ran" &&
      em.results[0].status === "failed" &&
      em.results[0].failure.step === "compile" &&
      anyFailed(em.results),
  );
  const emShown = emLog.join("\n");
  check(
    "empty document: no ✓, and the failure says what happened and asks the question",
    !emShown.includes("✓") &&
      emShown.includes(
        "✗ compile: pdflatex exited 0 but wrote no paper.pdf — does the document have any pages?",
      ),
  );

  // ── walking the corpus ────────────────────────────────────────────────────────────────
  paper("not-a-paper", { "NOTES.md": "x" });
  paper(".hidden-paper", { "PIPELINE-STATUS.md": "x" });
  const found = papersIn(join(root, "papers")).map((d) => d.split("/").pop());
  check(
    "a directory with no markers is not a paper",
    !found.includes("not-a-paper"),
  );
  check(
    "the real ones are",
    ["clean", "broken", "bare"].every((x) => found.includes(x)),
  );
  check(
    "a hidden directory is not a paper, even with a marker",
    !found.includes(".hidden-paper"),
  );
  check(
    "a nonexistent root does not crash",
    papersIn(join(root, "nope")).length === 0,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(
  `✓ ${String(n)} assertions passed — build: paperlint compiles, build.sh never runs, a red build leaves no PDF`,
);
