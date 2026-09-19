# Configuration reference

One key in your `package.json`, written by `rpp init`. It holds the facts only your repository can
supply — nothing in it is guessable by a package that has never seen your corpus.

The README carries the minimal version of this. Everything below is the full surface, moved out on
2026-09-19.

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

| key                 | required | what it is                                                                         |
| ------------------- | -------- | ---------------------------------------------------------------------------------- |
| `papers`            | **yes**  | the directory your papers live in, relative to the file holding it. One string or a list. |
| `structure`         | no       | which files every paper directory must contain — see below. `false` turns it off.  |
| `authorListCommand` | no       | the command `paper/author-list` tells you to run when the check is missing          |
| `typographyDebt`    | no       | per-paper allowance of existing typography findings, so the count can only go down |
| `docFields`         | no       | required front-matter fields in review files, and the values each may hold          |
| `reviewSince`       | no       | only review files created on or after this date are checked                         |
| `minFindings`       | no       | a review with fewer findings than this is not required to name causes               |
| `causeMarker`       | no       | the phrase a review uses to introduce a cause (default `Cause:`), in any language   |
| `buildScripts`      | no       | override the build-script lookup order below                                        |

`papers` is required because the scope is the one thing that must not default: a default of `"."`
turns every run into a green report over the whole checkout. `rpp init` fills it by measuring —
and when nothing on disk looks like a papers directory, it writes the documented default and says
in the same breath that it is a guess.

## Why the key lives in `package.json`

Because of a count: the `package.json` key has **five** readers — the three editor hooks, the
ESLint helper, the skill scripts — and a separate config file had **one**, the CLI. A hook cannot
import code and cannot walk up a tree looking for a config; it can read a path it is able to name,
and the one path it can always name is the project's `package.json`.

`rpp lint` looks for it in the current directory and then upwards, the way eslint and tsc find
theirs, and prints which file it found. `--config <file>` overrides the search.

⚠️ **`rpp.json` is deprecated and still read.** Earlier versions of `init` created it; `init` no
longer does, and a run that reads one says so on its first line. The hooks never read it, so
leaving settings there is how the linter and the guard end up watching different directories —
`rpp init` copies the value across for you.

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

## How `rpp build` finds a build script

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

Override with `"buildScripts": [...]`.

**A paper with no build script is a FAILURE, not a skip**, and that is the whole point of the
command. The corpus this came from had a CI loop looking for `repro/build-submission.sh` while the
accepted paper shipped `build.sh`; the mismatch read as "nothing to build", and the paper reached
its venue without a single paper job having run on it. `--dry-run` answers "which papers can
nobody build?" in a second, without spending twenty compiles to ask.

## Using the rules from an existing ESLint config

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
