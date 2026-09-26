#!/usr/bin/env node
/**
 * `paperlint lint [paths…]` — run every rule over the corpus of papers.
 *
 * 🔴 WHY THIS UTILITY EXISTS. Before it, "installation" meant: install the package AND WRITE BY
 * HAND sixty lines of ESLint flat config, listing ten rules, three languages and four `files`
 * blocks. That is, the tool dumped its own implementation onto the user: to count the bytes of a
 * pdf you first had to learn what `language: "tex/latex"` is. The rules still run under ESLint —
 * but that is INTERNAL machinery, and you no longer need to know it in order to run them.
 *
 * Two entry points into the tool, and both are whole now:
 *     npx paperlint lint              ← here
 *     uses: zernie/paperlint@<sha>    ← action.yml
 *
 * ⚠️ THE BOUNDARY THIS UTILITY HAS NO RIGHT TO ERASE: the consumer's data stays with the consumer.
 * Where the papers are and the project's own rule blocks — that is about ONE corpus, so it lives in
 * the consumer's own `paperlint.json`, at the project root and in each paper.
 *
 * 🔴 WHY THE COMMAND IS CALLED `lint` AND NOT `check`. It does exactly what everyone else calls by
 * that word: reads files, changes nothing, prints findings, exits non-zero. `check` is taken in the
 * ecosystem by another meaning — `cargo check`, `tsc --noEmit`, `npm run check` — it means "build,
 * but do not emit the artifact", that is, half of a BUILD. A package whose paper build comes first
 * has no right to occupy that word with a linter. `check` stays as an alias and prints what
 * replaced it: silently breaking someone else's workflow is worse than asking them to fix a line.
 */
import { ESLint, type Linter } from "eslint";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve, relative, basename, sep } from "node:path";
import markdown from "@eslint/markdown";
// Types come from consumer.d.mts beside it, the same arrangement as lib/paper-config.d.mts.
import {
  isMain,
  packageVenuesDir,
} from "../skills/paper-pipeline/scripts/consumer.mjs";
export { isMain };
import type { Args, PaperlintConfig, ConfigRead } from "./types.ts";
import {
  checkStructure,
  formatStructure,
  asEslintResults,
} from "./structure.ts";
import { buildPapers, papersIn, anyFailed, remedyFor, MAIN } from "./build.ts";
import { prepareEngine } from "./build-engine.ts";
import { cacheRoot, cachedTree, runToolchain } from "./toolchain.ts";
import { banalInstaller, parseBanalSettings } from "./adapters/banal/index.ts";
import { curlDownload } from "./adapters/curl/index.ts";
import { hostDirs, nodeAdapters, nodeFiles } from "./adapters/node/index.ts";
import { VENUE_RULE_LEVELS, venueRules } from "./venue-rules.ts";
import {
  paperRules,
  stringFields,
  type PaperSettings,
} from "./paper-settings.ts";
import { referenceRules, REFERENCE_RULE_LEVELS } from "./reference-rules.ts";
import { onlineReferences } from "./adapters/references/index.ts";
import {
  narrowToOwners,
  ownedPatterns,
  ruleOwners,
  scopeToOwned,
} from "./paper-files.ts";
import {
  paperPreset,
  paperPresetProblem,
  presetProblemText,
  resolvePreset,
  shippedPresets,
  SHIPPED_PREFIX,
  type PaperPreset,
} from "./presets.ts";
import type { ToolInstaller } from "./ports/tool-installer.ts";
import {
  mergeRequirements,
  declaredUnion,
  requirementsFor,
  NO_REQUIREMENTS,
  type TexRequirements,
} from "./tex-requirements.ts";
import { doctor } from "./doctor.ts";
import { init, processInteractivity, askOnTerminal } from "./init.ts";
import {
  DEFAULT_FORMAT,
  FORMATS,
  isFormat,
  newPaper,
  reportNewPaper,
  type PaperFormat,
  type VenueSetting,
} from "./new-paper.ts";
// The one source for the consumer's config key lives in the .mjs half of the package (the ESLint
// rules and the skill scripts import it too); its types are in lib/paper-config.d.mts.
import {
  CONFIG_FILE,
  DEFAULT_PAPERS_ROOT,
  PAPERS_DIR_FIELD,
  SETTINGS_KEYS,
  findProjectRoot,
} from "../lib/paper-config.mjs";
import {
  parseRuleBlocks,
  parseRuleEntries,
  shippedRuleIds,
  unknownKeys,
  type Parsed,
  type RuleBlock,
  type RuleEntry,
} from "./rules-config.ts";
export { init };
export { nextSteps } from "./init.ts";

// @ts-expect-error — an ESLint rule in .mjs, it has no types
import paperStages from "../eslint-rules/paper-stages.mjs";
// @ts-expect-error — an ESLint rule in .mjs, it has no types
import researchQuestion from "../eslint-rules/paper-research-question.mjs";
// @ts-expect-error — an ESLint rule in .mjs, it has no types
import typography from "../eslint-rules/paper-typography.mjs";
// @ts-expect-error — an ESLint rule in .mjs, it has no types
import texBuild from "../eslint-rules/tex-build.mjs";
// @ts-expect-error — an ESLint rule in .mjs, it has no types
import bibReachable from "../eslint-rules/bib-reachable-entry.mjs";
// @ts-expect-error — an ESLint rule in .mjs, it has no types
import reviewFrontmatter from "../eslint-rules/review-frontmatter.mjs";
// @ts-expect-error — an ESLint rule in .mjs, it has no types
import siblingFrontmatter from "../eslint-rules/sibling-frontmatter.mjs";
// @ts-expect-error — an ESLint rule in .mjs, it has no types
import pdfRules from "../eslint-rules/pdf-last-page-balance.mjs";

/** The shipped venue presets, read from the package's venues directory — the one list. */
const SHIPPED_VENUES = (): string[] => shippedPresets(packageVenuesDir());

