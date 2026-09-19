# research-paper-pipeline

Checks for an academic paper that lives in a git repository and is written with an AI coding
agent (Claude Code). It ships two things:

- **<!-- count:skills -->24 skills** — instruction files the agent reads, one per stage of writing a paper: decide
  whether the idea is worth it, pick a venue, run the study, draft, tighten, red-team, simulate
  the program committee, submit, camera-ready, extend into a second paper.
- **<!-- count:rules -->12 rules and 3 hooks** — machine checks that verify what those stages _claim_. Each paper
  keeps a scorecard file, `PIPELINE-STATUS.md`. A skill writes "submitted on this date, this PDF,
  this many bytes" into it; a rule then reads the scorecard and compares it with the files on
  disk. The rule never trusts the skill's word.

CLI name: `rpp`. Requires Node 22.13 or newer.

## Install and first run

Not on npm yet — install from GitHub, pinned to a commit:

```sh
npm i -D github:zernie/research-paper-pipeline#<commit-sha>
npx rpp init               # sets the project up and reports its own condition
```

Then two lines inside Claude Code, which `init` prints for you — they are typed into a different
program and nothing on disk can type them for you:

```
/plugin marketplace add zernie/research-paper-pipeline
/plugin install research-paper-pipeline@research-paper-pipeline
```

That is the whole install: three actions. `init` **measures** rather than asks wherever it can —
it finds the directory your papers live in by looking for one whose subdirectories carry a paper
file, writes that as a single declaration into your `package.json`, and prints which external
programs are missing and the command that installs each. It asks exactly one question, and only
when stdin is a terminal: whether to write a GitHub Actions workflow. In CI, or under a script, it
asks nothing and says which default it took. It installs nothing — see
[`docs/install.md`](docs/install.md) for the eight tools that were measured to arrive at that
shape.

Afterwards:

```sh
npx rpp doctor             # says what is actually wired — and what only LOOKS wired
npx rpp lint               # runs every rule over the declared directory
npx rpp build <paper>      # builds one paper with ITS OWN build script
```

