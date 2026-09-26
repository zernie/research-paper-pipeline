/**
 * `paperlint build <paper>` — paperlint compiles the paper ITSELF. A paper-supplied script is never run.
 *
 * 🔴 WHY paperlint OWNS THE BUILD, and why `build.sh` is now IGNORED rather than preferred. Until
 * issue #59 this command looked for `build.sh` / `repro/build-submission.sh` and ran it. Every
 * paper therefore carried its own copy of the same work — find the venue files, set `TEXINPUTS`,
 * run pdflatex and bibtex until the references settle — and the copies drifted: one set
 * `TEXINPUTS`, one did not; one printed the log on failure, one swallowed it; one left the old PDF
 * in place after a failed pass. A convention every author re-implements is a convention nobody
 * has. It lives here once, and a script found in the paper directory is named and ignored, so an
 * author who still has one is not surprised.
 *
 * ── THE SHAPE: an ordered list of STEPS, composed, not configured ────────────
 * Each step says whether it applies to THIS paper and why — decided from FACTS parsed out of the
 * paper (its `\documentclass` and options, the venue named in `paperlint.json`), never from a config
 * flag. `paperlint build` prints that plan before running anything, and `--dry-run` prints only the
 * plan. Adding a step is one entry in `STEPS`.
 *
 * ── AFTER A GREEN COMPILE, THE PDF IS MEASURED ──────────────────────────────
 * The `measure` step writes `_build/paper.facts.json` — page count, fonts, the last page's columns —
 * through `writeFacts` (`facts-file.ts`), the one writer of that file. It judges nothing; the lint
 * rules read the file. The PDF is read with pdf.js through the `readPdf` port, so a test hands the
 * build any outcome and nothing needs poppler.
 *
 * ── WHAT THE BUILD DOES NOT DO: JUDGE THE LAYOUT ───────────────────────────
 * Until 2026-09-24 a third step searched for a `\balance` position that evened out the last page's
 * columns, rebuilding once per `\bibitem`, and failed the build (deleting the PDF) when none worked.
 * It was removed: only some venues require a balanced last page, every mechanism for producing one
 * is documented by its own authors as unreliable, and a build step has no severity, no suppression
 * and no per-venue switch. Balance is now an optional lint rule over the facts this build writes
 * (`pdf/last-page-balance`, off unless the consumer turns it on).
 *
 * ── WHAT IS PURE AND WHAT IS NOT ─────────────────────────────────────────────
 * The decision of the LaTeX loop is `latex-loop.ts`, reading the log is `latex-log.ts`; both are
 * pure. This file is the shell: it runs processes through the injected `run` (the existing port —
 * `spawnSync` by default) and reads the files a pass left behind. Where paperlint's own files live is
 * answered by `consumer.mjs`, the one module allowed to know it (rule 10).
 */
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { delimiter, join, relative } from "node:path";
// eslint-disable-next-line boundaries/dependencies -- legacy layer, moves behind a port in #76
import { getParser } from "@unified-latex/unified-latex-util-parse";
import { packageVenuesDir } from "../skills/paper-pipeline/scripts/consumer.mjs";
import { CONFIG_FILE } from "../lib/paper-config.mjs";
import {
  declaredVenue,
  factsPath,
  measurePaper,
  writeFactsFile,
  FACTS_DIR,
  FACTS_FILE,
  type FactsDocument,
} from "./facts-file.ts";
import { readPdf as pdfjsReader, type PdfReader } from "./pdf-facts.ts";
// eslint-disable-next-line boundaries/dependencies -- legacy layer, moves behind a port in #76
import { banalMeasurer, parseBanalSettings } from "./adapters/banal/index.ts";
// eslint-disable-next-line boundaries/dependencies -- legacy layer, moves behind a port in #76
import { hostDirs, nodeAdapters, nodeFiles } from "./adapters/node/index.ts";
import { whyNoGeometry } from "./domain/geometry.ts";
import type { AbsolutePath } from "./domain/paths.ts";
import type { Files } from "./ports/files.ts";
import type { MeasureGeometry } from "./ports/measure-geometry.ts";
import type { CheckReferences } from "./ports/check-references.ts";
import { recordReferences, REFERENCES_FILE } from "./references.ts";
import {
  auxBib,
  bibtexExcerpt,
  errorExcerpt,
  logMarkers,
  unwrapLog,
} from "./latex-log.ts";
import {
  nextStep,
  summarize,
  TRACKED,
  type BibInput,
  type Hashes,
  type Observation,
  type Step,
} from "./latex-loop.ts";
import type { BuildResult, PlanLine } from "./types.ts";