const USAGE = `paperlint — machine-checkable gates for a paper kept in git

  npx paperlint init [dir]            set the project up: detect the papers directory, declare it
                                      in package.json, link the skills, wire the hooks into
                                      .claude/settings.json, offer the CI step, report what is missing
  npx paperlint new <name> [--venue <preset>] [--kind <kind>] [--format tex|md]
                                      create <papers>/<name>/ from the template; never overwrites,
                                      on an existing folder adds only the missing files, then lints it
  npx paperlint lint [paths…]         run every rule over your papers
  npx paperlint build <paper> | --all
                                      compile paper.tex to paper.pdf: pdflatex and bibtex, rerun until
                                      the references settle. Prints the plan first; a build.sh in the
                                      paper directory is ignored (--dry-run: print the plan only).
                                      Compiles with paperlint's TeX Live, else one on PATH that has every
                                      package the venue declares; on a terminal it offers to install
                                      one, without a terminal it stops and names \`npx paperlint toolchain\`.
                                      Then checks the references online (the cited works exist, titles
                                      and authors match) into _build/references.json — never failing
                                      the build: without network it records "not checked"
  npx paperlint toolchain [--check]   install TeX Live with every package the venue presets declare
                                      into ~/.cache/paperlint/texlive (PAPERLINT_TEXLIVE_DIR overrides); a second
                                      run does nothing. --check: report what is missing, change nothing
  npx paperlint doctor                say what is actually wired — and what only LOOKS wired
  npx paperlint hook <name>           run an editor hook (.claude/settings.json calls this)
  npx paperlint --help

init:
  --yes, -y           ask nothing, take every default. Without a terminal on stdin AND stdout,
                      or with CI set, nothing is asked either
  --no-hooks          do not wire the hooks (the default without a human is to wire them)
  --paper <name>      create this paper too (without a human, the only way init creates one)
  --format tex|md     the new paper's source format; default tex

new:
  --venue <preset>    the venue preset, written as "extends" into the paper's paperlint.json:
                      a shipped one (${SHIPPED_VENUES().join(", ")}), or a path to your
                      own preset starting with ./ or ../, relative to where you run the command.
                      On a terminal without --venue, new asks; "none" leaves it unset
  --kind <kind>       the paper's kind at that venue (its page limit), e.g. short — one of the
                      preset's kinds; needs --venue
  --format tex|md     the paper's source format; default tex

lint:
  npx paperlint lint [paths…] [--fix] [--config <file.json>] [--json]

  <paths…>            where your papers live, e.g. papers. Optional ONLY because the declaration
                      names it — one of the two must name the scope. There is no default
                      of ".": linting whatever happens to be in the checkout is how a green
                      report over a scope nobody chose gets produced.
  --fix               write every fix the rules offer (section signs, leading zeros, figure
                      references), then report what is left
  --config <file>     read the settings from this file instead of the discovered one
  --json              machine-readable findings on stdout, nothing else on it
  --max-warnings <n>  fail when warnings exceed n. Default -1: warnings never fail, because
                      most findings here are advisory and a gate that fails on advice gets muted

settings — paperlint.json, at two levels, one schema. Both are optional.

  paperlint.json (the project root, beside package.json) — found by walking up from the
  current directory. \`--config\` names another file of the same shape.

    {
      "papersDir": "papers",
      "rules": [ { "files": ["papers/my-paper/**"],
                   "rules": { "pdf/last-page-balance": "error" } } ]
    }

  "papersDir" defaults to "papers". "extends", "kind" and "pdf" here are defaults for every
  paper. "papersDir", "structure" and the skills' keys are allowed only here.

  <papersDir>/<paper>/paperlint.json — one paper, merged over the root file:

    { "extends": "paperlint:aisec", "kind": "research", "rules": { "pdf/last-page-balance": "error" } }

  "extends" names a venue preset: paperlint:<name> (shipped: ${SHIPPED_VENUES().join(", ")})
  or ./path.jsonc, relative to the paperlint.json. npm presets are not supported yet.

  "rules" is { "<rule>": "<severity>" } for every paper file in scope, or ESLint flat-config
  blocks (files, ignores, rules) with globs relative to that file. Order, later wins: paperlint's
  own, the venue preset's, the root file's, the paper's. Optional rules (off unless turned on):
  pdf/last-page-balance. The venue rules (pdf/fresh, pdf/profile, pdf/fonts, pdf/geometry,
  pdf/limits, pdf/body-size, pdf/measured) are on for every paper with a venue preset; set one to
  "off" to skip it. An unknown key, in either file, is an error.
`;