🔴 **`init` ends by running `doctor`, and exits with its verdict — believe that over the absence
of errors.** There is one declaration now, but the linter and the hooks still read it separately,
and a guard watching an empty directory looks exactly like a guard that is working, because
silence is its success state. `doctor` prints both directories side by side and exits non-zero
when they are not the same. The defect that made this necessary is
[#33](https://github.com/zernie/research-paper-pipeline/issues/33).

`rpp lint` finds the declaration by walking up from the current directory, the way eslint and tsc
find theirs, so it works from anywhere in the repository. Pass a path to lint something else for
one run: `rpp lint papers/my-paper`.

The scope always comes from one of those two, never from a default. Linting `"."` would pass over
whatever happens to be in the checkout and report green on a scope nobody chose.

The exit code is `1` when any rule reports an error, and also `1` when _nothing_ was linted —
a clean report over zero files is not a clean report. `--json` prints machine-readable findings.

(The command used to be `rpp check`. That still runs and tells you what replaced it. `check`
elsewhere in the ecosystem — `cargo check`, `tsc --noEmit` — means "build but emit nothing", and
building the paper is a separate job this CLI is growing.)

## What else has to be on the machine

`rpp lint` needs nothing but Node — it reads your files and reports. **The skills are a different
matter**: they build PDFs, read them back, and run external checkers, so they call programs this
package does not ship.

| program                | comes from                       | which skills call it                     | what happens without it                                            |
| ---------------------- | -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `pdflatex`, `bibtex`   | TeX Live                         | render-paper, submit-paper, camera-ready | no PDF is produced — loud                                          |
| `pdfinfo`, `pdftotext` | poppler-utils                    | render-paper, submit-paper               | checks that read the built PDF report that they did not run        |
| `texcount`             | TeX Live (`texlive-extra-utils`) | render-paper, grade-paper-writing        | the length checks cannot run                                       |
| `checkcites`           | TeX Live                         | render-paper                             | nothing asks whether a bibliography entry is uncited               |
| `java`                 | any JRE (21 works)               | render-paper                             | TeXtidote does not run, and **nothing else spell-checks the text** |
| `python3`              | your system                      | the analysis and report scripts          | those scripts do not start                                         |
| `tlmgr`                | TeX Live                         | the TeX installer itself                 | you cannot add a TeX package                                       |

🔴 **Most of these fail QUIETLY**, which is why they are listed rather than left to be discovered.
A missing checker and a passing checker look identical from outside, so every script here states in
its last line which checks actually ran — read that line, not the exit code.

### TeX Live: 298 MB, not 2.1 GB

The distribution packages are the expensive way. `texlive-fonts-extra` alone is **1.69 GB**, and
these papers use **71 MB** of it — apt cannot install less, because Debian does not split those
font families into separate packages.

So install TeX Live directly instead, by name:

```sh
bash node_modules/research-paper-pipeline/skills/render-paper/ci-install-texlive.sh ~/texlive
export PATH="$(find ~/texlive/bin -maxdepth 1 -mindepth 1 -type d | head -1):$PATH"
```

The bin directory is named after the platform, so it is found rather than guessed — the installer
prints the same path on its last line.

41 named packages, **298 MB**, and the script verifies every file the papers actually load before
it reports success. (The `ci-` in the name is historical — there is nothing CI-specific inside.)

An apt list is kept in `skills/render-paper/ensure-toolchain.sh` for machines that cannot reach
CTAN. It works, and it costs 2.1 GB.

### The external checkers

`aclpubcheck` (the official ACL format checker), TeXtidote (spelling) and `rebiber` are not TeX
packages and not npm packages. One idempotent command installs them and then **proves each one
starts**:

```sh
bash node_modules/research-paper-pipeline/skills/render-paper/ensure-checkers.sh
```

```
   ✅ aclpubcheck
   ✅ rebiber
   ✅ jinja2
   ✅ textidote (/opt/textidote/textidote.jar)
✅ all checkers are installed AND run
```

It checks that the tools RUN, not that pip exited zero — `aclpubcheck --help` prints usage and
exits zero on an interpreter where its own dependencies do not import, so "installed" and "works"
are separate questions here.

## How the pieces fit

```
   YOU + CLAUDE CODE                          THE PACKAGE
   ───────────────────                        ───────────────────────────────────

   research-ideate ─► map-prior-work ─► find-venue ─► plan-paper-timeline
         │                                                 │
         ▼                                                 ▼
   build-benchmark ◄──► draft-paper ◄──► argument-arc      (loop until the argument holds)
         │
         ▼
   tighten-paper ─► grade-paper-writing ─► pc-panel-review ─► harden-paper ─► submit-paper
         │                                                                        │
         ▼                                                                        ▼
   camera-ready ─► extend-paper                                          (accepted? start over)

   each skill WRITES a row               ┌──────────────────────────┐
   into the scorecard ─────────────────► │ papers/<name>/           │
                                         │   PIPELINE-STATUS.md     │
                                         │   paper.tex / paper.md   │
                                         │   reviews/*.md           │
                                         │   versions/<date>-*.pdf  │
                                         └────────────┬─────────────┘
                                                      │
                                    rules READ the scorecard and compare it
                                    with the files beside it (bytes, dates, names)
                                                      │
                                                      ▼
                                                  npx rpp lint
                                              (locally, and in CI via action.yml)
```

The skills do the writing. The rules check that what was written down actually happened.
The 3 hooks (below) sit in the editor and remind the agent to run the right skill at the
right moment.

## The scorecard

Every paper directory carries a `PIPELINE-STATUS.md`. Its YAML front matter declares the stages
the paper has reached. Minimal example:

```markdown
---
stages:
  - stage: submitted
    date: 2026-07-22
    venue: A Venue 2026
    pdf: versions/2026-07-22-submitted.pdf
    bytes: 305412
    source: versions/2026-07-22-submitted.tex
    sourceBytes: 57210
---

# PIPELINE-STATUS

| id | status | date | result |
| ... one row per stage the skills ran ... |
```

A template with every row explained is in `skills/paper-pipeline/references/pipeline-status-template.md`.

## What the rules check

| Rule                           | Reads                   | Fails when                                                                                                     |
| ------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `paper/stages`                 | `PIPELINE-STATUS.md`    | a declared stage has no PDF on disk, the byte count differs, or a frozen PDF exists with no declaration        |
| `paper/source`                 | `PIPELINE-STATUS.md`    | a declared stage has no frozen `.tex` beside its PDF (a commit hash does not count — squash and gc destroy it) |
| `paper/author-list`            | `PIPELINE-STATUS.md`    | a paper was submitted but the scorecard never recorded an author-list check of the bibliography                |
| `paper/research-question`      | `paper.tex`, `paper.md` | the paper shipped without stating its research question                                                        |
| `paper/typography`             | `paper.tex`, `paper.md` | mechanical conventions a reviewer already flagged got _worse_ (existing debt is tolerated, growth is not)      |
| `tex/future-promise`           | `paper.tex`             | a camera-ready build still says "will be released" about something already handed over                         |
| `tex/acm-frontmatter-override` | `paper.tex`             | an `acmart` build overrides ACM's front-matter commands and drops template elements from page 1                |
| `review/findings-cause`        | `reviews/*.md`          | a review report lists findings but does not say which pipeline step let them through                           |
| `doc/fields`                   | `reviews/*.md`          | a front-matter field is missing or holds a value outside the list you configured                               |

Errors fail the run. Warnings print and do not. Three more rules guard the package's own code
and do not run on your papers.

## The declaration

One key in your `package.json`, written by `rpp init`. It holds the facts only your repository can
supply — nothing in it is guessable by a package that has never seen your corpus.

It lives there rather than in a file of its own because of a count: the `package.json` key has
**five** readers — the three editor hooks, the ESLint helper, the skill scripts — and a separate
config file had **one**, the CLI. A hook cannot import code and cannot walk up a tree looking for
a config; it can read a path it is able to name, and the one path it can always name is the
project's `package.json`.

`rpp lint` looks for it in the current directory and then upwards, and prints which file it found.
`--config <file>` overrides the search.

```json
{
  "research-paper-pipeline": {
    "papers": "papers",
    "authorListCommand": "node scripts/bib-authors.mjs",
    "typographyDebt": { "papers/my-paper": { "sectionSign": 12 } },
    "docFields": { "read": { "values": ["full", "abstract", "none"] } },
    "reviewSince": "2026-08-23",
    "minFindings": 3,
    "causeMarker": "Cause:"
  }
}
```

⚠️ **`rpp.json` is deprecated and still read.** Earlier versions of `init` created it; `init` no
longer does, and a run that reads one says so on its first line. The hooks never read it, so
leaving settings there is how the linter and the guard end up watching different directories —
`rpp init` copies the value across for you.

| key                 | required | what it is                                                                         |
| ------------------- | -------- | ---------------------------------------------------------------------------------- |
| `papers`            | **yes**  | the directory your papers live in, relative to the file holding it. One string or a list. |
| `structure`         | no       | which files every paper directory must contain — see below. `false` turns it off.  |
| `authorListCommand` | no       | prints the author list from your `.bib`, so a rule can compare it with the PDF     |
| `typographyDebt`    | no       | per-paper allowance of existing typography findings, so the count can only go down |
| `docFields`         | no       | front-matter fields your review notes must carry, and the values each may hold     |
| `reviewSince`       | no       | ignore review findings filed before this date                                      |
| `minFindings`       | no       | how many findings a cold read must produce before it counts as a cold read         |
| `causeMarker`       | no       | the word your review notes use to introduce a cause, e.g. `Cause:`                 |

`papers` is required because the scope is the one thing that must not default: a default of `"."`
turns every run into a green report over the whole checkout. `rpp init` fills it by measuring —
and when nothing on disk looks like a papers directory, it writes the documented default and says
in the same breath that it is a guess.

## Building a paper

```sh
npx rpp build papers/my-paper     # one paper — the target is named, like `make` or `docker build`
npx rpp build --all               # every paper under `papers`; opt-in, never the default
npx rpp build --all --dry-run     # name the script that WOULD run, and where none exists
```

`rpp build` does not compile anything itself. It finds the paper's **own** build script and runs
it, because building a paper is not a generic loop: one paper in the corpus this was written
against needs `TEXINPUTS` pointing at venue files its preamble `\input`s, another runs a dozen
compiles hunting the right position for `\balance`. A package that has never seen your paper
cannot know either.

It looks for these, in order, and the first one found wins:

| path                        |                                                        |
| --------------------------- | ------------------------------------------------------ |
| `build.sh`                  | in the paper directory — what you see when you open it |
| `repro/build-submission.sh` | the reproduction-artifact convention                   |

Override with `"buildScripts": [...]` in the declaration.

**A paper with no build script is a FAILURE, not a skip**, and that is the whole point of the
command. The corpus this came from had a CI loop looking for `repro/build-submission.sh` while the
accepted paper shipped `build.sh`; the mismatch read as "nothing to build", and the paper reached
its venue without a single paper job having run on it. `--dry-run` answers "which papers can
nobody build?" in a second, without spending twenty compiles to ask.

## Required files

A rule runs on a file it was handed. A file that is missing is never handed to anything — so no
rule can report it, and a paper directory without `PIPELINE-STATUS.md` gets **zero** rules and a
clean report. `rpp lint` therefore checks presence itself, before ESLint runs.

Detection is generous and requirements are strict, on purpose. A directory counts as a paper only
once it already holds one of the marker files, so `research/`, `plans/` and other neighbours in
the corpus are left alone; an error-level check that fires on a correct tree gets switched off,
and the real findings leave with it.

```json
"structure": {
  "markers":      ["PIPELINE-STATUS.md", "paper.tex", "paper.md", "venue.json"],
  "require":      ["PIPELINE-STATUS.md"],
  "requireOneOf": [["paper.tex", "paper.md"]],
  "ignore":       []
}
```

Those are the defaults; you only write the block to change them. They were measured against a
real five-paper corpus rather than chosen — it passes with zero findings, while adding
`paper.pdf` to `require` produces two findings on papers that are perfectly fine, which is why it
is not there.

This is the half [ls-lint](https://ls-lint.org/) cannot do. ls-lint judges the **names** of files
that exist; it has nothing to compare against for a file that does not. Use both: ls-lint for
"what is there is named right", this for "what must be there is there".

- `authorListCommand` — the command `paper/author-list` tells you to run when the check is missing.
- `typographyDebt` — per-paper counts of known typography issues; the rule stays quiet at or below them.
- `docFields` — required front-matter fields in review files and their allowed values.
- `reviewSince` — only review files created on or after this date are checked.
- `minFindings` — a review with fewer findings than this is not required to name causes.
- `causeMarker` — the phrase a review uses to name a cause (default `Cause:`). Set it to
  whatever your reviews actually write, in any language.

## In CI

The repository ships a GitHub composite action. Add one step:

```yaml
- uses: zernie/research-paper-pipeline@<commit-sha>
  with:
    paths: papers
```

The action runs `rpp lint`, so CI and your terminal execute the same code — including the
required-files check and the declaration. `paths` is required, and the job refuses to pass when zero
files were linted, so a typo in the path shows up red instead of green. Optional inputs: `config`
(a path to the file holding the settings, only when the upward search cannot reach it), `max-warnings` (default `-1`,
warnings never fail the job), `texcount` (default `true`; set to `false` if you have no `texcount/*` rules of your
own — this package ships none), `working-directory`.

## Skills and hooks in Claude Code

**The two doors deliver different things, and it is worth knowing which is which.** The
<!-- count:skills -->24 skills arrive with the **npm package** — they sit in
`node_modules/research-paper-pipeline/skills/`, and Claude Code reads them from there. The
**plugin** carries the hook wiring and nothing else: `plugin/` holds one file, `hooks/hooks.json`,
and its manifest says so — *"this plugin carries no code and no dependencies on purpose"*. The
hooks call the runtime that the npm install already put in your project, which is why the plugin
can stay empty.

That split is deliberate, and it is also forced: a plugin fetched from npm gets **no**
`node_modules` at all, silently — `npm pack` strips `package-lock.json` unconditionally, and the
host runs `npm ci` only when a lockfile is present in the fetched copy (measured 2026-09-19,
scripts in [`docs/prior-art/repro/`](docs/prior-art/repro/README.md)). A plugin that carried the
skills would therefore carry scripts it could not run.

So: `npm i` gives you the skills, the rules and the CLI. Then two lines inside Claude Code give
you the hooks:

```
/plugin marketplace add zernie/research-paper-pipeline
/plugin install research-paper-pipeline@research-paper-pipeline
```

`/paper-pipeline` is the entry point to the skills; it routes to the rest. The three hooks:

| Hook                 | When                           | What it does                                                                                             |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `paper-edit-guard`   | before a Bash command          | blocks writing a paper source from Bash, because a Bash write skips every check that hangs on Edit/Write |
| `paper-skills-nudge` | after an Edit/Write on a paper | shows the agent the pre-submit checklist                                                                 |
| `paper-status-gates` | after an Edit/Write on a paper | reads that paper's scorecard and lists the gates that have not run yet                                   |

The hooks look for papers under `papers/`. To use another directory, declare it once in your
`package.json`:

```json
{ "research-paper-pipeline": { "papers": "docs/papers" } }
```

## How reliable are the checks

Every rule is tested two ways: it has to catch a planted mistake, and it has to stay quiet on a
correct file. Both halves matter, because a broken check and a clean file look identical from
the outside. The test suite also deletes one load-bearing line from each rule and confirms the
right test goes red.

<details>
<summary>Already have an ESLint config? Use the rules directly</summary>

Under the hood `rpp lint` builds an ESLint flat config and runs it. If your repository already
lints with ESLint, you can import the rule modules from `research-paper-pipeline/eslint-rules/`
and wire them yourself; `bin/rpp.mjs` exports `buildConfig(options, texLanguage)` that returns
the exact config the CLI uses, so the shortest path is:

```js
// eslint.config.mjs
import { buildConfig } from "research-paper-pipeline/bin/rpp.mjs";
import { texLanguage } from "research-paper-pipeline/eslint-rules/latex-language.mjs";
export default buildConfig({ minFindings: 3 }, texLanguage);
```

Then point the CI action's `config` input at that file.

</details>

## Contributing

Layout, test commands, and how to add a rule or a skill are in `CONTRIBUTING.md`.

## License

MIT.