/** A directory counts as a paper by the same markers as `structure.ts` — one shared dictionary. */
export const PAPER_MARKERS = [
  "PIPELINE-STATUS.md",
  "paper.tex",
  "paper.md",
  CONFIG_FILE,
];

/** The source paperlint compiles, and the job name every output file carries. */
export const MAIN = "paper.tex";
export const JOB = "paper";

/**
 * Scripts that `paperlint build` USED to run. Their presence is reported and nothing more: running a
 * file from the paper directory is exactly what this command stopped doing.
 */
export const IGNORED_SCRIPTS = ["build.sh", "repro/build-submission.sh"];

/** The pdflatex flags: never stop for input, stop at the first error, and say file:line. */
export const PDFLATEX_FLAGS = [
  "-interaction=nonstopmode",
  "-halt-on-error",
  "-file-line-error",
];

/** Everything the steps may know about a paper — parsed from it, not configured. */
export interface PaperFacts {
  /** `paper.tex` when it exists, else null. */
  readonly main: string | null;
  readonly documentclass: {
    readonly name: string;
    readonly options: readonly string[];
  } | null;
  /** The label of the venue preset `paperlint.json` extends, or null. */
  readonly venue: string | null;
  /** Paper-supplied build scripts found on disk — reported as ignored. */
  readonly ignoredScripts: readonly string[];
}

/** A process runner with `spawnSync`'s shape — the port the harness replaces. */
export type Runner = typeof spawnSync;

/** What a step's `run` receives. `env` is the environment accumulated by the steps before it. */
export interface BuildContext {
  readonly paperDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly run: Runner;
  /** Reads a finished PDF — pdf.js by default; the harness passes a fake. */
  readonly readPdf: PdfReader;
  /** The page-geometry measurer the facts writer uses. */
  readonly measure: MeasureGeometry;
  /** Where the facts file is written. */
  readonly files: Files;
  /** The online reference checks; the CLI wires the real ones, a test passes a function. */
  readonly checkReferences: CheckReferences;
}

export type StepOutcome =
  | {
      readonly ok: true;
      readonly env?: NodeJS.ProcessEnv;
      readonly note?: string;
    }
  | { readonly ok: false; readonly lines: readonly string[] };

export interface BuildStep {
  readonly name: string;
  /** A required step REFUSES the build when it does not apply; an optional one is skipped. */
  readonly required: boolean;
  applies(facts: PaperFacts): { yes: boolean; why: string };
  run(ctx: BuildContext): StepOutcome | Promise<StepOutcome>;
}

// ── facts ───────────────────────────────────────────────────────────────────────────────

/**
 * unified-latex's own AST types, reached through the parser this package declares. The types
 * package behind it is a transitive dependency, and importing it by name would be depending on it
 * without declaring it.
 */
type LatexRoot = ReturnType<ReturnType<typeof getParser>["parse"]>;
type LatexNode = LatexRoot["content"][number];
type LatexArgument = NonNullable<
  Extract<LatexNode, { type: "macro" }>["args"]
>[number];

type LatexMacro = Extract<LatexNode, { type: "macro" }>;

/** `node` is a call of the macro `\name`. */
const isMacro = (
  node: LatexNode | LatexArgument,
  name: string,
): node is LatexMacro => node.type === "macro" && node.content === name;

/** The concatenated text of a unified-latex argument node. */
function argText(arg: LatexArgument | undefined): string {
  return (arg?.content ?? [])
    .map((n) =>
      n.type === "string" ? n.content : n.type === "whitespace" ? " " : "",
    )
    .join("");
}