/** The config the user would otherwise write by hand. The data comes from `opts`, the mechanism is here. */
export function buildConfig(
  opts: PaperlintConfig = {},
  texLanguage: unknown,
): unknown[] {
  const paperRules = { ...researchQuestion.rules, ...typography.rules };
  // The reference rules judge `_build/references.json`, and only on `paper.tex`.
  const texPaperRules = {
    ...paperRules,
    ...referenceRules({ files: nodeFiles }),
  };
  // Each typography rule reports every occurrence where it is, and fixes it (`--fix`).
  const prose = {
    "paper/research-question": "warn",
    "paper/section-word": "warn",
    "paper/leading-zero": "warn",
  };
  const md = {
    language: "markdown/gfm",
    languageOptions: { frontmatter: "yaml" },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- #49: replace with a real type
  const cfg: any[] = [
    // 🔴 THE PROJECT'S PAPER TEMPLATE IS NOT A PAPER. `paperlint new` reads `<papers>/.template/`, and
    // its files carry every marker a paper does. Flat config does NOT ignore dot-directories by
    // default (only `node_modules/` and `.git/`), so without this block `paperlint lint` would lint the
    // template as a paper — and a richer template with placeholder stages would fail the run.
    { ignores: ["**/.template/"] },
    // The `pdf` plugin is registered for EVERY file. A consumer's block (`rules`, appended below)
    // may name its rules for a glob that also matches markdown files; with the plugin defined only
    // beside `paper.tex`, ESLint would refuse those files with "could not find plugin". Every rule
    // in it acts on `paper.tex` only. `last-page-balance` is on for no file (optional); the venue
    // rules are on for every `paper.tex`, in the block below.
    {
      plugins: {
        pdf: {
          rules: {
            ...pdfRules.rules,
            ...venueRules({ files: nodeFiles, venuesDir: packageVenuesDir() }),
          },
        },
      },
    },
    {
      files: ["**/PIPELINE-STATUS.md"],
      plugins: { markdown, paper: paperStages },
      ...md,
      rules: {
        "paper/stages": "error",
        "paper/source": "error",
      },
    },
    {
      files: ["**/paper.md", "**/draft.md"],
      plugins: { markdown, paper: { rules: paperRules } },
      ...md,
      rules: prose,
    },
    {
      files: ["**/reviews/*.md"],
      plugins: { markdown, review: reviewFrontmatter },
      ...md,
      // A review's frontmatter is a record, validated by paperlint's JSON Schema
      // (eslint-rules/review-frontmatter.mjs).
      rules: { "review/frontmatter": "error" },
    },
    {
      // A sibling card says how much of the competing paper was read (`read:`). The cards are
      // written by this package's analyze-sibling-paper skill; its README is an index, not a card.
      files: ["**/siblings/*.md"],
      ignores: ["**/siblings/README.md"],
      plugins: { markdown, sibling: siblingFrontmatter },
      ...md,
      rules: { "sibling/frontmatter": "warn" },
    },
  ];

  // `.tex` only if the language loaded: it pulls in the LaTeX parser, and dying because of it on a
  // corpus without a single `.tex` would be refusing to work where work is possible.
  if (texLanguage)
    cfg.push({
      files: ["**/paper.tex"],
      plugins: {
        tex: { languages: { latex: texLanguage }, rules: texBuild },
        paper: { rules: texPaperRules },
        bib: bibReachable,
      },
      language: "tex/latex",
      rules: {
        ...prose,
        ...REFERENCE_RULE_LEVELS,
        "paper/figure-ref-style": "warn",
        "bib/reachable-entry": "warn",
        "tex/future-promise": "warn",
        "tex/acm-frontmatter-override": "error",
        // Silent for a paper whose paperlint.json names no venue (src/venue-rules.ts).
        ...VENUE_RULE_LEVELS,
      },
    });
  // 🔴 ONLY THE FILES THESE BLOCKS CLAIM ARE LINTED (src/paper-files.ts). Without this block ESLint's
  // built-in defaults lint every .js/.mjs/.cjs under the papers directory — a paper's vendored
  // `repro/` code failed the run with 74 parse errors and not one finding on a paper file. It goes
  // FIRST: the `.template/` ignore below must come after its directory un-ignore to win.
  const owners = ruleOwners(cfg);
  cfg.unshift(scopeToOwned(ownedPatterns(cfg)));
  // The consumer's own blocks, LAST, so a later block wins — ESLint's rule. Parsed by
  // `readConfig`; each carries the settings file's directory as its `basePath`. Each is split so a
  // rule reaches only the files its plugin is registered for: `paper` is a different plugin beside
  // PIPELINE-STATUS.md than beside paper.tex, and ESLint throws on a rule its plugin lacks.
  cfg.push(...(opts.rules ?? []).flatMap((b) => narrowToOwners(b, owners)));
  return cfg;
}

/**
 * The rule ids a consumer may name in `rules`: every rule paperlint's own config defines, read off that
 * config rather than listed again. `@eslint/markdown` is a dependency's plugin, not paperlint's.
 */
export const SHIPPED_RULES: ReadonlySet<string> = shippedRuleIds(
  buildConfig({}, { sentinel: "tex language" }),
  [markdown],
);

/** A plugin as `rulePlugins` gives it: its rules, and for `tex` the LaTeX language when given. */
export interface RulePlugin {
  readonly rules?: Readonly<Record<string, unknown>>;
  readonly languages?: Readonly<Record<string, unknown>>;
}

/**
 * Every plugin paperlint's config registers, ONE object per name, read off that config. In it one
 * name is bound to different objects in different blocks (`paper` beside `PIPELINE-STATUS.md` is
 * not `paper` beside `paper.tex`); here their rules are merged, so a config that lints any paper
 * file knows every rule id. `@eslint/markdown` is a dependency's plugin and is left out. The LaTeX
 * language rides on `tex` when `texLanguage` is given, and that is how a consumer registers it: a
 * second `tex` plugin of its own is refused by ESLint ("Cannot redefine plugin "tex"", measured
 * with and without the language here). Without it, `tex` carries rules only — for a config that
 * lints markdown papers alone.
 */
export function rulePlugins(texLanguage?: unknown): Record<string, RulePlugin> {
  const out: Record<string, { rules: Record<string, unknown> }> = {};
  for (const block of buildConfig({}, texLanguage ?? { sentinel: "tex" }))
    for (const [name, plugin] of Object.entries(
      (block as { plugins?: Record<string, RulePlugin> }).plugins ?? {},
    ))
      if (plugin !== markdown)
        out[name] = { rules: { ...out[name]?.rules, ...plugin.rules } };
  if (out["tex"] && texLanguage !== undefined)
    return {
      ...out,
      tex: { ...out["tex"], languages: { latex: texLanguage } },
    };
  return out;
}

/**
 * A flat-config fragment for a consumer's OWN ESLint run over paper files (#104): every rule
 * paperlint ships, registered and turned off. Without it a `% eslint-disable-next-line
 * paper/leading-zero -- why` — the documented escape hatch — fails that run with "Definition for
 * rule 'paper/leading-zero' was not found". Off, because `paperlint lint` is where they run.
 *
 * The second block is not optional, and it is measured: a directive naming a rule that is off
 * suppresses nothing, so ESLint reports it as an unused directive (a warning by default, an error
 * under `reportUnusedDisableDirectives: "error"`). On the files paperlint lints that report is
 * switched off in THIS run — `paperlint lint` still reports a directive that silences nothing.
 */
export function rulesOff(texLanguage?: unknown): Linter.Config[] {
  return [
    {
      name: "paperlint/rules-off",
      plugins: rulePlugins(texLanguage) as Linter.Config["plugins"],
      rules: Object.fromEntries([...SHIPPED_RULES].map((id) => [id, "off"])),
    },
    {
      name: "paperlint/rules-off/directives",
      files: PAPER_FILE_PATTERNS,
      linterOptions: { reportUnusedDisableDirectives: "off" },
    },
  ];
}

/** Whether a rule entry (`"error"`, `2`, `["warn", {…}]`) turns the rule on. */
const isOn = (entry: unknown): boolean => {
  const sev = Array.isArray(entry) ? entry[0] : entry;
  return sev !== undefined && sev !== "off" && sev !== 0;
};

/**
 * Rules paperlint ships and turns on for no file itself — the ones a consumer opts into with `rules`.
 * Derived: every shipped rule that no block of paperlint's own config names.
 */
export const OPTIONAL_RULES: ReadonlySet<string> = new Set(
  [...SHIPPED_RULES].filter(
    (id) =>
      !buildConfig({}, { sentinel: "tex language" }).some((b) =>
        isOn((b as { rules?: Record<string, unknown> }).rules?.[id]),
      ),
  ),
);

/**
 * 🔴 AN OPTIONAL RULE THAT IS ON AND REACHES NO PAPER IS A GREEN ZERO. A `files` glob that matches
 * nothing — a typo, a path relative to the wrong directory — leaves the rule never invoked, and a
 * rule that never runs reports exactly like a rule that passed. So for every optional rule the
 * consumer turned on, some `paper.tex` must actually have it enabled; the ones none has are
 * returned, for the caller to refuse.
 *
 * `files` is every `paper.tex` the guard may count: the ones this run linted AND every paper of the
 * project. Judged against the run alone, `paperlint lint papers/c` failed on a block written for
 * papers a and b (#103) — a block that reaches a paper outside this run is not dead. A glob that
 * reaches no paper of the project at all still fails, from a subset as from the whole.
 */
export async function silentOptionalRules(
  eslint: ESLint,
  files: readonly string[],
  opts: PaperlintConfig,
): Promise<string[]> {
  const turnedOn = new Set(
    (opts.rules ?? []).flatMap((b) =>
      Object.entries(b.rules)
        .filter(([id, e]) => OPTIONAL_RULES.has(id) && isOn(e))
        .map(([id]) => id),
    ),
  );
  const reached = new Set<string>();
  for (const f of new Set(files.filter((p) => basename(p) === MAIN))) {
    // Undefined for a file outside ESLint's cwd or scope: it reaches nothing.
    const cfg = (await eslint.calculateConfigForFile(f)) as
      { rules?: Record<string, unknown> } | undefined;
    for (const id of turnedOn) if (isOn(cfg?.rules?.[id])) reached.add(id);
  }
  return [...turnedOn].filter((id) => !reached.has(id));
}

/**
 * Every linted paper's rules, as ESLint blocks scoped to that paper, in two groups: what its venue
 * preset turns on, and what its own `paperlint.json` says. The caller puts the root's blocks between
 * them. A file that does not parse, or names a rule paperlint does not ship, stops the run with one
 * line naming the file — the same strictness as the root's own `rules`.
 */
export function paperRuleBlocks(
  paths: readonly string[],
): Parsed<{ preset: RuleBlock[]; own: RuleBlock[] }> {
  // A FILE named on the command line belongs to the paper it sits in: that paper's settings apply.
  const dirs = paths.map((p) =>
    existsSync(p) && statSync(p).isFile() ? dirname(p) : p,
  );
  const papers = [...new Set(dirs.flatMap((p) => [p, ...papersIn(p)]))];
  const out = { preset: [] as RuleBlock[], own: [] as RuleBlock[] };
  for (const dir of papers) {
    const p = paperPreset(dir, PRESET_DEPS);
    if (p.kind === "settings-problem" && p.problem.kind === "broken")
      return { ok: false, error: paperPresetProblem(dir, p) ?? dir };
    const blocks = rulesOfPaper(dir, p);
    if (!blocks.ok) return blocks;
    out.preset.push(...blocks.value.preset);
    out.own.push(...blocks.value.own);
  }
  return { ok: true, value: out };
}

/**
 * One paper's blocks: its preset chain's `rules`, and its own — either `{ id: severity }` over the
 * paper's files, or ESLint blocks with globs relative to the paper. A preset that does not resolve
 * contributes nothing here; `pdf/profile` reports it on the paper.
 */
function rulesOfPaper(
  dir: string,
  p: PaperPreset,
): Parsed<{ preset: RuleBlock[]; own: RuleBlock[] }> {
  const settings = "settings" in p ? p.settings : null;
  const fromPreset =
    p.kind === "resolved"
      ? parseRuleEntries(
          p.preset.rules,
          `the venue preset ${p.preset.chain.join(" → ")} → "rules"`,
          SHIPPED_RULES,
        )
      : { ok: true as const, value: {} };
  if (!fromPreset.ok) return fromPreset;
  const own =
    settings === null
      ? { ok: true as const, value: [] }
      : Array.isArray(settings.rules)
        ? parseRuleBlocks(
            settings.rules,
            join(dir, CONFIG_FILE),
            SHIPPED_RULES,
            dir,
          )
        : ownRules(dir, settings);
  if (!own.ok) return own;
  // No `files`: `narrowToOwners` scopes the block to what paperlint lints under `dir`, exceptions
  // included. A copy of the globs here is how the siblings index got parsed as JavaScript (#101).
  const scoped = (rules: Record<string, RuleEntry>): RuleBlock[] =>
    Object.keys(rules).length ? [{ basePath: dir, rules }] : [];
  return {
    ok: true,
    value: { preset: scoped(fromPreset.value), own: [...own.value] },
  };
}

/** A paper's `{ id: severity }` rules, as one block over the paper's files (narrowed later, #101). */
function ownRules(
  dir: string,
  settings: PaperSettings,
): Parsed<readonly RuleBlock[]> {
  const own = paperRules(dir, settings, SHIPPED_RULES);
  if (!own.ok) return own;
  return {
    ok: true,
    value: own.value ? [{ basePath: dir, rules: own.value }] : [],
  };
}

/**
 * The globs paperlint lints, for the refusal message only. Which files a block reaches is decided by
 * `narrowToOwners` from `ownedScopes` (src/paper-files.ts), where each glob keeps its exceptions.
 */
const PAPER_FILE_PATTERNS: string[] = ownedPatterns(
  buildConfig({}, { sentinel: "tex language" }),
);

/**
 * The root `paperlint.json` after the boundary: an unknown key is refused by name, the paper
 * defaults (`extends`, `kind`, `pdf`) are checked the way a paper's own are, and `rules` becomes
 * parsed config blocks. Nothing after this sees the raw object.
 */
export function parseSettings(
  json: unknown,
  where: string,
  baseDir: string,
): Parsed<PaperlintConfig> {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return { ok: false, error: `${where}: must be a JSON object` };
  const raw = json as Record<string, unknown>;
  const opts = raw as PaperlintConfig;
  const unknown = unknownKeys(raw);
  if (unknown.length > 0)
    return {
      ok: false,
      error:
        `${where}: unknown key${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} — ` +
        `a typo would otherwise read as "not set". Known keys: ${Object.keys(SETTINGS_KEYS).join(", ")}`,
    };
  const defaults = stringFields(raw);
  if (!defaults.ok) return { ok: false, error: `${where}: ${defaults.error}` };
  const rules = parseRuleBlocks(raw["rules"], where, SHIPPED_RULES, baseDir);
  if (!rules.ok) return rules;
  return { ok: true, value: { ...opts, rules: rules.value } };
}

/**
 * The directory ESLint runs from. ESLint ignores every file outside it (#48), and the consumer's
 * `rules` globs are written relative to the config's directory. So: the deepest directory holding
 * the config's directory and every path. With the
 * papers inside the config's directory, that is the config's directory itself.
 */
const lintRoot = (home: string, paths: readonly string[]): string =>
  commonDir([home, ...paths]);

/** The longest shared leading run of path segments. */
const commonDir = (paths: readonly string[]): string => {
  const [first = [], ...rest] = paths.map((p) => p.split(sep));
  const end = first.findIndex((part, i) =>
    rest.some((other) => other[i] !== part),
  );
  return first.slice(0, end === -1 ? undefined : end).join(sep) || sep;
};

export function parseArgs(argv: readonly string[]): Args {
  // `--help` is parsed BEFORE argv[0] becomes the command: otherwise `paperlint --help` answers
  // "unknown command `--help`" — caught by the very first run of the utility.
  const out: Args = {
    cmd: null,
    paths: [],
    config: null,
    json: false,
    fix: false,
    all: false,
    dryRun: false,
    check: false,
    yes: false,
    noHooks: false,
    paper: null,
    format: null,
    venue: null,
    kind: null,
    hooksMode: null,
    // -1 = warnings NEVER fail the run. In this set most findings are advisory by design, and a
    // gate that fails on advice gets muted entirely.
    maxWarnings: -1,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) out.cmd = rest.shift() ?? null;

  // 🔴 A FLAG WHOSE VALUE WAS TAKEN AWAY IS A REFUSAL, NOT A DEFAULT. The compiler found this
  // during the move to TypeScript: `rest[++i]` past the last argument gives `undefined`, and
  // `paperlint lint --config` (the value forgotten, or eaten by a substitution in CI) silently turned
  // into "no config given" — that is, it went to auto-discovery and linted against SOMEONE ELSE'S
  // file, saying nothing. The failure is one-sided and toward silence, so it is cured by
  // behaviour, not by a type cast.
  const valueFor = (flag: string, i: number): string | undefined => {
    const v = rest[i];
    if (v === undefined) out.missingValue = flag;
    return v;
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    // `--flag=value` is `--flag value` for every flag that takes a value: the CI action writes
    // `--max-warnings="$N"`, and that form used to fall through to the list of paths.
    const eq = arg.indexOf("=");
    const inline =
      arg.startsWith("--") && eq > 0 && VALUE_FLAGS.has(arg.slice(0, eq))
        ? arg.slice(eq + 1)
        : undefined;
    const a = inline === undefined ? arg : arg.slice(0, eq);
    const take = (): string | undefined => {
      if (inline === undefined) return valueFor(a, ++i);
      if (inline === "") out.missingValue = a;
      return inline === "" ? undefined : inline;
    };
    if (a === "--json") out.json = true;
    else if (a === "--fix") out.fix = true;
    else if (a === "--all") out.all = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--check") out.check = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--no-hooks") out.noHooks = true;
    else if (a.startsWith("--hooks="))
      out.hooksMode = a.slice("--hooks=".length);
    else if (a === "--paper") out.paper = take() ?? null;
    else if (a === "--format") out.format = take() ?? null;
    else if (a === "--venue") out.venue = take() ?? null;
    else if (a === "--kind") out.kind = take() ?? null;
    // `--options` was the first spelling and is kept working. It named the wrong thing — every
    // other tool in the stack calls this file its config — but a flag in someone's CI is not
    // ours to break.
    else if (a === "--config" || a === "--options") out.config = take() ?? null;
    else if (a === "--max-warnings") {
      const v = take();
      if (v !== undefined) out.maxWarnings = Number(v);
    } else if (a === "--help" || a === "-h") out.help = true;
    // An unknown flag is refused by name. Read as a path, it silently lints something else.
    else if (a.startsWith("-") && a !== "-") out.unknownFlag ??= a;
    else out.paths.push(a);
  }
  return out;
}

