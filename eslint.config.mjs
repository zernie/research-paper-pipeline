/**
 * ESLint configuration for this repository's OWN fixtures.
 *
 * It is not the configuration a consumer will use — a consumer points the same block at the
 * path of its own paper (`papers/<name>/paper.tex` or wherever the source actually lives).
 * What is reusable here is the SHAPE: one plugin object carrying both the language and the
 * rules that read LaTeX source, one `language:` line, and an explicit severity per rule.
 *
 * 🔴 The glob matters more than it looks. A rule whose glob matches nothing is not "clean" —
 * it is never invoked, and the run reports exactly the same green as a rule that passed. That
 * is why `scripts/rules-see-files.mjs` exists and why it runs as part of the test suite:
 * every rule declared below must be enabled for at least one file that is actually on disk.
 */
import { texLanguage } from "./eslint-rules/latex-language.mjs";
import texBuild from "./eslint-rules/tex-build.mjs";
import markdown from "@eslint/markdown";
import reviewRules from "./eslint-rules/review-findings-cause.mjs";
import localRules from "./eslint-rules/temp-root-realpath.mjs";
import portRules from "./eslint-rules/install-path-literals.mjs";

export default [
  // 🔴 TRANSIENT DIRECTORIES ARE NOT THE CORPUS, and leaving them in is a RACE, not sloppiness.
  // `paper-stages.harness.mjs` creates a temp tree under fixtures and removes it when done,
  // while `latex-language.harness.mjs` lints the whole repository to prove its glob matches
  // real files. Run in parallel, ESLint enumerates a path and then reads it, and the file can
  // be gone in between: ENOENT, in a harness that has nothing to do with either.
  //
  // Measured 2026-09-17: the race had been latent and surfaced the moment a 54th harness
  // shifted the scheduling. Nothing about the new harness was wrong — which is the point.
  // `docs/prior-art/repro/` is EVIDENCE, not source: those scripts are kept exactly as they were
  // run, so that a verdict in the design notes can be re-measured rather than argued with. Linting
  // them invites the next reader to tidy an unused import — and then the file on disk is no longer
  // the file that produced the number it backs.
  { ignores: [".tmp-stages-src-*/", "fixtures/.tmp-*/", "docs/prior-art/repro/"] },
  /**
   * 🔴 THIS BLOCK COVERS THE PACKAGE ITSELF, and before 2026-09-15 it was not here: the config held only
   * one block for `.tex` (I don't quote the glob inside this comment: the sequence
   * "star-slash" would close the comment itself — which is where I tripped), and a file with no block gets simply IGNORED by ESLint 9.
   * Meaning: 133 own `.mjs` — mutation engine, three hooks, scripts for 24 skills — went unchecked,
   * with green `npm run lint`. A tool that checks others' papers and not itself.
   *
   * Measurement on the first run: 15 files with dead imports (`resolve`, `pathToFileURL`) and
   * orphaned constants — remnants of a move from `mine`, where those names were needed. All
   * cleaned to zero in the same commit, so the rule opens as a GATE on a clean corpus,
   * not as debt to be silenced.
   *
   * ⚠️ RULES ARE ENUMERATED, NOT TAKEN AS A SET, for two reasons. First: `@eslint/js` is not
   * a dependency, and pulling it for a preset costs more than it saves with six devDeps.
   * Second, more important: enumeration makes each inclusion a DECISION, just like in the .tex
   * block below, where each line has a reason.
   *
   * 🔴 WHAT IS DELIBERATELY NOT HERE: `require-atomic-updates`. It finds three issues in
   * `verify-cites.mjs` on a classic memoizer (read `cache[ck]` → `await` →
   * write). Read from the code: citation walk is sequential, and a race in the worst case
   * is a repeat network call with an equivalent result. So on THIS corpus
   * it is a false positive, and for an `error`-level rule a false positive is worse than a miss:
   * they turn it off the same day, and the rest stop being read with it.
   * In `eslint:recommended`, by the way, it is also not there.
   */
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    plugins: { local: localRules, port: portRules },
    rules: {
      // Rule 10's mechanical half, code side. `warn` and not `error`, unlike its neighbour
      // above: this one does NOT open on a clean corpus. Two shipped modules print a command
      // for a human that names an install-specific path, and neither is fixable by the
      // answer the skills get — a printed command has to be resolved through the port at
      // runtime. Nothing freezes that number: a ratchet would say "at least not worse" on the
      // same day the rule was written, which is how a removal turns into a decision to keep.
      // The severity only keeps `npx eslint .` from being red on a healthy clone, which is how
      // a rule gets switched off and its binary neighbours ignored with it.
      "port/js-install-path": "warn",
      // 🔴 `error`, AND THIS IS A DECISION, NOT A DEFAULT. The rule is opened by a GATE on a
      // clean corpus: all fifteen venues are allowed in the same commit, so there's no debt that
      // would have to be muted. Stricter than that: the defect it catches is REPRODUCED ONLY ON
      // macOS, and CI here is just one — `ubuntu-latest`. That is, on Linux this is the only
      // guard that could ever turn red, and `warn` would mean that no one would ever see it:
      // `eslint .` exits zero on warnings.
      "local/temp-root-realpath": "error",
      // A dead import is not style, it is a sign of an incomplete edit: it says a file once
      // did something else. Fifteen such surfaced from the move.
      "no-unused-vars": "error",
      // Below are rules that silently change BEHAVIOR, not appearance: empty `catch {}` block (swallowed
      // error — a documented failure mode of this repository), constant condition, duplicate key,
      // unreachable code, fallthrough in `case`.
      "no-empty": "error",
      "no-constant-condition": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-fallthrough": "error",
      // Regexes: unnecessary escaping slash and control character in class — both findings about
      // a pattern searching for NOT what the author wrote. The subject of this repository is checks,
      // and a check searching for the wrong thing is green by construction.
      "no-useless-escape": "error",
      "no-control-regex": "error",
      "no-misleading-character-class": "error",
      "no-prototype-builtins": "error",
    },
  },
  /**
   * The package's first markdown rule — unit 1 of step 9 (moved from the consumer).
   * The block targets OWN fixtures: in the consumer the same plugin is applied to its
   * review report directory. `warn` for the same reason as .tex below: fixtures
   * are DELIBERATELY defective, and `error` would mean `npx eslint .` reds on a healthy
   * checkout. The signal lives in `npm test`, not in the warning count.
   */
  {
    files: ["fixtures/review-findings-cause/**/*.md"],
    plugins: { markdown, review: reviewRules },
    language: "markdown/gfm",
    languageOptions: { frontmatter: "yaml" },
    rules: { "review/findings-cause": "warn" },
  },
  /**
   * Rule 10's mechanical half, prose side — and this is where the debt actually is: 76
   * findings across 29 skills on a healthy checkout, every one of them a command that
   * resolves in one delivery channel and is absent in another.
   *
   * The severity is a statement about the CORPUS, exactly as in the .tex block below: the
   * finding itself is binary, but the corpus carries known debt that cannot be paid in the
   * commit that introduces the rule. That debt is an ISSUE with an owner, deliberately not a
   * frozen constant in a test — see the harness for why. `warn` keeps a clean clone from being
   * red until the paths are gone; when they are, this line becomes `error`.
   */
  {
    files: ["skills/**/*.md"],
    plugins: { markdown, port: portRules },
    language: "markdown/gfm",
    languageOptions: { frontmatter: "yaml" },
    rules: { "port/md-install-path": "warn" },
  },
  {
    files: ["**/*.tex"],
    plugins: {
      // One plugin object carries BOTH the language and the rules: `tex/latex` is the
      // language, `tex/*` are the rules about the LaTeX source itself. ESLint permits this,
      // and a second plugin name would buy nothing.
      tex: { languages: { latex: texLanguage }, rules: texBuild },
    },
    language: "tex/latex",
    rules: {
      // `warn`, and that is an analysis rather than caution. The finding is NOT binary: a
      // promise in a shipped build is sometimes honest (something genuinely not released
      // yet), and the verdict "does this contradict the Availability paragraph" is a human
      // one — which is what the message says. There is also a demonstrable class of false
      // positives: "their replication will be published in 2027" is a sentence about SOMEONE
      // ELSE's work. An `error` that fails on a correct input gets switched off the same day,
      // and then the binary checks stop being read too.
      "tex/future-promise": "warn",
      // 🔴 `warn` HERE AND `error` IN A CONSUMER, on purpose. The finding itself is binary —
      // the macro is present or it is not — and it has a named exemption (`nonacm`), so in a
      // repository that lints a REAL paper it belongs at `error`: the cost of a miss is desk
      // rejection with no review, and that asymmetry is the whole argument. This
      // repository lints fixtures broken by construction, where the same severity
      // would only mean `npx eslint .` reds on a healthy checkout. Severity is
      // a statement about the CORPUS being linted, not the rule's certainty.
      "tex/acm-frontmatter-override": "warn",
    },
    // ⚠️ `npx eslint .` therefore reports six warnings on a healthy checkout: the four defect
    // fixtures are DEFECTIVE ON PURPOSE, and that is what makes the fire half of every harness
    // real. Do not silence them by adding an ignore — a rule that lints only clean inputs is
    // one whose firing path nothing exercises, which is rule 4 wearing a different hat. The
    // pass/fail signal lives in `npm test`, not in the warning count of `npm run lint`.
  },
];