/** A unified-latex AST, or null when the text does not parse. */
function parseTex(tex: string): LatexRoot | null {
  try {
    return getParser().parse(tex);
  } catch {
    return null;
  }
}

/**
 * `\documentclass[opts]{name}`, read by the unified-latex parser the lint rules already use —
 * so a `\documentclass` inside a comment is a comment, not a class.
 */
export function parseDocumentclass(tex: string): PaperFacts["documentclass"] {
  return documentclassOf(parseTex(tex));
}

function documentclassOf(ast: LatexRoot | null): PaperFacts["documentclass"] {
  const node = (ast?.content ?? []).find((n): n is LatexMacro =>
    isMacro(n, "documentclass"),
  );
  if (!node) return null;
  const args = node.args ?? [];
  const name = argText(args.find((a) => a.openMark === "{")).trim();
  if (!name) return null;
  const options = argText(args.find((a) => a.openMark === "["))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { name, options };
}

export function readFacts(paperDir: string): PaperFacts {
  const mainPath = join(paperDir, MAIN);
  const main = existsSync(mainPath) ? MAIN : null;
  const venue = declaredVenue(nodeFiles, paperDir);
  const ast = main ? parseTex(readFileSync(mainPath, "utf8")) : null;
  return {
    main,
    documentclass: documentclassOf(ast),
    venue: venue?.label ?? null,
    ignoredScripts: IGNORED_SCRIPTS.filter((s) =>
      existsSync(join(paperDir, s)),
    ),
  };
}

// ── step: inputs ────────────────────────────────────────────────────────────────────────

/**
 * `TEXINPUTS` with `dirs` in front. With nothing set before, the value ENDS in the separator, and
 * that is load-bearing: an empty element tells kpathsea "and then the system tree", so without it
 * `article.cls` stops resolving. A value the user already set is kept as they wrote it.
 */
export function withTexInputs(
  env: NodeJS.ProcessEnv,
  dirs: readonly string[],
): NodeJS.ProcessEnv {
  return {
    ...env,
    TEXINPUTS: [...dirs, env.TEXINPUTS ?? ""].join(delimiter),
  };
}

export const inputsStep: BuildStep = {
  name: "inputs",
  required: false,
  applies: () => ({
    yes: true,
    why: `TEXINPUTS += ${packageVenuesDir()}`,
  }),
  run: (ctx) => ({
    ok: true,
    env: withTexInputs(ctx.env, [packageVenuesDir()]),
  }),
};

// ── step: compile ───────────────────────────────────────────────────────────────────────

const sha = (buf: Buffer): string =>
  createHash("sha256").update(buf).digest("hex");

function hashes(paperDir: string): Hashes {
  const h = (ext: string): string | null => {
    const p = join(paperDir, `${JOB}.${ext}`);
    return existsSync(p) ? sha(readFileSync(p)) : null;
  };
  const out: Record<string, string | null> = {};
  for (const t of TRACKED) out[t] = h(t);
  return out as Hashes;
}

const readOr = (path: string, enc: BufferEncoding): string | null =>
  existsSync(path) ? readFileSync(path, enc) : null;

/** What bibtex would be run on, as the `.aux` stands now. */
export function bibInput(paperDir: string): BibInput {
  const aux = readOr(join(paperDir, `${JOB}.aux`), "utf8");
  if (aux === null) return { kind: "none" };
  const bib = auxBib(aux, (name) => readOr(join(paperDir, name), "utf8"));
  if (bib.databases.length === 0) return { kind: "none" };
  const files = bib.databases
    .map((d) => join(paperDir, d.endsWith(".bib") ? d : `${d}.bib`))
    .filter((p) => existsSync(p));
  return {
    kind: "needed",
    citations: bib.citations,
    databases: bib.databases,
    style: bib.style,
    bibHash: files.length
      ? sha(Buffer.concat(files.map((p) => readFileSync(p))))
      : null,
  };
}