/** The flags that take a value, in either spelling: `--flag value` or `--flag=value`. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--paper",
  "--format",
  "--venue",
  "--kind",
  "--config",
  "--options",
  "--max-warnings",
]);

/**
 * This package's own version, from the `package.json` beside `src/` and `dist/` alike. `init` pins
 * the CI action to its release tag; an unreadable manifest yields `undefined`, and init then keeps
 * the placeholder instead of guessing.
 */
function ownVersion(): string | undefined {
  try {
    const v = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    )?.version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reading the config, ONE reader for all commands. Pulled out of `run()` the moment a second
 * command needed the same config (`build`): two copies of this block would have drifted apart on
 * the very first edit — exactly the class that already cost us the empty-set guard in two places.
 *
 * 🔴 THE CONFIG FINDS ITSELF: the project root is the nearest directory up from `cwd` with a root
 * `paperlint.json`, else with a `package.json`, else `cwd` (`findProjectRoot`). The file is
 * optional — without one every setting has its default, and papers are in `papers/`. An explicit
 * `--config` beats the discovered one: it was named out loud, and a substitution is never silent.
 *
 * @returns `{ opts, configPath, root }` on success, or `{ code }` — and then the caller exits with it.
 */
export function readConfig(
  a: Args,
  {
    log = console.log,
    err = console.error,
    cwd = process.cwd(),
  }: {
    log?: typeof console.log;
    err?: typeof console.error;
    cwd?: string;
  } = {},
): ConfigRead {
  if (a.config && !existsSync(resolve(cwd, a.config))) {
    err(`config file not found: ${a.config}`);
    return { code: 2 };
  }
  const root = a.config
    ? dirname(resolve(cwd, a.config))
    : findProjectRoot(cwd);
  const found = a.config ? resolve(cwd, a.config) : join(root, CONFIG_FILE);
  const configPath = existsSync(found) ? found : null;
  if (configPath === null) return { opts: {}, configPath, root };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    err(`${configPath} is not valid JSON: ${(e as Error).message}`);
    return { code: 2 };
  }
  // The discovered config is NAMED out loud. Otherwise a run from someone else's directory picks
  // up someone else's file and does not say so — and its settings then look like findings.
  //
  // 🔴 IN `--json` MODE — TO stderr. Machine output must be ONE parsable document: a line before
  // the array breaks any `| jq`, and it breaks it for the consumer, not for us.
  (a.json ? err : log)(`config: ${relative(cwd, configPath) || CONFIG_FILE}`);
  const settings = parseSettings(
    parsed,
    relative(cwd, configPath) || CONFIG_FILE,
    root,
  );
  if (!settings.ok) {
    err(settings.error);
    return { code: 2 };
  }
  return { opts: settings.value, configPath, root };
}

