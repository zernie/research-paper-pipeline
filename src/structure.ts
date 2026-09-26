/**
 * `paperlint lint` — the half ESLint cannot do BY CONSTRUCTION: checking that the required file
 * IS THERE.
 *
 * 🔴 WHY THIS IS A SEPARATE MODULE AND NOT A RULE. A rule is invoked for a file that was handed
 * to the linter. A file that does not exist is never handed over — so the rule is not invoked,
 * and, not having been invoked, it physically cannot report the absence. A paper directory with
 * no `PIPELINE-STATUS.md` yields NOT ONE finding: not a single pipeline rule runs over it, and
 * the run is green. This is exactly the green zero the `nothing was linted` guard in the CLI
 * stands for, only one level down — not "nothing was linted", but "not everything here was".
 *
 * ⚠️ THIS IS NOT ls-lint's JOB, AND THE TWO ARE NOT INTERCHANGEABLE. ls-lint judges the NAMES of
 * files that exist (`versions/2026-07-22-submitted.pdf` is named to the scheme). About a file
 * that does not exist it says nothing — it has nothing to match. The two halves of structure:
 *     ls-lint      — "what is there is named correctly"
 *     this module  — "what is required is there"
 *
 * 🔴 DETECTION IS GENEROUS, REQUIREMENTS ARE STRICT — and this is for the sake of false positives.
 * An error-level rule that fails on a correct tree does not get fixed, it gets turned off, and the
 * real findings go with it. So a directory counts as a paper only if it ALREADY holds at least one
 * pipeline marker; `research/`, `plans/` and the other neighbours in the corpus are not touched at
 * all.
 */
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { readdirSync, existsSync } from "node:fs";
import { join, relative, basename, isAbsolute, sep } from "node:path";
import type { StructureConfig, StructureFinding } from "./types.ts";
import { CONFIG_FILE } from "../lib/paper-config.mjs";

/** The requirements after the consumer's config is laid over the defaults. */
type Rules = Required<StructureConfig>;

/**
 * The defaults are MEASURED against a live corpus of five paper directories, not picked by taste:
 * under them it passes in full — zero findings. The counter-case was run too: `paper.pdf` added to
 * `require` yields two findings straight away on papers that are perfectly fine — two of the four
 * keep their pdf under a different name. That is why it is not in the defaults; declared pdfs are
 * byte-compared by the `paper/stages` rule anyway.
 */
export const STRUCTURE_DEFAULTS = {
  markers: ["PIPELINE-STATUS.md", "paper.tex", "paper.md", CONFIG_FILE],
  require: ["PIPELINE-STATUS.md"],
  requireOneOf: [["paper.tex", "paper.md"]],
  ignore: [],
};

/** The consumer's config over the defaults; `structure: false` turns the check off entirely. */
export function structureRules(
  structure: StructureConfig | false | undefined,
): Rules | null {
  if (structure === false) return null;
  return { ...STRUCTURE_DEFAULTS, ...(structure ?? {}) };
}

const dirsIn = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    // A non-existent directory is not our concern: the empty-set guard says so loudly.
    return [];
  }
};

/**
 * @returns {{file: string, message: string}[]} findings, one per missing file.
 */
export function checkStructure(
  paths: readonly string[],
  structure: StructureConfig | false | undefined,
  // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
  { cwd = process.cwd() }: { cwd?: string } = {},
): StructureFinding[] {
  const rules = structureRules(structure);
  if (!rules) return [];
  const findings: StructureFinding[] = [];
  // Relative to where the command was typed — unless the paper lives outside it (#48): then the
  // absolute path, not a ladder of `../../../` that has to be counted to be read.
  const say = (p: string): string => {
    const rel = relative(cwd, p);
    return rel &&
      rel !== ".." &&
      !rel.startsWith(`..${sep}`) &&
      !isAbsolute(rel)
      ? rel
      : p;
  };

  for (const root of paths) {
    for (const name of dirsIn(root)) {
      if (rules.ignore.includes(name)) continue;
      const dir = join(root, name);

      // Generous detection: with not one marker this is just a neighbour directory, not a paper.
      if (!rules.markers.some((m: string) => existsSync(join(dir, m))))
        continue;

      for (const required of rules.require)
        if (!existsSync(join(dir, required)))
          findings.push({
            file: say(dir),
            message: `missing \`${required}\` — ${whyMissingMatters(required, basename(dir))}`,
          });

      for (const group of rules.requireOneOf)
        if (!group.some((f: string) => existsSync(join(dir, f))))
          findings.push({
            file: say(dir),
            message: `missing all of ${group.map((f: string) => `\`${f}\``).join(", ")} — a paper directory with no source is not something the rules can check`,
          });
    }
  }
  return findings;
}

/**
 * The message NAMES THE CONSEQUENCE rather than restating the condition. "missing
 * PIPELINE-STATUS.md" without the second half reads as nitpicking about formatting; with it you
 * can see which checks the directory silently loses — the rules that read the scorecard; the rules
 * over `paper.md` / `paper.tex` still run.
 */
function whyMissingMatters(file: string, dirName: string): string {
  if (file === "PIPELINE-STATUS.md")
    return `the stage, source and research-question checks are skipped for \`${dirName}\``;
  return `declared as required by your \`structure\` configuration`;
}

export function formatStructure(findings: readonly StructureFinding[]): string {
  const byDir = new Map<string, string[]>();
  for (const f of findings)
    byDir.set(f.file, [...(byDir.get(f.file) ?? []), f.message]);
  return [...byDir]
    .map(([dir, msgs]) => [dir, ...msgs.map((m) => `  error  ${m}`)].join("\n"))
    .join("\n\n");
}

/**
 * 🔴 ONE SCHEMA FOR BOTH HALVES. Findings about absence are emitted in THE SAME shape as ESLint
 * findings, so `--json` stays a single parseable array. A separate channel would force every
 * consumer to write a second parser — and the first one who did not write it would read "there
 * are no structural findings" instead of "I do not parse them".
 */
export function asEslintResults(
  findings: readonly StructureFinding[],
): unknown[] {
  const byDir = new Map<string, string[]>();
  for (const f of findings)
    byDir.set(f.file, [...(byDir.get(f.file) ?? []), f.message]);
  return [...byDir].map(([filePath, msgs]) => ({
    filePath,
    messages: msgs.map((message: string) => ({
      ruleId: "structure/required-file",
      severity: 2,
      message,
      line: 0,
      column: 0,
    })),
    errorCount: msgs.length,
    fatalErrorCount: 0,
    warningCount: 0,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
    suppressedMessages: [],
    usedDeprecatedRules: [],
  }));
}