/** pdflatex arguments for a pass. The final pass defines `\finalpass` — see `latex-loop.ts`. */
export function pdflatexArgs(final: boolean): string[] {
  return final
    ? [
        ...PDFLATEX_FLAGS,
        `-jobname=${JOB}`,
        `\\def\\finalpass{}\\input{${MAIN}}`,
      ]
    : [...PDFLATEX_FLAGS, MAIN];
}

const notInstalled = (bin: string): string[] => [
  `${bin} could not be started — it is not installed, or not on PATH.`,
  `paperlint compiles with TeX Live's pdflatex and bibtex: see docs/toolchain.md.`,
];

/** The log was read byte for byte to count TeX's columns; show it to a human as UTF-8. */
const fromLatin1 = (s: string): string =>
  Buffer.from(s, "latin1").toString("utf8");

type Terminal = Extract<Step, { kind: "done" } | { kind: "fail" }>;

/** How every pass is spawned: in the paper directory, output read byte for byte (`fromLatin1`). */
function spawnOptions(ctx: BuildContext) {
  return {
    cwd: ctx.paperDir,
    env: ctx.env,
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    encoding: "latin1" as const,
    maxBuffer: 64 * 1024 * 1024,
  };
}

type SpawnOptions = ReturnType<typeof spawnOptions>;

const cannotStart = (step: "latex" | "bibtex"): Terminal => ({
  kind: "fail",
  step,
  cause: { kind: "exit", code: 127 },
  lines: notInstalled(step === "latex" ? "pdflatex" : "bibtex"),
});

/** One pdflatex pass and what it left behind, or null when pdflatex could not be started. */
function latexPass(
  ctx: BuildContext,
  final: boolean,
  opts: SpawnOptions,
): Observation | null {
  const before = hashes(ctx.paperDir);
  const r = ctx.run("pdflatex", pdflatexArgs(final), opts);
  if (r.error) return null;
  const exitCode = r.status ?? 1;
  const written = readOr(join(ctx.paperDir, `${JOB}.log`), "latin1");
  const log = unwrapLog(written ?? "");
  return {
    step: "latex",
    final,
    exitCode,
    before,
    after: hashes(ctx.paperDir),
    markers: logMarkers(log),
    bib: bibInput(ctx.paperDir),
    errorLines:
      exitCode === 0
        ? []
        : written === null
          ? printed(r)
          : errorExcerpt(log).map(fromLatin1),
  };
}

/**
 * The last lines pdflatex printed, for the run that wrote no log — it died before opening one (a
 * format it cannot load, a missing TeX Live file). Marked by NO_LOG, which the report keys on.
 */
function printed(r: { stdout?: unknown; stderr?: unknown }): string[] {
  const lines = fromLatin1(
    `${String(r.stdout ?? "")}\n${String(r.stderr ?? "")}`,
  )
    .split("\n")
    .filter((l) => l.trim());
  return [NO_LOG, ...lines.slice(-8).map((l) => `  ${l}`)];
}

const NO_LOG = `pdflatex wrote no ${JOB}.log — the last lines it printed:`;

/** One bibtex run, on the input the `.aux` names BEFORE it runs, or null when it could not start. */
function bibtexPass(ctx: BuildContext, opts: SpawnOptions): Observation | null {
  const before = hashes(ctx.paperDir);
  const bib = bibInput(ctx.paperDir);
  const r = ctx.run("bibtex", [JOB], opts);
  if (r.error) return null;
  const exitCode = r.status ?? 1;
  return {
    step: "bibtex",
    exitCode,
    before,
    after: hashes(ctx.paperDir),
    bib,
    errorLines:
      exitCode === 0 ? [] : bibtexExcerpt(fromLatin1(String(r.stdout ?? ""))),
  };
}