/** The papers directory field of the settings, read by its one declared name; the default when absent. */
export function papersDirOf(opts: PaperlintConfig): unknown {
  const declared = (opts as Record<string, unknown>)[PAPERS_DIR_FIELD];
  return declared === undefined ? DEFAULT_PAPERS_ROOT : declared;
}

/** The error for a papers directory that is missing or holds no paper. */
export const noPapersMessage = (dir: string): string =>
  `no papers in ${dir}/ — create one with \`npx paperlint new <name>\`, or set "${PAPERS_DIR_FIELD}" ` +
  `in ${CONFIG_FILE} if your papers live elsewhere`;

/** The papers directories of a read config, absolute: each relative to the project root. */
export const papersRoots = (cfg: {
  opts: PaperlintConfig;
  root: string;
}): string[] =>
  toPaths(papersDirOf(cfg.opts)).map((rel) => resolve(cfg.root, rel));

/** The papers directory may be one directory or several; both spellings normalise to a list. */
export function toPaths(papers: unknown): string[] {
  if (typeof papers === "string") return papers.trim() ? [papers.trim()] : [];
  if (Array.isArray(papers))
    return papers.filter((x) => typeof x === "string" && x.trim());
  return [];
}

/**
 * `paperlint hook <name>` — run an editor hook. It exists for ONE thing: so that the wiring does not
 * address the runtime from the project root.
 *
 * 🔴 WHAT IT WAS AND WHY IT BROKE. `hooks.json` called
 *     node "${CLAUDE_PROJECT_DIR}/node_modules/vigiles/dist/cli.js" hook-runtime run-program …
 * While `vigiles` was a PEER dependency this path was GUARANTEED: a peer is installed by the
 * consumer itself, into its own root. After the move to ordinary dependencies the guarantee was
 * gone, and a measurement showed it — one tarball, two managers:
 *     npm:  node_modules/vigiles/dist/cli.js   PRESENT
 *     pnpm: node_modules/vigiles/dist/cli.js   ABSENT (only paperlint in the root)
 * The cost of the failure is asymmetric: `|| exit 2` stood on PreToolUse(Bash), that is, ANY
 * command was denied, including the one you fix it with.
 *
 * WHAT IT IS NOW. The wiring calls ITS OWN bin — `paperlint` is a direct dependency,
 * so it lies in the root under any manager — and the runtime is resolved FROM THE POSITION OF THIS
 * FILE via `createRequire`. Wherever the manager laid the tree out, the resolver finds the same
 * thing an `import` from inside the package would.
 *
 * 🔴 AND `|| exit 2` IS REMOVED FROM THE SHELL. The decision to stop is a decision, and it is taken
 * here, in code. In the shell it meant "any mishap = block everything": the runtime was not found —
 * work stopped. Now a runtime that is not found complains LOUDLY and returns 0, while the hook's
 * real verdict (2 included) passes through. Silent degradation is worse than explicit degradation,
 * but blocking everything is worse than both.
 */
export function runHook(
  name: string | undefined,
  {
    err = console.error,
    run = spawnSync,
    // The resolver is injected so that "the runtime was not found" is checked by an assert and not
    // by deleting node_modules: a failure must be reproducible, not staged.
    // 🔴 WE RESOLVE THE PACKAGE, NOT A FILE INSIDE IT. `require.resolve("vigiles/dist/cli.js")`
    // DOES NOT WORK: the package's `exports` map hands out only "." and nine named subpaths, and
    // `./dist/cli.js` — even `./package.json` — is not among them:
    //     Package subpath './dist/cli.js' is not defined by "exports"
    // This is neither our oversight nor their bug: a closed export map is normal practice. So we
    // resolve the root entry ("." → dist/test.js), take its directory and put `cli.js` next to it —
    // the very file the package itself declares as its `bin`.
    resolve = (spec: string): string =>
      createRequire(import.meta.url).resolve(spec),
  }: {
    err?: typeof console.error;
    run?: typeof spawnSync;
    resolve?: (spec: string) => string;
  } = {},
): number {
  if (!name) {
    err(`\`hook\` needs a name, e.g. \`paperlint hook paper-edit-guard\``);
    return 2;
  }
  const program = fileURLToPath(
    new URL(`../hooks/${name}.hook.mjs`, import.meta.url),
  );
  if (!existsSync(program)) {
    err(`unknown hook \`${name}\` — no such program at ${program}`);
    return 2;
  }
  let runtime;
  try {
    runtime = join(dirname(resolve("vigiles")), "cli.js");
    if (!existsSync(runtime))
      throw new Error(`resolved vigiles, but no cli.js beside it: ${runtime}`);
  } catch {
    err(
      `paperlint: the hook runtime (vigiles) is not resolvable from ${fileURLToPath(new URL(".", import.meta.url))}.\n` +
        `The \`${name}\` hook is NOT running. Everything else — \`paperlint lint\`, CI — is unaffected.\n` +
        `Reinstall this package so its dependencies are present.`,
    );
    return 0;
  }
  const r = run(
    process.execPath,
    [runtime, "hook-runtime", "run-program", program],
    {
      stdio: "inherit",
    },
  );
  return r.status ?? 0;
}

/**
 * Create one paper and lint it — shared by `paperlint new` and `paperlint init --paper`, so the two cannot
 * become two implementations. The lint runs on THAT folder, so the first thing printed after the
 * file list is its verdict rather than the old "missing PIPELINE-STATUS.md".
 */
export async function createPaperAt(
  papersRoot: string,
  name: string,
  format: PaperFormat,
  {
    log,
    err,
    cwd,
    venue = null,
  }: {
    log: typeof console.log;
    err: typeof console.error;
    cwd: string;
    /** What `--venue` chose; null writes the template's `paperlint.json` as it is. */
    venue?: VenueChoice | null;
  },
): Promise<number> {
  const result = newPaper(papersRoot, name, format, { venue });
  const here = (p: string): string => relative(cwd, p) || p;
  for (const line of reportNewPaper(result, here)) log(line);
  if (!result.ok) return 2;
  const config = here(join(result.dir, CONFIG_FILE));
  if (venue === null)
    log(
      `  venue: none yet — set "extends" in ${config}, or next time: paperlint new <name> --venue <preset> (${SHIPPED_VENUES().join(", ")})`,
    );
  else if (venue.kind === null && venue.kinds.length > 0)
    log(
      `  kind: not set — \`${venue.label}\` sets a page limit per kind (${venue.kinds.join(", ")}); add "kind" to ${config}. Until then lint reports pdf/profile`,
    );
  log(``);
  return run(["lint", result.dir], { log, err, cwd });
}

/** A venue `paperlint new` will write, with what the messages need to say about it. */
export interface VenueChoice extends VenueSetting {
  /** The preset's word in messages (`agenticdev`, `my-workshop`). */
  readonly label: string;
  /** The preset's kinds; empty when it sets no page limit. */
  readonly kinds: readonly string[];
}

/**
 * `--venue` / `--kind` → the `extends` and `kind` to write into `<paperDir>/paperlint.json`, or why
 * not. Parsed here, at the boundary, and resolved through the same `resolvePreset` lint uses — so a
 * venue `new` accepts is a venue lint resolves. On a terminal with no `--venue` it asks, with
 * "none" as the default; without a terminal it chooses nothing (null), as before.
 *
 * A path is relative to where the command runs, because that is where it was typed; it is written
 * relative to the paper's `paperlint.json`, because that is what `extends` is relative to. Written
 * as typed, `./venues/x.jsonc` would name `<paper>/venues/x.jsonc`.
 */
