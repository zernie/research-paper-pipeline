# Configuration reference

paperlint reads one file name at two levels, `paperlint.json`, with one schema. Both files are
optional: a project with its papers in `papers/` and no special wishes needs neither.

```
paperlint.json               the PROJECT (optional): where the papers are, the project's rules,
                             defaults for every paper
papers/
  my-paper/
    paper.tex
    PIPELINE-STATUS.md
    paperlint.json           THIS PAPER: its venue preset, its kind, its own rules — `paperlint new` writes it
venues/usenix-sec.jsonc      (optional, your own) a VENUE PRESET: format, page limits, TeX packages, rules
```

The shipped presets (`paperlint:<name>`) live in the package, under
`skills/submit-paper/references/venues/`: `acm-sigconf`, `agenticdev`, `aisec`, `realm`.

## The root `paperlint.json`

It sits beside your `package.json`. Without it every setting has its default.

```json
{
  "papersDir": "docs/papers",
  "extends": "paperlint:acm-sigconf",
  "rules": [
    {
      "files": ["docs/papers/old-draft/**"],
      "rules": { "paper/section-word": "off" }
    }
  ]
}
```

| key         | default    | what it is                                                                                 |
| ----------- | ---------- | ------------------------------------------------------------------------------------------ |
| `papersDir` | `"papers"` | the directory your papers live in, relative to this file. One string or a list. Root only. |
| `structure` | see below  | which files every paper directory must contain. `false` turns it off. Root only.           |
| `rules`     | none       | rule overrides — see [below](#the-rules-key-turning-rules-on-and-off)                      |
| `extends`   | none       | the venue preset for every paper that names none                                           |
| `kind`      | none       | the kind of paper for every paper that names none                                          |
| `pdf`       | none       | where the built PDF is, relative to each paper, when it is not `paper.pdf`                 |
| `$comment`  | —          | a note for humans (JSON Schema's comment keyword); ignored                                 |

The skill scripts read a few more root keys — `ledger`, `scripts`, `timezone`, `contactEmail`,
`citeChecks`, `triggerCases` — documented with the skills that use them.

**`paperlint lint` finds the file** by walking up from the current directory to the nearest
`paperlint.json` that is not a paper's own (a paper's sits beside its `paper.tex`); if there is
none, the project root is the nearest directory with a `package.json`. It prints which file it
found. `--config <file>` names another file of the same shape.

**No papers where `papersDir` points is an error**, not a clean run:

```
no papers in papers/ — create one with `npx paperlint new <name>`, or set "papersDir" in paperlint.json if your papers live elsewhere
```

`paperlint init` writes the root file only when something differs from the defaults: it measures
where your papers are, and writes `{ "papersDir": … }` only when that is not `papers`. A
`papersDir` already declared is kept, and nothing is measured or asked.

**Under `papersDir`, only the files paperlint's own rules are written for are linted:**
`PIPELINE-STATUS.md`, `paper.md`, `draft.md`, `paper.tex`, `reviews/*.md` and `siblings/*.md`.
Everything else — a paper's `repro/` scripts, vendored JavaScript, data files — is never handed to
ESLint, so it cannot fail the run. A file you name on the command line that is not one of these is
refused by name. `node_modules/`, `.git/` and `<papers>/.template/` are skipped.

## A paper's `paperlint.json`

```json
{
  "extends": "paperlint:aisec",
  "kind": "research",
  "rules": { "pdf/body-size": "off" }
}
```

The same keys as the root file, minus the project-only ones (`papersDir`, `structure` and the
skills' keys), which are refused here by name. **It merges over the root file:** its `extends`,
`kind` and `pdf` win; one it does not set comes from the root.

| key        | what it is                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extends`  | the venue preset the built PDF is judged against: `paperlint:<name>` (shipped) or `./path` / `../path` (your own, relative to this file) — [`rules.md`](rules.md#checks-against-the-venue) |
| `kind`     | the kind of paper (`short`, `research`, …) whose page limit applies                                                                                                                        |
| `pdf`      | where the built PDF is, relative to the paper, when it is not `paper.pdf`                                                                                                                  |
| `rules`    | rule overrides for this paper alone — `{ "<rule>": "<severity>" }`, or blocks with globs relative to the paper                                                                             |
| `$comment` | a note for humans; ignored                                                                                                                                                                 |

`paperlint new` writes this file from the template (`templates/paper/paperlint.json`, or your
`<papers>/.template/paperlint.json` if you keep one). With `--venue` it writes the venue into it:

```sh
npx paperlint new my-paper --venue agenticdev --kind short        # "extends": "paperlint:agenticdev"
npx paperlint new my-paper --venue ./venues/my-workshop.jsonc     # "extends": "../../venues/my-workshop.jsonc"
```

- A shipped name becomes `paperlint:<name>`; an unknown one exits 2 and lists the shipped presets.
- A path starts with `./` or `../` and is relative to where you run the command. It is written
  relative to the paper's `paperlint.json`, which is what `extends` is relative to.
- `--kind` must be one of the preset's kinds, and needs `--venue`. A preset with kinds and no
  `--kind` is written anyway; `new` then says that lint reports `pdf/profile` until `kind` is set.
- On a terminal without `--venue`, `new` asks for the venue (default: none) and then its kind.
- An existing `paperlint.json` is never overwritten, so `--venue` for it is refused.

Without a venue the file has `"extends": null` and a `$comment` saying what goes there. Until
`extends` names a preset (here or in the root file), `paperlint lint` gives that paper one warning,
`pdf/measured`: "this paper names no venue preset yet … set "extends" in
papers/my-paper/paperlint.json".

**Any other key is an error**, in either file, named in the message: `paperlint.json: unknown key
"papersdir"`. A misspelt key would otherwise read as "not set", and the setting you meant would
silently do nothing. The key list is `SETTINGS_KEYS` in `lib/paper-config.mjs`.

**Where a paper's rules come from, in order — a later one wins, rule by rule:** paperlint's own
configuration → the preset chain's `rules`, from the root preset to the one the paper extends →
the root `paperlint.json`'s `rules` → the paper's own `rules`. So a venue can turn a rule on, the
project can change that for every paper, and one paper can still change it for itself. Only rules
paperlint ships may be named, at every level.

## Records in frontmatter, checked by shipped JSON Schemas

Two kinds of file under a paper keep a record in their YAML frontmatter, and paperlint validates
each against a JSON Schema it ships (`eslint-rules/*.schema.json`):

- **a review** under `reviews/` (`review/frontmatter`, error) — its findings, each with a status and,
  when open, the pipeline cause that let it through:

  ```yaml
  ---
  findings:
    - id: 1
      status: open # open | fixed | wontfix
      cause: missing-skill # skill-defect | missing-skill | hook | rule — required when open
  ---
  ```

  A review with no `findings` key is not checked for findings.

- **a sibling card** under `siblings/` (`sibling/frontmatter`, warn; `siblings/README.md` is the index,
  not a card) — how much of the competing paper was actually read: `read: full | abstract | none`. A
  card without it, or without frontmatter, is a finding.

## The `rules` key: turning rules on and off

`rules` takes two shapes, in either file:

- **`{ "<rule>": "<severity>" }`** — for every paper file in the file's scope: every paper in the
  root file, that one paper in a paper's file. The simple form, with no glob to get wrong.
- **a list of blocks** in ESLint's own
  [flat-config shape](https://eslint.org/docs/latest/use/configure/configuration-files), limited to
  the three keys that make sense in JSON — `files`, `ignores` and `rules` — for a rule across some
  papers but not others.

paperlint applies them **after** its own configuration, so, as in ESLint, a later one wins: they
can turn on a rule that is off by default, or change the severity of one that is on.

```json
"rules": [
  {
    "files": ["papers/**"],
    "rules": { "pdf/body-size": "off" }
  },
  {
    "files": ["papers/old-draft/**"],
    "rules": { "paper/section-word": "off" }
  }
]
```

- **`files` and `ignores` are globs relative to the file that holds them** — the project root for
  the root file, the paper for a paper's — exactly as ESLint resolves them relative to its config file,
  whatever directory you run `paperlint lint` from. A block without `files` applies to every linted file.
  A pattern ending in `/**` is the usual way to name one paper.
- **Each rule reaches only the files it is written for.** A block with `"files": ["papers/**"]` and
  `"rules": { "paper/source": "warn" }` turns `paper/source` on for every `PIPELINE-STATUS.md` under
  `papers/`; `paper/section-word` in the same block lands on every `paper.md`, `draft.md` and
  `paper.tex`. You do not need to know which file a rule reads: your `files` narrow where it runs,
  never widen it. The [rule tables](rules.md) name each rule's file.
- **A rule entry** is a severity (`"off"`, `"warn"`, `"error"`, or `0`/`1`/`2`), or a list whose
  first element is a severity and the rest are the rule's options.
- **Only rules paperlint ships can be named** — the ones in [`docs/rules.md`](rules.md) and
  [`docs/optional-rules.md`](optional-rules.md). A rule id paperlint does not ship, a bad severity, a
  `rules` of another shape, or a block key other than `files`, `ignores` and `rules` stops the run
  with a message naming the exact key, before anything is linted.
- **An optional rule you turned on must reach a paper.** If no linted `paper.tex` gets the rule —
  usually a `files` glob with a typo — `paperlint lint` fails and says so: a rule that never runs
  reports exactly like one that passed.

## Required files

A rule runs on a file it was handed. A file that is missing is never handed to anything — so no
rule can report it, and a paper directory without `PIPELINE-STATUS.md` gets **zero** rules and a
clean report. `paperlint lint` therefore checks presence itself, before ESLint runs.

Detection is generous and requirements are strict, on purpose. A directory counts as a paper only
once it already holds one of the marker files, so `research/`, `plans/` and other neighbours in
the corpus are left alone; an error-level check that fires on a correct tree gets switched off,
and the real findings leave with it.

```json
"structure": {
  "markers":      ["PIPELINE-STATUS.md", "paper.tex", "paper.md", "paperlint.json"],
  "require":      ["PIPELINE-STATUS.md"],
  "requireOneOf": [["paper.tex", "paper.md"]],
  "ignore":       []
}
```

Those are the defaults; you only write the block to change them. `paper.md` is still in them
because Markdown papers are deprecated but not yet removed
([#57](https://github.com/zernie/paperlint/issues/57)). They were measured against a
real five-paper corpus rather than chosen — it passes with zero findings, while adding
`paper.pdf` to `require` produces two findings on papers that are perfectly fine, which is why it
is not there.

This is the half [ls-lint](https://ls-lint.org/) cannot do. ls-lint judges the **names** of files
that exist; it has nothing to compare against for a file that does not. Use both: ls-lint for
"what is there is named right", this for "what must be there is there".

## How `paperlint build` compiles a paper

`paperlint build <paper>` compiles `paper.tex` to `paper.pdf` itself, with TeX Live's `pdflatex` and
`bibtex` ([`docs/toolchain.md`](toolchain.md)). There is nothing to configure and no script to
write. It prints its plan first, one line per step, then runs it:

```
papers/my-paper
  inputs: TEXINPUTS += <paperlint>/skills/submit-paper/references/venues
  compile: paper.tex (\documentclass[sigconf,screen]{acmart}, venue agenticdev)
  measure: pdf.js → _build/paper.facts.json (facts for the lint rules; nothing is judged here)
  ✓ paper.pdf — 4 pdflatex passes, 1 bibtex run; facts: _build/paper.facts.json, last page 621.5 / 264.8 pt
```

- **inputs** — paperlint's own venue files (`paper-guards.tex`, `<venue>.tex`) are put on `TEXINPUTS`,
  so `\input{paper-guards}` in a preamble resolves with no setup. The system tree still resolves
  after them.
- **compile** — `pdflatex -interaction=nonstopmode -halt-on-error -file-line-error`, then `bibtex`
  when the `.aux` names a bibliography, then pdflatex again until the `.aux`, `.toc`, `.out` and
  `.bbl` stop changing and the log stops asking for a rerun. bibtex runs again only when the cited
  keys or a `.bib` file changed. After that, one **final** pass defines `\finalpass`, which arms
  the reference guards in `paper-guards.tex`: an undefined `\ref` or `\cite` fails the build
  there instead of printing `??`. A document that still changes after five passes fails, naming
  the file that kept changing.
- **measure** — after a green compile, the PDF is read with pdf.js and what it measures is written
  to `_build/paper.facts.json`: the page count, every font the pages draw text with (and whether
  its program is embedded, and whether it is Type 3), and the heights of the last page's two
  columns — or why they were not measured (a stub page of a few lines, or a review build with
  numbered lines). [banal](https://github.com/kohler/hotcrp/blob/master/src/banal) — installed by
  `paperlint toolchain`, or a project's own `vendor/banal` or `$BANAL` — adds the page size, column count
  and font sizes, measured from the same pdf.js read (no poppler; see
  [`toolchain.md`](toolchain.md#page-geometry-banal-without-poppler)); without banal those fields
  are `null` and the build says so. A PDF pdf.js cannot read fails the build. The file is
  written by one function, which `skills/render-paper/extract-pdf-facts.mjs` also calls for PDFs
  paperlint did not build. Keep `_build/` out of git: the facts carry the PDF's SHA-256, and a rule
  refuses facts about a different PDF than the one on disk.

The build does **not** judge the layout. A balanced last page, a page limit, the fonts a venue
wants — those are verdicts about the finished PDF, and they belong to lint rules that can be
turned on per venue, given a severity and suppressed with a reason: the `pdf/` venue rules
([`rules.md`](rules.md#checks-against-the-venue)) and the optional `pdf/last-page-balance`. paperlint once searched for a
`\balance` position itself and failed the build when none worked; that was removed on
2026-09-24.

The class and its options and the venue in `paperlint.json` are read from the paper and shown in the
plan; later steps decide from them whether they apply.

**`paper.pdf` is deleted before anything runs**, for every targeted paper — before the TeX Live is
chosen and before the first step. So no outcome leaves an old PDF looking current: not a failed
build, not a run that stops because there is no TeX Live with the packages the papers need, not a
paper with no `paper.tex`. A green `✓ paper.pdf` therefore always means this run wrote it, and a
pdflatex that exits 0 without writing one (a document with no pages) is a failure:

```
  ✗ compile: pdflatex exited 0 but wrote no paper.pdf — does the document have any pages?
```

**On failure** the command names the program that failed, quotes the first error line from the log
with its `l.NNN` source context, and says the PDF is gone — the same line on every path that ends
without a new one:

```
  ✗ compile: pdflatex exited with 1
      ./paper.tex:6: Undefined control sequence.
      l.6 Text before, then \undefinedmacro
                                           {} after.
      full log: papers/my-paper/paper.log
      paper.pdf removed — a stale PDF must not pass for this build
```

**A paper with no `paper.tex` is a FAILURE, not a skip.** "Nothing to build" and "built" must never
look alike: the corpus this came from once let a paper reach its venue without a single paper job
having run on it, because a missing build read as nothing to do.

`--dry-run` prints the plan and runs nothing — and deletes nothing, `paper.pdf` included.

⚠️ **A `build.sh` or `repro/build-submission.sh` in the paper directory is IGNORED.** Earlier
versions ran it; `paperlint build` now says one line — `build.sh is ignored — paperlint builds the paper
itself` — and builds the paper itself.
Why: [#59](https://github.com/zernie/paperlint/issues/59).

## Using the rules from an existing ESLint config

Under the hood `paperlint lint` builds an ESLint flat config and runs it. If your repository already
lints with ESLint, you can import the rule modules from `paperlint/eslint-rules/`
and wire them yourself; `bin/paperlint.mjs` exports `buildConfig(options, texLanguage)` that returns
the exact config the CLI uses, so the shortest path is:

```js
// eslint.config.mjs
import { buildConfig } from "paperlint/bin/paperlint.mjs";
import { texLanguage } from "paperlint/eslint-rules/latex-language.mjs";
export default buildConfig({}, texLanguage);
```

That config is the whole config for your papers: it starts with a global ignore of every file its
rules are not written for, so `eslint .` with it lints only the paper files. Do not spread it into a
config that also lints your JavaScript — that code would be ignored.

### Your own ESLint run over paper files: register paperlint's rules, off

If your `eslint.config.mjs` also lints the paper files — for rules of your own, with paperlint's LaTeX
language — a `% eslint-disable-next-line paper/leading-zero -- why` in a paper fails that run with
`Definition for rule 'paper/leading-zero' was not found`: your config does not know paperlint's rule
names. Spread `rulesOff` first:

```js
// eslint.config.mjs
import { rulesOff } from "paperlint/bin/paperlint.mjs";
import { texLanguage } from "paperlint/eslint-rules/latex-language.mjs";

export default [
  ...rulesOff(texLanguage),
  { files: ["**/paper.tex"], language: "tex/latex", rules: {/* your rules */} },
];
```

It registers every rule paperlint ships, each turned off (`paperlint lint` is where they run), and
the LaTeX language as `tex/latex` — use that instead of registering a `tex` plugin of your own, or
ESLint refuses the config with `Cannot redefine plugin "tex"`, with or without the language. Without
`texLanguage` it registers the rules only, for a config that lints markdown papers alone.

On the files paperlint lints it also turns off ESLint's report of unused disable directives: a
directive naming a rule that is off suppresses nothing, and would be reported as unused in every such
run. `paperlint lint` still reports a directive that silences nothing.

`rulePlugins(texLanguage)` gives the same plugins without the rule levels, one object per plugin name.