/** Run the loop until `nextStep` says done or fail. */
export function compile(ctx: BuildContext): {
  end: Terminal;
  latex: number;
  bibtex: number;
} {
  const history: Observation[] = [];
  const opts = spawnOptions(ctx);
  // Every log this loop reads is one its own pdflatex wrote. A pdflatex that dies before opening
  // paper.log would otherwise have an earlier build's error quoted as this one's.
  rmSync(join(ctx.paperDir, `${JOB}.log`), { force: true });
  const runs = { latex: 0, bibtex: 0 };
  for (;;) {
    const step = nextStep(summarize(history));
    if (step.kind === "done" || step.kind === "fail")
      return { end: step, ...runs };
    runs[step.kind]++;
    const seen =
      step.kind === "latex"
        ? latexPass(ctx, step.final, opts)
        : bibtexPass(ctx, opts);
    if (seen === null) return { end: cannotStart(step.kind), ...runs };
    history.push(seen);
  }
}

const NO_PDF = `pdflatex exited 0 but wrote no ${JOB}.pdf — does the document have any pages?`;

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export const compileStep: BuildStep = {
  name: "compile",
  required: true,
  applies: (facts) => {
    if (!facts.main)
      return {
        yes: false,
        why: `no ${MAIN}; paperlint compiles LaTeX, and this paper has none`,
      };
    const dc = facts.documentclass;
    const cls = dc
      ? `\\documentclass${dc.options.length ? `[${dc.options.join(",")}]` : ""}{${dc.name}}`
      : "no \\documentclass found";
    const venue = facts.venue ? `, venue ${facts.venue}` : "";
    return { yes: true, why: `${facts.main} (${cls}${venue})` };
  },
  run: (ctx) => {
    const { end, latex, bibtex } = compile(ctx);
    if (end.kind === "fail") {
      const bin = end.step === "latex" ? "pdflatex" : "bibtex";
      const where =
        end.cause.kind === "exit"
          ? `${bin} exited with ${end.cause.code}`
          : `${bin} did not converge`;
      const log = join(
        ctx.paperDir,
        `${JOB}.${end.step === "latex" ? "log" : "blg"}`,
      );
      return {
        ok: false,
        lines: [
          where,
          ...(end.lines.length
            ? end.lines
            : ["(no error line found in the log)"]),
          ...(end.lines[0] === NO_LOG ? [] : [`full log: ${log}`]),
        ],
      };
    }
    // 🔴 EXIT 0 IS NOT A PDF. pdflatex on a document with no pages prints "No pages of output."
    // and exits 0. Existence is enough to know THIS run wrote it: `buildPapers` deleted paper.pdf
    // before anything ran, so no timestamp comparison is needed. Checked here, in the step that
    // wrote it, so a later step that reads the PDF never sees this case as its own failure.
    if (!existsSync(join(ctx.paperDir, `${JOB}.pdf`)))
      return {
        ok: false,
        lines: [NO_PDF, `full log: ${join(ctx.paperDir, `${JOB}.log`)}`],
      };
    const warn = end.warnings.length
      ? ` — ⚠️ the final log still reports ${end.warnings.join(", ")}`
      : "";
    return {
      ok: true,
      note: `${plural(latex, "pdflatex pass", "pdflatex passes")}, ${plural(bibtex, "bibtex run", "bibtex runs")}${warn}`,
    };
  },
};

// ── step: measure ───────────────────────────────────────────────────────────────────────

const columnsNote = (f: FactsDocument): string => {
  const p = f.last_page;
  if (p.kind === "measured")
    return `last page ${p.columns_pt[0].toFixed(1)} / ${p.columns_pt[1].toFixed(1)} pt`;
  return p.kind === "review"
    ? "last page has numbered lines (a review build), not measured"
    : `last page has ${plural(p.words, "word", "words")}, too few to measure`;
};

/**
 * Measure the PDF the compile step wrote and write `_build/paper.facts.json`. A PDF pdf.js cannot
 * read fails the build: a PDF nothing can measure is not one to hand in. banal (page geometry) is
 * optional here: without it the geometry fields are null and the build still succeeds — but the
 * note SAYS so, with the command that installs it (`paperlint toolchain`), because null geometry means
 * the page-size, column and font-size rules have nothing to judge. A banal that fails is named too.
 */