export async function chooseVenue(
  flags: { readonly venue: string | null; readonly kind: string | null },
  {
    paperDir,
    cwd,
    interactive,
    ask,
  }: {
    paperDir: string;
    cwd: string;
    interactive: boolean;
    ask: (q: string) => Promise<string>;
  },
): Promise<Parsed<VenueChoice | null>> {
  const shipped = SHIPPED_VENUES();
  if (flags.kind !== null && flags.venue === null)
    return bad(
      `--kind needs --venue: a kind is a page limit of one venue preset — \`paperlint new <name> --venue <preset> --kind ${flags.kind}\``,
    );
  const asked = async (q: string): Promise<string> =>
    (await ask(q).catch(() => "")).trim();
  const venue =
    flags.venue ??
    (interactive
      ? await asked(`venue: ${[...shipped, "none"].join(" / ")} [none] `)
      : "");
  if (venue === "" || (flags.venue === null && venue === "none"))
    return { ok: true, value: null };
  const spec = venueSpec(venue, { shipped, paperDir, cwd });
  if (!spec.ok) return spec;
  const r = resolvePreset(spec.value, join(paperDir, CONFIG_FILE), PRESET_DEPS);
  if (!r.ok) return bad(`--venue ${venue}: ${presetProblemText(r.error)}`);
  const kinds = [...r.value.format.kinds.keys()];
  const label = r.value.label;
  if (flags.kind !== null) {
    if (kinds.length === 0)
      return bad(
        `--kind ${flags.kind}: \`${label}\` has no kinds — it sets no page limit, so there is no kind to choose`,
      );
    if (!kinds.includes(flags.kind))
      return bad(
        `--kind ${flags.kind}: \`${label}\` has no kind \`${flags.kind}\`; its kinds: ${kinds.join(", ")}`,
      );
  }
  const kind =
    flags.kind ??
    (interactive && kinds.length > 0
      ? await asked(`kind: ${[...kinds, "later"].join(" / ")} [later] `)
      : null);
  return {
    ok: true,
    value: {
      extends: spec.value,
      kind: kind !== null && kinds.includes(kind) ? kind : null,
      label,
      kinds,
    },
  };
}

const bad = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

/** What `--venue` names → the `extends` value, relative to `<paperDir>/paperlint.json`. */
function venueSpec(
  venue: string,
  {
    shipped,
    paperDir,
    cwd,
  }: { shipped: readonly string[]; paperDir: string; cwd: string },
): Parsed<string> {
  if (venue.startsWith("./") || venue.startsWith("../")) {
    const file = resolve(cwd, venue);
    if (!existsSync(file))
      return bad(
        `--venue ${venue}: no such file (${file}) — a path is relative to where you run the command`,
      );
    const rel = relative(paperDir, file).split(sep).join("/");
    return { ok: true, value: rel.startsWith("../") ? rel : `./${rel}` };
  }
  const name = venue.startsWith(SHIPPED_PREFIX)
    ? venue.slice(SHIPPED_PREFIX.length)
    : venue;
  if (!shipped.includes(name))
    return bad(
      `--venue ${venue}: no such venue preset. Shipped: ${shipped.join(", ")} — or a path to your own preset, starting with ./ or ../`,
    );
  return { ok: true, value: `${SHIPPED_PREFIX}${name}` };
}

/**
 * `paperlint new <name>` — the papers directory comes from the same declaration every other command
 * reads; there is no second way to name it. See `new-paper.ts` for what it writes and why.
 */
async function runNew(
  a: Args,
  {
    log,
    err,
    cwd,
    ask = askOnTerminal,
  }: {
    log: typeof console.log;
    err: typeof console.error;
    cwd: string;
    ask?: (q: string) => Promise<string>;
  },
): Promise<number> {
  const [name, ...extra] = a.paths;
  if (!name || extra.length > 0) {
    err(
      `\`new\` takes exactly one paper name: \`paperlint new my-paper [--venue <preset>] [--kind <kind>] [--format tex|md]\``,
    );
    return 2;
  }
  let format: PaperFormat = DEFAULT_FORMAT;
  if (a.format !== null) {
    if (!isFormat(a.format)) {
      err(
        `--format must be one of ${FORMATS.join(", ")} — got \`${a.format}\``,
      );
      return 2;
    }
    format = a.format;
  } else if (processInteractivity(a.yes).interactive) {
    const f = await ask(`format: tex / md [${DEFAULT_FORMAT}] `).catch(
      () => "",
    );
    if (isFormat(f.trim())) format = f.trim() as PaperFormat;
  }
  const cfg = readConfig({ ...a, json: false }, { log: () => {}, err, cwd });
  if (cfg.code !== undefined) return cfg.code;
  const roots = papersRoots(cfg);
  const papersRoot = roots[0];
  if (papersRoot === undefined) {
    err(
      `"${PAPERS_DIR_FIELD}" names no directory, so there is nowhere to put \`${name}\`.`,
    );
    return 2;
  }
  if (roots.length > 1)
    log(
      `several papers directories are declared — using the first: ${relative(cwd, papersRoot) || papersRoot}`,
    );
  const paperDir = join(papersRoot, name);
  // An existing paperlint.json is never overwritten, so a venue for it is refused, not dropped.
  const hasConfig = existsSync(join(paperDir, CONFIG_FILE));
  if (hasConfig && (a.venue !== null || a.kind !== null)) {
    err(
      `${relative(cwd, join(paperDir, CONFIG_FILE))} already exists and is never overwritten — set "extends" and "kind" in it by hand`,
    );
    return 2;
  }
  const venue = hasConfig
    ? { ok: true as const, value: null }
    : await chooseVenue(a, {
        paperDir,
        cwd,
        interactive: processInteractivity(a.yes).interactive,
        ask,
      });
  if (!venue.ok) return (err(venue.error), 2);
  return createPaperAt(papersRoot, name, format, {
    log,
    err,
    cwd,
    venue: venue.value,
  });
}

/**
 * 🔴 THE TARGET IS NAMED, "EVERYTHING" IS AN OPTION. That is how it is for everyone whose build is
 * expensive and has side effects: `make <target>`, `docker build <context>`, `latexmk paper.tex`;
 * with cargo, "the whole workspace" is turned on by a separate flag. A default of "build
 * everything" on a corpus of five papers is twenty pdflatex runs instead of one, and almost never
 * what was wanted.
 */
async function runBuild(
  a: Args,
  {
    log,
    err,
    cwd,
  }: { log: typeof console.log; err: typeof console.error; cwd: string },
): Promise<number> {
  const cfg = readConfig(a, { log, err, cwd });
  if (cfg.code !== undefined) return cfg.code;
  const roots = papersRoots(cfg);

  let targets;
  if (a.all) {
    targets = roots.flatMap((r) => papersIn(r));
    if (targets.length === 0) {
      err(
        `--all: no papers found under ${roots.join(", ") || "(nothing declared)"}`,
      );
      return 1;
    }
  } else if (a.paths.length > 0) {
    targets = a.paths.map((p) => resolve(cwd, p));
  } else {
    err(
      `\`build\` needs a target: \`paperlint build papers/my-paper\` or \`paperlint build --all\`.\n` +
        `There is deliberately no "build everything" default: a build is expensive and has side\n` +
        `effects, so the target is named — as with make, docker and latexmk.`,
    );
    return 2;
  }

  // The engine is resolved INSIDE buildPapers, after it has removed the stale PDFs: a run that
  // stops for want of a TeX Live must not leave an old paper.pdf looking current either.
  const out = await buildPapers(targets, {
    cwd,
    dryRun: a.dryRun,
    log,
    checkReferences: onlineReferences,
    engine: () => engineEnv(targets, a, { log, err }),
  });
  if (out.kind === "no-engine") return 1;
  const remedy = remedyFor(out.results);
  if (remedy) err(remedy);
  return anyFailed(out.results) ? 1 : 0;
}

/** The presets' deps, wired to the disk and the package's own venues directory. */
const PRESET_DEPS = { files: nodeFiles, venuesDir: packageVenuesDir() };

