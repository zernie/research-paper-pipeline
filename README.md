<!--
README style — keep it scannable, not a wall of text:
- One idea per paragraph; paragraphs ≤ 3 lines. Split anything longer.
- Every section starts with a heading (##); sub-topics get ###. No section longer than one screen.
- Lists over prose for anything with 3+ items; bullets ≤ 2 lines.
- Tables for comparisons (commands, venues, checks). Code blocks for every command and file.
- A blank line between every block. Bold only for the one phrase a skimmer must see.
- Mechanics and edge cases live in docs/, linked — not inline.
- A reader must be able to answer "what is it, which venues, how do I start" from the first screen.
- Sparse emoji are fine where they help rhythm and scanning (e.g. one per section heading or feature bullet); never decorative, never several in a row.
- One name per thing, everywhere (lint, build, venue preset, kind, skill, papersDir), each explained once, before it is used.
- Editing this file: re-read all of it first, and change it so it still reads as one document — the opening, the diagram, the order and the names your change touches. Remove or merge what it makes redundant. Never bolt on a section or patch one paragraph in isolation.
-->

# paperlint

[![npm version](https://img.shields.io/npm/v/paperlint)](https://www.npmjs.com/package/paperlint)
![Node version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fzernie%2Fpaperlint%2Fmain%2Fpackage.json&query=%24.engines.node&label=node)

**Write a research paper in LaTeX from idea to camera-ready, and catch what gets it sent back
before you submit.** It comes in two parts:

- ✅ **A linter** — a command-line tool, no AI needed. Its headline catches:
  - 📏 a paper over the page limit for its kind at your venue;
  - 🔤 the wrong font — LaTeX silently fell back to Computer Modern because a package was missing;
  - 🔗 a bad reference — a cited work that does not exist, or lists the preprint's authors.

  Smaller slips too: `§` for "Section", `.05` for `0.05` — fixed for you.

- 🧠 **Skills for [Claude Code](https://claude.com/claude-code)** — optional, 24 of them, covering the
  whole pipeline: the idea, the venue, the study, the draft, the reviews, submission.

## Contents

- [The pipeline](#-the-pipeline)
- [Supported venues](#-supported-venues)
- [Getting started](#-getting-started)
  - [A new paper](#a-new-paper)
  - [A paper you already have](#a-paper-you-already-have)
- [Commands](#-commands)
- [Skills](#-skills)
- [Lint and build](#-lint-and-build)
- [Configuration](#-configuration)
  - [Add a venue that isn't listed](#-add-a-venue-that-isnt-listed)
- [Run it in CI](#-run-it-in-ci)
- [FAQ](#-faq)
- [Docs](#-docs)

## 🧭 The pipeline

```text
stage           what you get                          skills  linter
1 idea          a go / no-go, with the reason         yes
2 venue         venues ranked, deadlines planned      yes
3 study         a study design, honest statistics     yes
4 draft         a first draft, then a tighter one     yes     lint
5 review        the objections, before the reviewers  yes     lint
6 submit        a PDF within the limit, recorded      yes     build, lint
7 camera-ready  the final, de-anonymised PDF          yes     build, lint
8 extend        a plan for the next paper             yes

skills: optional, with Claude Code
lint:   every edit and every CI run, once the paper exists (paperlint new)
build:  compiles and measures the PDF; lint then checks pages, fonts, references
```

## 🎯 Supported venues

A **venue preset** holds a venue's format and page limits. A paper's **kind** picks which limit
applies: at AgenticDev a `short` paper gets 5 pages and a `full` one 10. You choose it once per paper.

| preset                  | venue              | format             | kinds and page limits                                                                       |
| ----------------------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------- |
| `paperlint:acm-sigconf` | any ACM conference | ACM two-column     | no kinds: the format only, no page limit                                                    |
| `paperlint:agenticdev`  | AgenticDev @ ASE   | ACM two-column     | `short` 5, `full` 10, `demo` 5 pages, + 2 pages of references                               |
| `paperlint:aisec`       | AISec @ ACM CCS    | ACM two-column     | `research`, `benchmark`, `position`, `sok`: 10 pages + 2 pages of references                |
| `paperlint:realm`       | REALM @ EMNLP      | ACL two-column, A4 | `long` 8, `short` 4 — recorded, not checked ([why](docs/rules.md#checks-against-the-venue)) |

Not shipped yet: IEEE, USENIX, NeurIPS, Springer, and ACL venues other than REALM.
[Add yours](#-add-a-venue-that-isnt-listed) in one small file.

## 🚀 Getting started

### A new paper

<!-- `vigiles:symbol src/init.ts#init` — `npm run check` fails if this function is renamed or removed. -->

1. Install (Node 22.13 or newer):

   ```sh
   npm i -D paperlint
   ```

2. Set up. `init` asks three questions: where your papers live (default `papers/`), whether to
   install TeX Live now, and whether to add a CI workflow. With Claude Code it also installs the
   skills and three hooks ([what they do](docs/install.md)).

   ```sh
   npx paperlint init
   ```

3. Create a paper. `--venue` names its venue preset from the table above, `--kind` which of its page
   limits applies:

   <!-- `vigiles:symbol src/new-paper.ts#newPaper` — `npm run check` fails if this function is renamed or removed. -->

   ```sh
   npx paperlint new my-paper --venue agenticdev --kind short
   ```

   It writes `papers/my-paper/` (in the folder you gave `init`) with three files:
   - `paper.tex` — your paper;
   - `paperlint.json` — its venue preset and kind;
   - `PIPELINE-STATUS.md` — which stage the paper is at; the skills read and update it.

4. Build the PDF. **This needs TeX Live, a ~270 MB download (~3 min, once).** If you said no in
   `init`, run `npx paperlint toolchain` first.

   ```sh
   npx paperlint build papers/my-paper
   ```

5. Check it:

   ```sh
   npx paperlint lint
   ```

   On the stub from step 3 the first run already catches something (output shortened):

   ```text
   papers/my-paper/paper.tex
     1:1   error    1 column(s), agenticdev requires 2 — the wrong document class or class option   pdf/geometry
     1:1   error    no font starts with `LinLibertine` (body text of agenticdev); the PDF has: CMR10, …   pdf/fonts
     8:4   warning  `§` instead of the word «Section» — `paperlint lint --fix` writes it              paper/section-word
   ```

   `new` writes a format-neutral stub in plain `article`, and AgenticDev wants ACM's class. Make
   the first line `\documentclass[sigconf]{acmart}`, build again, and the errors are gone.

### A paper you already have

paperlint finds a paper by its folder: `<papersDir>/<name>/`, with the main file named `paper.tex`.

1. Put the paper there — for example `papers/my-paper/paper.tex`, the rest of its files beside it. If
   your paper folders already live elsewhere, say `thesis/`, [set `papersDir`](#-configuration) instead.
2. Run `npx paperlint new my-paper --venue <preset> --kind <kind>`. On an existing folder it only
   adds the missing `paperlint.json` and `PIPELINE-STATUS.md`; it never touches `paper.tex`.
3. Build and lint, as above.

## 🧰 Commands

| command                                                     | what it does                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npx paperlint init`                                        | sets the project up                                                            |
| `npx paperlint new my-paper --venue <preset> --kind <kind>` | creates a paper folder for that venue, or completes an existing one            |
| `npx paperlint build <paper>`                               | compiles `paper.tex` to `paper.pdf`, measures it, checks the references online |
| `npx paperlint lint`                                        | runs every check over your papers; `--fix` fixes what can be fixed             |
| `npx paperlint toolchain`                                   | installs TeX Live with the packages your venues need (~270 MB, ~3 min, once)   |
| `npx paperlint doctor`                                      | checks the setup and exits non-zero if something is miswired                   |
| `npx paperlint --help`                                      | every command and flag                                                         |

## 🧠 Skills

You do not need to learn the skills' names: you ask Claude Code, and the matching skill starts.
`paper-pipeline` walks you through the stages; any skill also starts on its own when you ask for
what it does — "is this idea worth a paper?", "find me a venue for this". `init` installs them.

- **A go / no-go on your idea, with the reason.** `research-ideate`
- **A ranked list of venues that fit** — deadline, page limit, indexing. `find-venue`
- **A first draft from your results.** `draft-paper`
- **A hostile review before the real one.** `paper-adversarial-review`
- **A ready / not ready verdict before you submit**, worst problem first. `harden-paper`
- **Where your paper stands**, measured from the real build. `paper-status`

All 24, by stage: [`docs/skills.md`](docs/skills.md).

## 🔍 Lint and build

|        | `paperlint build`                                                                            | `paperlint lint`                                                                                      |
| ------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| needs  | Node, TeX Live, the network                                                                  | Node                                                                                                  |
| does   | compiles `paper.tex`, measures the PDF, checks each reference online (exists, right authors) | checks the source, and judges what build recorded: page limit, fonts, the reference results — offline |
| writes | `paper.pdf`, and in `_build/` the measurements and the reference results                     | nothing (`--fix`: the three fixable slips)                                                            |

- If `paper.pdf` or the bibliography changed since the last build, lint fails and tells you to rebuild.
- Lint also checks the pipeline's own records: `PIPELINE-STATUS.md`, reviews, notes on related
  papers ([`docs/rules.md`](docs/rules.md)).
- The rules run on ESLint, so a deliberate exception is a comment on the line above:
  `% eslint-disable-next-line paper/leading-zero -- quoted from the reviewer`.
- Errors fail the run; warnings only print, unless you pass `--max-warnings <n>`.

Every check: [`docs/rules.md`](docs/rules.md). How build compiles:
[`docs/configuration.md`](docs/configuration.md#how-paperlint-build-compiles-a-paper).

## 🧩 Configuration

Two levels, one file name, both optional:

```
paperlint.json                   the project: papersDir, rules, defaults for every paper
papers/my-paper/paperlint.json   one paper: its venue preset ("extends"), its kind, its own rules
```

- `papersDir` is the folder that holds your paper folders; it defaults to `papers`.
- The paper's venue preset is its `"extends"` key — the one `new --venue` writes.
- A paper's `paperlint.json` overrides the project's, key by key.
- **An unknown key is an error**, so a typo cannot silently turn a setting off.

Every key: [`docs/configuration.md`](docs/configuration.md). Already use ESLint for other files? See
[`docs/configuration.md`](docs/configuration.md#using-the-rules-from-an-existing-eslint-config).

### ➕ Add a venue that isn't listed

A venue preset is a small JSONC file: the preset it builds on, and the page limit of each kind of
paper. For an ACM workshop with a 4-page limit for short papers, `venues/my-workshop.jsonc`:

```jsonc
{
  // page size, columns and fonts of the ACM two-column format
  "extends": "paperlint:acm-sigconf",
  "format": {
    // one entry per kind of paper the call for papers names
    "kinds": {
      // the limit from the call for papers, in pages, references not counted
      "short": { "body_pages_max": 4 },
    },
  },
}
```

```sh
npx paperlint new my-paper --venue ./venues/my-workshop.jsonc --kind short
```

Give the path from where you run the command; `new` rewrites it relative to the paper's own
`paperlint.json`. A venue in another format: [`docs/rules.md`](docs/rules.md#writing-your-own-venue-preset).

## 🤖 Run it in CI

Two options:

| job                        | time                          | checks                                     |
| -------------------------- | ----------------------------- | ------------------------------------------ |
| build, then lint           | ~3 min first run, then cached | everything                                 |
| lint only (`init` adds it) | seconds                       | the source; not pages, fonts or references |

Lint judges pages, fonts and references from what build measured, so the full job builds first:

```yaml
name: papers
on: [push, pull_request]
jobs:
  papers:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: ~/.cache/paperlint/texlive
          key: texlive-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npx paperlint toolchain
      - run: npx paperlint build --all
      - run: npx paperlint lint
```

Lint only — each paper then gets one warning that it was not built:

```yaml
- uses: zernie/paperlint@v3.0.0
  with:
    paths: papers # your papersDir
```

## ❓ FAQ

**Does it install anything without asking?**
No. TeX Live comes only from `paperlint toolchain`, or when you say yes in `init` or `build`. On
Windows, install TeX Live yourself.

**Several papers for different venues in one repo?**
Yes. Each paper names its own venue preset in its own `paperlint.json`.

**Does it change my paper?**
Only `paperlint lint --fix`, and only three rules: `paper/section-word` (`§` → Section),
`paper/leading-zero` (`.05` → `0.05`) and `paper/figure-ref-style` (one figure-reference style).

## 📚 Docs

- [`docs/skills.md`](docs/skills.md) — every skill, by stage
- [`docs/install.md`](docs/install.md) — what `init` does, the hooks, package managers, troubleshooting
- [`docs/configuration.md`](docs/configuration.md) — every setting, how `build` compiles, using your own ESLint
- [`docs/rules.md`](docs/rules.md) — every check, venue presets, recording a submitted PDF
- [`docs/optional-rules.md`](docs/optional-rules.md) — checks only some venues need
- [`docs/toolchain.md`](docs/toolchain.md) — TeX Live, and Banal (HotCRP's page-geometry checker, GPL)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how the package is tested and released, and adding a venue to it

## License

MIT. Banal, used for page geometry, is GPL and not part of this package:
[`docs/toolchain.md`](docs/toolchain.md#page-geometry-banal-without-poppler).