export const measureStep: BuildStep = {
  name: "measure",
  required: false,
  applies: (facts) =>
    facts.main
      ? {
          yes: true,
          why: `pdf.js → ${FACTS_DIR}/${FACTS_FILE} (facts for the lint rules; nothing is judged here)`,
        }
      : { yes: false, why: "nothing is compiled" },
  run: async (ctx) => {
    const m = await measurePaper(
      ctx.paperDir,
      join(ctx.paperDir, `${JOB}.pdf`),
      {
        readPdf: ctx.readPdf,
        measure: ctx.measure,
        files: ctx.files,
      },
    );
    if (!m.ok) return { ok: false, lines: [m.error] };
    writeFactsFile(ctx.files, ctx.paperDir, m.value.facts);
    const g = m.value.geometry;
    const banal =
      g.kind === "unmeasured"
        ? `; page geometry not measured — ${whyNoGeometry(g)}`
        : "";
    return {
      ok: true,
      note: `facts: ${relative(ctx.paperDir, factsPath(ctx.paperDir))}, ${columnsNote(m.value.facts)}${banal}`,
    };
  },
};

// ── step: references ────────────────────────────────────────────────────────────────────

/**
 * Check the bibliography online — the cited work exists and its title matches (verify-cites), its
 * authors are the published version's (bib-authors) — and record the verdicts in
 * `_build/references.json` for the offline lint rules (`reference-rules.ts`). OPTIONAL and NEVER
 * FAILING: without network the PDF is still built, and the record says `not-checked`.
 */
export const referencesStep: BuildStep = {
  name: "references",
  required: false,
  applies: (facts) =>
    facts.main
      ? {
          yes: true,
          why: `online: citations exist, titles and authors match → ${FACTS_DIR}/${REFERENCES_FILE} (never fails the build)`,
        }
      : { yes: false, why: "nothing is compiled" },
  run: async (ctx) => ({
    ok: true,
    note: await recordReferences(ctx.files, ctx.paperDir, ctx.checkReferences),
  }),
};

/** The build, in order. A new step is one entry here. */
export const STEPS: readonly BuildStep[] = [
  inputsStep,
  compileStep,
  measureStep,
  referencesStep,
];

// ── the command ─────────────────────────────────────────────────────────────────────────

export function planFor(
  facts: PaperFacts,
  steps: readonly BuildStep[] = STEPS,
): PlanLine[] {
  return steps.map((s) => {
    const a = s.applies(facts);
    return { step: s.name, applies: a.yes, required: s.required, why: a.why };
  });
}

export function formatPlan(plan: readonly PlanLine[]): string[] {
  const state = (p: PlanLine): string =>
    p.applies ? "" : p.required ? "refused — " : "skipped — ";
  return plan.map((p) => `  ${p.step}: ${state(p)}${p.why}`);
}

/**
 * 🔴 A FAILED BUILD LEAVES NO PDF. An old paper.pdf beside a red build looks current, and "the PDF
 * is there" is exactly what a human checks first. Returns whether there was one.
 */
function removePdf(paperDir: string): boolean {
  const pdf = join(paperDir, `${JOB}.pdf`);
  const was = existsSync(pdf);
  rmSync(pdf, { force: true });
  return was;
}

/** The one wording for "the PDF is gone", on every path that ends without a new one. */
export const PDF_REMOVED = `${JOB}.pdf removed — a stale PDF must not pass for this build`;

export interface BuildOptions {
  run?: Runner;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  steps?: readonly BuildStep[];
  log?: (line: string) => void;
  dryRun?: boolean;
  readPdf?: PdfReader;
  /** Where a project's `vendor/banal` is looked for. Default: `$CLAUDE_PROJECT_DIR`, else `cwd`. */
  projectRoot?: string;
  /** The page-geometry measurer. Default: banal, as `env` and `projectRoot` configure it. */
  measure?: MeasureGeometry;
  /** Where the facts file is written. Default: the disk. */
  files?: Files;
  /**
   * The online reference checks. Default: none — the record then says `not-checked`, and lint
   * warns. The CLI passes the real ones (`adapters/references`).
   */
  checkReferences?: CheckReferences;
}

/**
 * The options with their defaults. Destructuring defaults and not a spread over a defaults object:
 * an option passed as `undefined` (the CLI passes `dryRun: a.dryRun`) must still get its default.
 */