/**
 * What one paper needs from TeX Live: the base set plus its preset chain's `tex`. A paper whose
 * settings or preset do not resolve gets the base set; the build reports why at its facts step.
 */
function paperRequirements(dir: string): TexRequirements {
  const p = paperPreset(dir, PRESET_DEPS);
  return requirementsFor(p.kind === "resolved" ? p.preset : null).tex;
}

/**
 * What `paperlint toolchain` installs: every shipped preset's packages, plus the resolved chain of
 * every paper under the project's papers directory — a project's own preset lives outside the
 * package, so the shipped union alone would not see it.
 */
export function toolchainTex(cwd: string): TexRequirements {
  const cfg = readConfig(parseArgs(["toolchain"]), {
    log: () => {},
    err: () => {},
    cwd,
  });
  const roots = cfg.code === undefined ? papersRoots(cfg) : [];
  const chains = roots
    .flatMap((r) => papersIn(r))
    .map((dir) => paperPreset(dir, PRESET_DEPS))
    .flatMap((p) => (p.kind === "resolved" ? [p.preset.tex] : []));
  return declaredUnion(undefined, chains).tex;
}

/**
 * The environment the builds run in — PATH led by a TeX Live that has every package the targeted
 * papers' venues declare — or null when there is none and none was installed (the reason is
 * already printed). Papers without `paper.tex` need no engine: they are refused by the build.
 */
async function engineEnv(
  targets: readonly string[],
  a: Args,
  { log, err }: { log: typeof console.log; err: typeof console.error },
): Promise<NodeJS.ProcessEnv | null> {
  const latex = targets.filter((t) => existsSync(join(t, MAIN)));
  if (latex.length === 0) return process.env;
  const tex = latex
    .map(paperRequirements)
    .reduce(mergeRequirements, NO_REQUIREMENTS);
  const out = await prepareEngine({
    tex,
    dryRun: a.dryRun,
    interactive: processInteractivity(false).interactive,
    ask: askOnTerminal,
    log,
    err,
  });
  return out.ok ? out.env : null;
}

/** Commands that take the parsed arguments and the output streams, and nothing else. */
const SIMPLE: Readonly<
  Record<
    string,
    (
      a: Args,
      io: { log: typeof console.log; err: typeof console.error; cwd: string },
    ) => number | Promise<number>
  >
> = {
  hook: (a, { err }) => runHook(a.paths[0], { err }),
  new: (a, io) => runNew(a, io),
  build: (a, io) => runBuild(a, io),
  toolchain: (a, { log, err, cwd }) =>
    runToolchain({
      check: a.check,
      log,
      err,
      banal: hostBanalInstaller(),
      tex: toolchainTex(cwd),
    }),
};

/** banal's installer, wired from this process's environment: the composition root's work. */
function hostBanalInstaller(): ToolInstaller {
  const s = parseBanalSettings(process.env, hostDirs());
  const ports = nodeAdapters({ tmpDir: s.tmpDir });
  const download = curlDownload({
    run: ports.run,
    env: s.processEnv,
    tmpDir: s.tmpDir,
  });
  return banalInstaller({ ...ports, download }, s);
}

/** `paperlint init`: its flags checked here, the install itself in `init.ts`. */
async function runInit(
  a: Args,
  {
    log,
    err,
    cwd,
  }: { log: typeof console.log; err: typeof console.error; cwd: string },
): Promise<number> {
  // Deferred, not implemented: named and refused, rather than read as the directory argument.
  if (a.hooksMode !== null) {
    err(
      `--hooks=${a.hooksMode} is not implemented. init writes the hooks into .claude/settings.json ` +
        `(shared, committed) or, with --no-hooks, nowhere.`,
    );
    return 2;
  }
  if (a.format !== null && !isFormat(a.format)) {
    err(`--format must be one of ${FORMATS.join(", ")} — got \`${a.format}\``);
    return 2;
  }
  return await init(a.paths[0] ?? ".", {
    log,
    err,
    cwd,
    version: ownVersion(),
    yes: a.yes,
    hooks: !a.noHooks,
    paper: a.paper,
    format: isFormat(a.format) ? a.format : null,
    createPaper: (papersRoot, name, format) =>
      createPaperAt(papersRoot, name, format, { log, err, cwd }),
    tex: {
      installed: () => cachedTree(cacheRoot(process.env)) !== null,
      install: () =>
        runToolchain({
          check: false,
          log,
          err,
          banal: hostBanalInstaller(),
          tex: toolchainTex(resolve(cwd, a.paths[0] ?? ".")),
        }),
    },
    resolveCliPapers: (root: string): string | null => {
      const read = readConfig(
        { ...a, config: null },
        { log: () => {}, err: () => {}, cwd: root },
      );
      return read.code === undefined
        ? (toPaths(papersDirOf(read.opts))[0] ?? null)
        : null;
    },
  });
}