function baseDefaults({
  run = spawnSync,
  // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
  cwd = process.cwd(),
  // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
  env = process.env,
  steps = STEPS,
  log = console.log,
  // 🔴 `--dry-run` must be a DECLARED option here, not only in the CLI: options destructuring
  // swallows an unknown key silently, and the first version of this flag ran a full build and
  // rewrote paper.pdf while looking like a verbose dry run.
  dryRun = false,
  readPdf = pdfjsReader,
  projectRoot = env["CLAUDE_PROJECT_DIR"] || cwd,
}: BuildOptions): Required<
  Omit<BuildOptions, "measure" | "files" | "checkReferences">
> {
  return { run, cwd, env, steps, log, dryRun, readPdf, projectRoot };
}

/** Without a checker the record says so — never a pass. The CLI wires the real one. */
const notWired: CheckReferences = async () => ({
  kind: "not-checked",
  why: "no reference checker was wired into this build",
});

/** banal as the measurer, wired from the build's environment: the one piece of root work left here (#76). */
function defaultMeasurer(
  b: Required<Omit<BuildOptions, "measure" | "files" | "checkReferences">>,
): MeasureGeometry {
  const dirs = hostDirs({ cwd: b.cwd });
  return banalMeasurer(
    nodeAdapters({ tmpDir: dirs.tmp }),
    parseBanalSettings(b.env, dirs),
    b.projectRoot as AbsolutePath,
  );
}

/** `baseDefaults`, plus the measurer and the files — the real ones, from the environment, unless passed. */
function withDefaults(o: BuildOptions): Required<BuildOptions> {
  const base = baseDefaults(o);
  const measure = o.measure ?? defaultMeasurer(base);
  return {
    ...base,
    measure,
    files: o.files ?? nodeFiles,
    checkReferences: o.checkReferences ?? notWired,
  };
}

/** Run the applicable steps in order, each on the environment the steps before it left. */
async function runSteps(
  paperDir: string,
  dir: string,
  plan: PlanLine[],
  {
    run,
    env,
    steps,
    readPdf,
    measure,
    files,
    checkReferences,
  }: Required<BuildOptions>,
): Promise<BuildResult> {
  let stepEnv = env;
  const notes: string[] = [];
  for (const [i, step] of steps.entries()) {
    if (!plan[i]?.applies) continue;
    const out = await step.run({
      paperDir,
      env: stepEnv,
      run,
      readPdf,
      measure,
      files,
      checkReferences,
    });
    if (!out.ok) {
      // The PDF THIS run wrote and the step then rejected (a partial pass).
      // A PDF from an earlier run is already gone — `buildPapers` removed it before anything ran.
      removePdf(paperDir);
      return {
        dir,
        status: "failed",
        plan,
        failure: { step: step.name, lines: [...out.lines] },
      };
    }
    if (out.env) stepEnv = out.env;
    if (out.note) notes.push(out.note);
  }
  return { dir, status: "built", plan, ...(notes.length ? { notes } : {}) };
}

export async function buildPaper(
  paperDir: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const o = withDefaults(options);
  const { cwd, steps, log, dryRun } = o;
  const dir = relative(cwd, paperDir) || paperDir;
  log(dir);
  let facts: PaperFacts;
  try {
    facts = readFacts(paperDir);
  } catch (e) {
    return {
      dir,
      status: "failed",
      plan: [],
      failure: { step: "facts", lines: [(e as Error).message] },
    };
  }
  for (const s of facts.ignoredScripts)
    log(`  note: ${s} is ignored — paperlint builds the paper itself`);
  const plan = planFor(facts, steps);
  for (const line of formatPlan(plan)) log(line);

  if (plan.some((p) => !p.applies && p.required))
    return { dir, status: "no-source", plan };
  if (dryRun) return { dir, status: "built", plan, dry: true };
  return runSteps(paperDir, dir, plan, o);
}

/** A command's run over its targets: stopped before any paper for want of an engine, or ran. */
export type BuildRun =
  | { readonly kind: "no-engine" }
  | { readonly kind: "ran"; readonly results: readonly BuildResult[] };

/**
 * `paperlint build` over its targets — the ONE path every outcome goes through.
 *
 * 🔴 A STALE PDF IS REMOVED HERE, FIRST, AND NOWHERE ELSE. Before the engine is resolved and before
 * any step, every targeted paper's paper.pdf goes. Then no outcome can leave an old PDF looking
 * current, including the ones that never reach a step: no qualifying TeX Live, no paper.tex, facts
 * that do not parse. Removing it per failure path instead is how three of those paths once kept it.
 * `--dry-run` removes nothing: a plan has no side effects.
 */
export async function buildPapers(
  targets: readonly string[],
  {
    engine,
    ...options
  }: BuildOptions & { engine: () => Promise<NodeJS.ProcessEnv | null> },
): Promise<BuildRun> {
  const { cwd, log, dryRun } = withDefaults(options);
  const stale = new Set(dryRun ? [] : targets.filter(removePdf));
  const env = await engine();
  if (env === null) {
    for (const t of stale) log(`${relative(cwd, t) || t}: ${PDF_REMOVED}`);
    return { kind: "no-engine" };
  }
  const results: BuildResult[] = [];
  for (const t of targets) {
    const r = {
      ...(await buildPaper(t, { ...options, env })),
      staleRemoved: stale.has(t),
    };
    log(formatResult(r));
    results.push(r);
  }
  return { kind: "ran", results };
}

/** Immediate subdirectories that look like a paper. Hidden ones are not papers. */
export function papersIn(
  root: string,
  markers: readonly string[] = PAPER_MARKERS,
): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(root, e.name))
      .filter((d) => markers.some((m) => existsSync(join(d, m))));
  } catch {
    return [];
  }
}

/**
 * The verdict for one paper, printed under its plan.
 *
 *   ✗ compile: pdflatex exited with 1
 *       ./paper.tex:4: Undefined control sequence.
 *       l.4 \foo
 *                bar baz
 *       full log: …/paper.log
 *       paper.pdf removed — a stale PDF must not pass for this build
 */
export function formatResult(r: BuildResult): string {
  if (r.status === "built")
    return r.dry
      ? `  – not run (--dry-run)`
      : `  ✓ ${JOB}.pdf${r.notes?.length ? ` — ${r.notes.join("; ")}` : ""}`;
  return r.status === "failed" ? formatFailure(r) : formatRefusal(r);
}

/** Always says the PDF is gone: this run may have written one and rejected it. */
function formatFailure(r: BuildResult): string {
  const [head, ...rest] = r.failure?.lines ?? ["failed"];
  return [
    `  ✗ ${r.failure?.step ?? "build"}: ${head}`,
    ...rest.map((l) => `      ${l}`),
    `      ${PDF_REMOVED}`,
  ].join("\n");
}

/** Says the PDF is gone only when there was one — a paper with no paper.tex usually has none. */
function formatRefusal(r: BuildResult): string {
  const refused = `  ✗ nothing to compile: no ${MAIN}`;
  return r.staleRemoved ? `${refused}\n      ${PDF_REMOVED}` : refused;
}

export function formatResults(results: readonly BuildResult[]): string {
  return results.map(formatResult).join("\n");
}

/**
 * 🔴 "Nothing to compile" COUNTS AS A REFUSAL on a par with a failed build. Failing to tell these
 * two apart is what once produced a green run over a paper no job had built.
 */
export const anyFailed = (results: readonly BuildResult[]): boolean =>
  results.some((r) => r.status !== "built");

export function remedyFor(results: readonly BuildResult[]): string {
  const missing = results.filter((r) => r.status === "no-source");
  if (missing.length === 0) return "";
  return (
    `\nNo ${MAIN} in: ${missing.map((r) => r.dir).join(", ")}.\n` +
    `This is NOT "nothing to build" — paperlint compiles LaTeX, and these papers have no LaTeX source.\n` +
    `Write the paper in ${MAIN}; \`paperlint new <name>\` creates one.`
  );
}