export async function run(
  argv: readonly string[],
  {
    log = console.log,
    err = console.error,
    cwd = process.cwd(),
  }: {
    log?: typeof console.log;
    err?: typeof console.error;
    cwd?: string;
  } = {},
): Promise<number> {
  const a = parseArgs(argv);
  // The refusal must come FIRST: behind a flag without a value there is usually a typo, or a
  // substitution in CI that collapsed into nothing, and any continuation works on something other
  // than what was asked for.
  if (a.missingValue) {
    err(
      `${a.missingValue} needs a value — it was given none.\n` +
        `Without it the run would silently fall back to whatever config it discovers, which is ` +
        `not what the command line said.`,
    );
    return 2;
  }
  if (a.unknownFlag !== undefined) {
    err(
      `unknown flag \`${a.unknownFlag}\` — \`paperlint --help\` lists every flag`,
    );
    return 2;
  }
  if (a.help || !a.cmd) {
    log(USAGE);
    return a.help ? 0 : 2;
  }
  // `init` asks the CLI's OWN reader what it would lint, so the two sides `doctor` compares are
  // not two implementations of the same question. A second resolver here is the defect the
  // comparison exists to catch.
  if (a.cmd === "init") return await runInit(a, { log, err, cwd });
  // `doctor` reads the config but must NOT die on a broken one — reporting that the config is
  // broken is precisely its job. So a failed read becomes "the CLI would lint nothing", which is
  // what it prints, rather than an early exit that tells the reader nothing about the hooks.
  if (a.cmd === "doctor") {
    const read = readConfig(a, { log: () => {}, err: () => {}, cwd });
    const papers =
      read.code === undefined
        ? (toPaths(papersDirOf(read.opts))[0] ?? null)
        : null;
    return doctor({
      log,
      cwd,
      projectDir: process.env["CLAUDE_PROJECT_DIR"] ?? cwd,
      cliPapers: papers,
    });
  }
  const simple = SIMPLE[a.cmd];
  if (simple) return await simple(a, { log, err, cwd });
  if (a.cmd === "check")
    err(
      `\`check\` is now \`lint\` — running it anyway. Update the call to \`paperlint lint\`.`,
    );
  if (a.cmd !== "lint" && a.cmd !== "check") {
    err(`unknown command \`${a.cmd}\`\n\n${USAGE}`);
    return 2;
  }

  const cfg = readConfig(a, { log, err, cwd });
  if (cfg.code !== undefined) return cfg.code;
  const { opts, root } = cfg;

  // A command-line argument OVERRIDES the config: one paper out of the corpus gets linted without
  // editing a file.
  //
  // 🔴 A path FROM THE CONFIG is resolved relative to the PROJECT ROOT, not the current directory.
  // Otherwise walking up is pointless: from `papers/aisec-2026` the root would be found, but
  // `"papersDir": "papers"` would point at `papers/aisec-2026/papers`. A command-line argument stays
  // relative to the current directory: it was typed here and now.
  //
  // Both kinds end up ABSOLUTE: ESLint below runs from `lintRoot`, not from here, and would resolve a
  // relative argument against the wrong directory.
  const paths =
    a.paths.length > 0 ? a.paths.map((p) => resolve(cwd, p)) : papersRoots(cfg);
  if (paths.length === 0) {
    err(
      `nothing to lint: "${PAPERS_DIR_FIELD}" names no directory. Pass one: \`paperlint lint papers\`.`,
    );
    return 2;
  }
  // 🔴 NO PAPERS WHERE THE CONFIG POINTS IS AN ERROR, NOT A CLEAN RUN. With the default in play the
  // directory may simply not exist yet; a run over nothing would be green and say nothing.
  if (a.paths.length === 0) {
    const empty = paths.find((p) => papersIn(p).length === 0);
    if (empty !== undefined) {
      err(noPapersMessage(relative(cwd, empty) || "."));
      return 2;
    }
  }

  // 🔴 STRUCTURE IS CHECKED BEFORE ESLint AND SEPARATELY FROM IT. A rule is invoked for the file
  // handed to it; a missing file is never handed over, so no rule at all can report the absence —
  // a directory without `PIPELINE-STATUS.md` simply gets not a single rule and reports clean. The
  // analysis of why a structure plugin for ESLint does not cure this is in `structure.mjs`.
  const structure = checkStructure(paths, opts.structure, { cwd });
  // The order, most general first so the most specific wins (ESLint: a later block wins): each
  // paper's venue preset → the root paperlint.json → the paper's own paperlint.json.
  const papers = paperRuleBlocks(paths);
  if (!papers.ok) return (err(papers.error), 2);
  const withPapers = {
    ...opts,
    rules: [...papers.value.preset, ...(opts.rules ?? []), ...papers.value.own],
  };

  let texLanguage: unknown = null;
  try {
    // @ts-expect-error — the module is .mjs and has no types; a missing LaTeX parser is a normal
    // case here, it is caught by the catch below.
    ({ texLanguage } = await import("../eslint-rules/latex-language.mjs"));
  } catch {
    /* without a LaTeX parser we work over markdown */
  }

  const eslint = new ESLint({
    cwd: lintRoot(root, paths),
    overrideConfigFile: true,
    overrideConfig: buildConfig(withPapers, texLanguage) as Linter.Config[],
    fix: a.fix,
  });

  const unowned = await firstUnownedFile(eslint, paths);
  if (unowned !== null) {
    err(
      `${relative(cwd, unowned) || unowned} is not a file paperlint lints — it lints ${PAPER_FILE_PATTERNS.join(", ")}`,
    );
    return 2;
  }

  // 🔴 ESLint THROWS on an empty set (`NoFilesFoundError`) — the guard below simply never got
  // reached, which is what the very first run over an empty directory showed: instead of a clear
  // message a stack from the depths of eslint-helpers.js flew out. A failure stays a failure, but
  // an explicable one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- #49: replace with a real type
  let results: any[];
  try {
    results = await eslint.lintFiles(paths);
  } catch (e) {
    if (isEmptySet(e)) results = [];
    else throw e;
  }

  // `--fix` writes what the rules fixed; the report below is what is LEFT.
  if (a.fix) await ESLint.outputFixes(results);

  // 🔴 THE GUARD AGAINST A GREEN ZERO, the same one as in action.yml and for the same reason:
  // ESLint exits zero when there are no findings, and "no findings" is byte-for-byte
  // indistinguishable from "not a single rule got a single file". A rule whose glob did not match
  // is not invoked — and, not being invoked, it physically cannot report that.
  if (results.length === 0) {
    err(
      `nothing was linted under ${paths.map((x) => relative(cwd, x) || x).join(", ")} — no PIPELINE-STATUS.md, paper.md/tex or reviews/ found there. A clean report over zero files is not a clean report.`,
    );
    return 1;
  }

  return await reportLint(eslint, results, structure, {
    a,
    log,
    err,
    where: relative(cwd, root) || ".",
    opts: withPapers,
    // Every paper of the project, not only the ones on the command line (#103).
    projectPapers: papersRoots(cfg)
      .flatMap((r) => papersIn(r))
      .map((d) => join(d, MAIN))
      .filter((f) => existsSync(f)),
  });
}

/**
 * The first path that is a FILE paperlint does not lint, or null. ESLint would answer such a file
 * with a warning result ("File ignored because of a matching ignore pattern"), which counts as a
 * linted file and turns a run over nothing into a green one. The question is asked of ESLint's
 * own matcher, against the same scope that decides what a directory yields.
 */
async function firstUnownedFile(
  eslint: ESLint,
  paths: readonly string[],
): Promise<string | null> {
  for (const p of paths)
    if (
      existsSync(p) &&
      statSync(p).isFile() &&
      (await eslint.isPathIgnored(p))
    )
      return p;
  return null;
}

/**
 * ESLint's refusals of an empty set: nothing matched (`file-not-found`), or everything that matched
 * is outside paperlint's scope (`all-matched-files-ignored` — a papers directory holding only
 * vendored scripts). Both mean "nothing was linted", which the caller reports itself.
 */
const isEmptySet = (e: unknown): boolean => {
  const fail = e as { messageTemplate?: string; message?: string } | null;
  return (
    fail?.messageTemplate === "file-not-found" ||
    fail?.messageTemplate === "all-matched-files-ignored" ||
    /No files matching/i.test(fail?.message ?? "")
  );
};

/**
 * The end of `paperlint lint`: refuse an optional rule that reached no paper, print the findings, and
 * decide the exit code. Pulled out of `run` so each question has its own function.
 */
async function reportLint(
  eslint: ESLint,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- #49: replace with a real type
  results: any[],
  structure: ReturnType<typeof checkStructure>,
  {
    a,
    log,
    err,
    where,
    opts,
    projectPapers,
  }: {
    a: Args;
    log: typeof console.log;
    err: typeof console.error;
    where: string;
    opts: PaperlintConfig;
    projectPapers: readonly string[];
  },
): Promise<number> {
  const silent = await silentOptionalRules(
    eslint,
    [...results.map((r) => r.filePath), ...projectPapers],
    opts,
  );
  if (silent.length > 0) {
    err(
      `${silent.join(", ")} is turned on in "rules", but no paper.tex of the project gets it — check the block's ` +
        `"files" (relative to ${where}). A rule that never runs reports exactly like a rule that passed.`,
    );
    return 1;
  }

  if (a.json)
    log(JSON.stringify([...asEslintResults(structure), ...results], null, 1));
  else {
    // Missing things are printed FIRST: they explain why the report below may be suspiciously
    // short. The reverse order would read as "all clean — oh, and also this".
    if (structure.length > 0) log(formatStructure(structure));
    const out = await (await eslint.loadFormatter("stylish")).format(results);
    log(
      out.trim() ||
        (structure.length > 0
          ? ""
          : `✓ ${results.length} file(s) checked, no findings`),
    );
  }
  if (structure.length > 0 || results.some((r) => r.errorCount > 0)) return 1;
  // Warnings fail the run only when the threshold is named EXPLICITLY. A negative threshold means
  // "do not count them at all", and that is the default.
  if (a.maxWarnings >= 0) {
    const warnings = results.reduce((n, r) => n + r.warningCount, 0);
    if (warnings > a.maxWarnings) {
      err(
        `${warnings} warning(s) exceed the --max-warnings limit of ${a.maxWarnings}`,
      );
      return 1;
    }
  }
  return 0;
}

// 🔴 `isMain`, NOT A STRING COMPARISON. The first version wrote
//     if (import.meta.url === `file://${process.argv[1]}`)
// and the utility, launched via `node_modules/.bin/paperlint`, SILENTLY EXITED WITH ZERO: npm puts a
// SYMLINK there, `process.argv[1]` stays the symlink's path while `import.meta.url` is the real
// path, and the condition is false. That is, the only way a real consumer launches the utility did
// not work at all — and it looked like a clean run.
// The helper WAS ALREADY in the package, and its docstring describes exactly this failure
// verbatim: "turns a CLI into a no-op that exits 0". I wrote by hand what was lying there ready.
if (isMain(import.meta.url)) process.exit(await run(process.argv.slice(2)));
